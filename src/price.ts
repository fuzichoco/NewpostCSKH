import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { getKv, setKv } from "./db.ts"
import { listKnowledgeFiles, xlsxSheets } from "./import.ts"

/** Bảng giá từng dịch vụ, đọc từ file Excel giá công bố; code tự tra giá thay vì để AI đọc bảng (AI hay tra nhầm dòng). */
export const PRICE_DIR = "data/bang-gia"

type Zone = { name: string; codes: string[]; time: string }
type Row = { kg: number; perKg: boolean; prices: number[] }
type Table = { zones: Zone[]; rows: Row[] }
export type PriceService = { code: string; name: string; file: string; updated: number; doc?: Table; goods: Table }

const NAMES: Record<string, string> = {
  SDHL: "DHL Express (qua DHL Singapore)", VDHL: "DHL Express Việt Nam", FED: "FedEx International Priority",
  UPS: "UPS Saver", CTQ: "Chuyển tuyến QT (CTQ)", CTU: "Chuyển tuyến UT (CTU)",
}
// Mã phụ luôn cùng vùng với mã chính: AI chỉ cần dùng mã nước ISO.
const ALIAS: Record<string, string> = { CN2: "CN", KH1: "KH" }

/** File Excel bảng giá dạng chuẩn: dòng 1 "Zone Code" + tên vùng, dòng 2 mã nước, dòng 4 thời gian, từ dòng 6 giá
 *  (cột A số kg, cột B = 1 là đơn giá mỗi kg). Trang tên có "THU" là bảng tài liệu. Không đúng dạng thì trả về null. */
export function parsePriceWorkbook(fileName: string, buf: Buffer): PriceService | null {
  const sheets = xlsxSheets(buf).filter((s) => s.rows[0]?.[0]?.trim() === "Zone Code")
  const doc = sheets.find((s) => /THU/i.test(s.name))
  const goods = sheets.find((s) => s !== doc)
  if (!goods) return null
  const code = fileName.match(/CHUAN_[A-Z]+_([A-Z]+)/i)?.[1].toUpperCase() ?? fileName.replace(/\.[^.]+$/, "").toUpperCase()
  const table = ({ name, rows }: { name: string; rows: string[][] }): Table => {
    const zones: Zone[] = []
    for (let c = 2; rows[0][c]?.trim(); c++) {
      const codes = (rows[1]?.[c] ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)
      zones.push({ name: rows[0][c].trim(), codes: codes.map((x) => ALIAS[x] ?? x), time: rows[3]?.[c]?.trim().replace(/days?/i, "ngày") ?? "" })
    }
    const data: Row[] = rows.slice(5).filter((r) => r[0]?.trim()).map((r, i) => {
      const prices = zones.map((_, z) => Number(r[2 + z]))
      if (!(Number(r[0]) > 0) || prices.some((p) => !(p > 0))) throw new Error(`Trang "${name}" dòng ${i + 6} có ô giá trống hoặc không phải số.`)
      return { kg: Number(r[0]), perKg: Number(r[1]) === 1, prices }
    })
    return { zones, rows: data.sort((a, b) => Number(a.perKg) - Number(b.perKg) || a.kg - b.kg) }
  }
  return { code, name: NAMES[code] ?? code, file: fileName, updated: Date.now(), doc: doc && table(doc), goods: table(goods) }
}

// Bảng giá chỉ đổi khi admin nạp / xóa (savePriceService, deletePriceService): giữ trong bộ nhớ, khỏi đọc lại file mỗi câu trả lời.
// Theo thư mục đang chạy (test đổi thư mục làm việc).
let cache: { cwd: string; list: PriceService[] } | null = null

export function listPriceServices(): PriceService[] {
  if (cache?.cwd === process.cwd()) return cache.list
  const list = !existsSync(PRICE_DIR) ? [] : readdirSync(PRICE_DIR).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(`${PRICE_DIR}/${f}`, "utf8")) as PriceService)
  cache = { cwd: process.cwd(), list }
  return list
}

/** Nạp lại bảng giá cùng dịch vụ thì thay bản cũ. */
export function savePriceService(s: PriceService) {
  cache = null
  mkdirSync(PRICE_DIR, { recursive: true })
  const path = `${PRICE_DIR}/${s.code}.json`
  const replaced = existsSync(path)
  writeFileSync(path, JSON.stringify(s))
  return replaced
}

export function deletePriceService(code: string) {
  if (!listPriceServices().some((s) => s.code === code)) return false
  rmSync(`${PRICE_DIR}/${code}.json`)
  cache = null
  return true
}

/** Trọng lượng tính cước: số lớn hơn giữa cân thực và D×R×C/5000 (mỗi chiều làm tròn lên cm), làm tròn lên 0,5 kg. */
export function chargeableWeight(kg: number, dims?: number[]) {
  const volume = dims?.length === 3 ? dims.reduce((a, d) => a * Math.ceil(d), 1) / 5000 : 0
  return Math.ceil(Math.max(kg, volume) * 2 - 1e-9) / 2
}

/** Giá một kiện ở một vùng: trọn gói theo dòng cân; vượt mốc trọn gói thì số kg (làm tròn lên bước cân) × đơn giá của khoảng cân. */
function tablePrice(t: Table, zone: number, w: number): number | null {
  const flat = t.rows.find((r) => !r.perKg && r.kg >= w - 1e-9)
  if (flat) return Math.round(flat.prices[zone])
  // Mốc khoảng cân lẻ 0,5 (DHL Việt Nam: 49,5 / 69,5…) là tính theo bước 0,5 kg; mốc chẵn (FedEx, UPS…: 44 / 70…) làm tròn lên 1 kg.
  const step = t.rows.some((r) => r.perKg && r.kg % 1) ? 0.5 : 1
  const kg = Math.ceil(w / step - 1e-9) * step
  const band = t.rows.find((r) => r.perKg && kg <= r.kg + 1e-9)
  return band ? Math.round(band.prices[zone] * kg) : null
}

// --- Phụ phí xăng dầu: % cộng trên cước công bố, mỗi dịch vụ đã nạp bảng giá một mức; admin nhập ở trang Phụ phí xăng dầu. ---
/** pct: % theo mã dịch vụ (SDHL, UPS…). from/to: khoảng ngày hãng thông báo (YYYY-MM-DD), chỉ để nhắc cập nhật –
 *  quá hạn bot vẫn dùng mức cuối cùng (báo thiếu phụ phí khiến khách thấy giá rẻ hơn thực tế nhiều). */
export type Fuel = { pct: Record<string, number>; from: string; to: string; updated: number; vat?: number }
export const getFuel = (): Fuel | null => JSON.parse(getKv("fuel_surcharge") ?? "null")
export const setFuel = (f: Fuel) => setKv("fuel_surcharge", JSON.stringify(f))
const fuelPct = (code: string, fuel: Fuel | null) => fuel?.pct[code] || null
export const pctText = (n: number) => `${String(n).replace(".", ",")}%`
/** VAT cộng vào giá báo khách (mặc định 8%, admin đổi ở trang Phụ phí xăng dầu). */
export const vatPct = (fuel = getFuel()) => fuel?.vat ?? 8

/** price: giá báo khách (đã cộng phụ phí xăng dầu nếu có); base: cước theo bảng giá công bố. */
export type Quote = { code: string; name: string; zone: string; time: string; price: number; base: number; fuel: number | null }

/** Giá một kiện theo mọi dịch vụ đi nước đó, rẻ nhất trước. tooHeavy: dịch vụ đi nước đó nhưng kiện nặng quá bảng giá. */
export function quote(country: string, kg: number, dims: number[] | undefined, isDoc: boolean, services = listPriceServices(), fuel = getFuel()) {
  const code = ALIAS[country.toUpperCase()] ?? country.toUpperCase()
  const weight = chargeableWeight(kg, dims)
  const quotes: Quote[] = []
  const tooHeavy: string[] = []
  for (const s of services) {
    const docMax = s.doc ? Math.max(...s.doc.rows.filter((r) => !r.perKg).map((r) => r.kg)) : 0
    const t = isDoc && s.doc && weight <= docMax ? s.doc : s.goods
    const zone = t.zones.findIndex((z) => z.codes.includes(code))
    if (zone < 0) continue
    const price = tablePrice(t, zone, weight)
    if (price == null) tooHeavy.push(s.name)
    else {
      const pct = fuelPct(s.code, fuel)
      const total = pct ? Math.round(price * (1 + pct / 100)) : price
      quotes.push({ code: s.code, name: s.name, zone: t.zones[zone].name, time: t.zones[zone].time, price: total, base: price, fuel: pct })
    }
  }
  return { country: code, weight, quotes: quotes.sort((a, b) => a.price - b.price), tooHeavy }
}

export const PRICE_TAG = /\[TINH_GIA:([^\]]*)\]/g
const money = (n: number) => `${n.toLocaleString("vi-VN")}đ`

// --- Phụ phí hải quan theo mặt hàng ---
export type ItemSurcharge = { no: string; item: string; fee: string; note: string }
/** Bảng này chỉ áp cho chuyên tuyến (NewPost xác nhận 29/10/2026); DHL, FedEx, UPS có phụ phí riêng. */
const ITEM_SURCHARGE_SERVICES = ["CTQ", "CTU"]

/** Đọc bảng "PHỤ PHÍ HẢI QUAN THEO MẶT HÀNG" (| STT | Mặt hàng | Phụ thu | Ghi chú |) trong file kiến thức đã nạp:
 *  nạp file mới là bảng mới có hiệu lực, không phải sửa code. */
export function itemSurcharges(files = listKnowledgeFiles()): ItemSurcharge[] {
  // Cụm chữ này có thể xuất hiện ở nhiều chỗ (nhắc tới trong câu văn): lấy chỗ đầu tiên thật sự có bảng.
  const clean = (x: string) => x.replace(/\*\*/g, "").trim()
  for (const f of files) {
    for (const at of [...f.text.matchAll(/PHỤ PHÍ HẢI QUAN THEO MẶT HÀNG/gi)].map((m) => m.index)) {
      const section = f.text.slice(at).split(/\n#{1,2} /)[0]
      const rows = [...section.matchAll(/^\|\s*(\d+)\s*\|([^|]+)\|([^|]+)\|([^|]*)\|/gm)]
        .map((m) => ({ no: m[1], item: clean(m[2]), fee: clean(m[3]), note: clean(m[4]) }))
      if (rows.length) return rows
    }
  }
  return []
}

/** Tiền phụ thu một mặt hàng cho 1 kiện. Ghi chú có bậc cân ("1–5 kg: 300k; 5–22 kg: 500k") thì lấy đúng bậc;
 *  "đ/kg" nhân cân nặng; "đ/kiện", "đ/lô" tính 1 lần; tính theo chiếc/cái/máy… (chưa biết số lượng) hoặc có khoảng giá
 *  thì lấy mức thấp nhất, from = true để báo khách "từ". Không đọc được số tiền thì null (nhân viên xác nhận). */
export function itemFee(x: ItemSurcharge, kg: number): { amount: number; from: boolean } | null {
  const tiers = [...x.note.matchAll(/(\d+(?:[.,]\d+)?)\s*[–-]\s*(\d+(?:[.,]\d+)?)\s*kg:\s*(\d+)k/gi)]
  const tier = tiers.find((m) => kg <= Number(m[2].replace(",", ".")) + 1e-9)
  if (tier) return { amount: Number(tier[3]) * 1000, from: false }
  const m = x.fee.match(/([\d.]+)(?:\s*[–-]\s*[\d.]+)?\s*đ\s*\/\s*([^\s;,+]+)/)
  if (!m) return null
  const unit = m[2].toLowerCase()
  const amount = Number(m[1].replace(/\./g, ""))
  return {
    amount: unit === "kg" ? Math.round(amount * kg) : amount,
    from: /\d\s*[–-]\s*\d/.test(x.fee) || /[+;]/.test(x.fee) || !["kg", "kiện", "lô"].includes(unit),
  }
}

const shortItem = (x: ItemSurcharge) => x.item.split(/[;,(]/)[0].trim().toLowerCase()

/** Giá đầy đủ một dịch vụ cho 1 kiện: cước + phụ phí xăng dầu + phụ thu mặt hàng (chỉ chuyên tuyến) + VAT. */
function fullPrice(q: Quote, items: ItemSurcharge[], weight: number, vat: number) {
  const fees = ITEM_SURCHARGE_SERVICES.includes(q.code) ? items.map((x) => ({ x, fee: itemFee(x, weight) })) : []
  const known = fees.filter((f) => f.fee).map((f) => ({ label: `phụ thu ${shortItem(f.x)} ${f.fee!.from ? "từ " : ""}${money(f.fee!.amount)}`, ...f.fee! }))
  const beforeVat = q.price + known.reduce((a, f) => a + f.amount, 0)
  const vatAmount = Math.round((beforeVat * vat) / 100)
  const parts = [`cước ${money(q.base)}`, ...(q.fuel ? [`phụ phí xăng dầu ${pctText(q.fuel)} ${money(q.price - q.base)}`] : []),
    ...known.map((f) => f.label), ...(vat ? [`VAT ${pctText(vat)} ${money(vatAmount)}`] : [])]
  return {
    total: beforeVat + vatAmount,
    from: known.some((f) => f.from),
    detail: parts.join(" + "),
    unknown: fees.filter((f) => !f.fee).map((f) => f.x),
  }
}

/** Phụ phí xăng dầu đổi theo tuần: câu nhắc giá báo hôm nay chỉ giữ đến hết khoảng ngày admin nhập. */
function fuelValidity(fuel: Fuel | null) {
  if (!fuel || !Object.values(fuel.pct).some(Boolean)) return ""
  const to = fuel.to ? fuel.to.split("-").reverse().join("/") : ""
  return `Giá trên áp dụng${to ? ` đến hết ngày ${to}` : " trong tuần này"}. Phụ phí xăng dầu do hãng điều chỉnh theo tuần, nên nếu anh/chị chốt gửi sau thời gian này, giá có thể cao hoặc thấp hơn một chút; em sẽ báo lại giá theo mức mới khi anh/chị chốt đơn ạ.`
}

const BATTERY_BANNED = ["UPS", "SDHL"]
// Từ trong tên nhóm mà khách hay dùng với nghĩa khác ("báo giá", "giấy tờ" = tài liệu): không dùng để nhận nhóm.
const ITEM_STOP_WORDS = new Set(["báo", "giấy"])
// Thiết bị điện tử luôn có pin: khách nói tên thiết bị thì tính vào nhóm pin.
const BATTERY_WORDS = /điện thoại|iphone|smartphone|laptop|macbook|máy tính bảng|ipad|tai nghe|airpods|đồng hồ thông minh|smartwatch|apple watch|sạc dự phòng/i

/** Nhóm phụ thu mặt hàng khách nhắc tới trong tin nhắn (so tên nhóm trong bảng, bỏ phần ví dụ trong ngoặc).
 *  Model rẻ hay quên ghi STT mặt hàng vào thẻ TINH_GIA: code tự bổ sung để không sót phụ thu. */
export function itemsInText(text: string, surcharges = itemSurcharges()): string[] {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `
  return surcharges
    .filter((x) => {
      const words = x.item.replace(/\([^)]*\)/g, "").split(/[;,…]/).map((w) => w.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()).filter((w) => w.length >= 3 && !ITEM_STOP_WORDS.has(w))
      return words.some((w) => t.includes(` ${w} `)) || (/^pin\b/i.test(x.item) && BATTERY_WORDS.test(text))
    })
    .map((x) => x.no)
}

/** Thêm STT mặt hàng tìm được trong tin khách vào các thẻ TINH_GIA hàng hóa (giữ STT AI đã ghi). */
export function withItems(reply: string, customerText: string, surcharges = itemSurcharges()) {
  const found = itemsInText(customerText, surcharges)
  if (!found.length) return reply
  return reply.replace(PRICE_TAG, (tag, body: string) => {
    const f = body.split("|").map((x) => x.trim())
    if (/tai|tài|doc/i.test(f[3] ?? "")) return tag
    const nos = [...new Set([...(f[4]?.match(/\d+/g) ?? []), ...found])]
    return `[TINH_GIA: ${[f[0] ?? "", f[1] ?? "", f[2] || "-", f[3] || "hang", nos.join(",")].join(" | ")}]`
  })
}

/** Đổi các thẻ [TINH_GIA: JP | 3 | 40x30x30 | hang | 7] (mỗi kiện một thẻ) thành kết quả tính giá cho AI viết câu trả lời.
 *  Ô cuối là STT mặt hàng trong bảng phụ phí hải quan theo mặt hàng (hoặc -). */
export function priceResult(reply: string, services = listPriceServices(), surcharges = itemSurcharges()) {
  const parcels = parseParcels(reply, services, surcharges)
  const validity = fuelValidity(getFuel())
  // Model rẻ hay lặp lại thẻ TINH_GIA thay vì viết câu báo giá: nói rõ bước tính đã xong.
  const lines = [
    "",
    "# BƯỚC TÍNH GIÁ ĐÃ XONG",
    "Hệ thống đã tính giá cho tin nhắn cuối của khách (kết quả bên dưới). Bây giờ CHỈ viết câu báo giá gửi khách bằng lời. TUYỆT ĐỐI KHÔNG viết thẻ [TINH_GIA].",
    "# KẾT QUẢ TÍNH GIÁ (hệ thống tính từ bảng giá công bố – dùng ĐÚNG các con số này, KHÔNG tự tính lại)",
  ]
  parcels.forEach((p, i) => {
    lines.push(`Kiện ${i + 1}: mã nước ${p.country}, ${p.isDoc ? "tài liệu" : "hàng hóa"}, cân thực ${p.kg} kg, kích thước ${p.hasDims ? p.size : "chưa có"}, trọng lượng tính cước ${String(p.weight).replace(".", ",")} kg.`)
    for (const l of p.lines) {
      lines.push(`- ${l.q.name}: TỔNG ${l.from ? "TỪ " : ""}${money(l.total)} = ${l.detail}${l.q.time ? ` (thời gian ${l.q.time})` : ""}`)
      for (const x of l.unknown) lines.push(`  + Chưa cộng phụ thu ${x.item}: ${x.fee}${x.note ? ` (${x.note})` : ""} – nhân viên xác nhận`)
    }
    if (!p.lines.length && !p.tooHeavy.length) lines.push("- Không dịch vụ nào có giá đi mã nước này.")
    if (p.tooHeavy.length) lines.push(`- Quá mức cân của bảng giá (cần nhân viên báo giá): ${p.tooHeavy.join(", ")}`)
  })
  if (parcels.length > 1) {
    const totals = new Map<string, number[]>()
    for (const p of parcels) for (const l of p.lines) totals.set(l.q.name, [...(totals.get(l.q.name) ?? []), l.total])
    const all = [...totals].filter(([, v]) => v.length === parcels.length).map(([n, v]) => [n, v.reduce((a, b) => a + b, 0)] as const)
    if (all.length) lines.push("Tổng các kiện:", ...all.sort((a, b) => a[1] - b[1]).map(([n, t]) => `- ${n}: ${money(t)}`))
  }
  lines.push(
    "Cách báo: báo tối đa 3 dịch vụ rẻ nhất ở trên (khách hỏi hãng nào thì báo hãng đó). Mỗi dịch vụ ghi con số TỔNG và chi tiết từng khoản",
    "(cước, phụ phí xăng dầu, phụ thu mặt hàng nếu có, VAT) đúng như sau dấu =, kèm thời gian nếu có. Có chữ \"TỪ\" thì nói \"từ\" và nhân viên xác nhận mức chính xác.",
    "Giá TỔNG đã gồm VAT; dòng có \"phụ phí xăng dầu\" là đã gồm phụ phí xăng dầu, dòng không có thì nói chưa gồm phụ phí xăng dầu.",
    "KHÔNG nói \"chưa gồm VAT\" (quy tắc này THAY cho các câu về VAT / phụ phí trong kiến thức).",
    "Chỉ nói chưa gồm thuế nhập khẩu tại nước đến và phụ phí phát sinh khác. Kích thước \"chưa có\" thì nói giá có thể thay đổi khi cân đo thực tế.",
    ...(validity ? [`Cuối câu báo giá PHẢI có câu này (giữ nguyên ý): "${validity}"`] : []),
    "Khách hỏi vì sao giá khác lần báo trước (tuần trước rẻ hơn / đắt hơn): giải thích lịch sự là phụ phí xăng dầu của hãng điều chỉnh theo tuần,",
    "giá mới nhất là giá ở trên, cước chính theo bảng giá công bố không đổi.",
    "Không dịch vụ nào có giá hoặc quá mức cân: trả lời đúng một dòng [CHUYEN_NHAN_VIEN]. KHÔNG viết thẻ [TINH_GIA] nữa.",
  )
  return lines.join("\n")
}

/** Câu báo giá code tự viết (3 dịch vụ rẻ nhất mỗi kiện) khi AI không viết được câu trả lời sau khi đã tính giá.
 *  Không kiện nào có giá thì trả về "". */
export function priceFallback(reply: string, services = listPriceServices(), surcharges = itemSurcharges()) {
  const parcels = parseParcels(reply, services, surcharges).filter((p) => p.lines.length)
  if (!parcels.length) return ""
  const lines: string[] = []
  parcels.forEach((p, i) => {
    lines.push(`${parcels.length > 1 ? `Kiện ${i + 1}: ` : "Dạ "}hàng đi mã nước ${p.country}, trọng lượng tính cước ${String(p.weight).replace(".", ",")} kg:`)
    for (const l of p.lines.slice(0, 3)) {
      lines.push(`- ${l.q.name}: ${l.from ? "từ " : ""}${money(l.total)} (${l.detail})${l.q.time ? `, thời gian ${l.q.time}` : ""}`)
    }
  })
  const shown = parcels.flatMap((p) => p.lines.slice(0, 3))
  const fuelNote = shown.every((l) => l.q.fuel) ? "đã gồm phụ phí xăng dầu và VAT" : shown.some((l) => l.q.fuel) ? "đã gồm VAT, phụ phí xăng dầu đã cộng với dịch vụ có ghi" : "đã gồm VAT, chưa gồm phụ phí xăng dầu"
  lines.push(`Giá trên theo bảng giá công bố, ${fuelNote}, chưa gồm thuế nhập khẩu tại nước đến. Nhân viên sẽ xác nhận tổng chi phí chính xác khi cân đo thực tế ạ.`)
  const validity = fuelValidity(getFuel())
  if (validity) lines.push(validity)
  return lines.join("\n")
}

function parseParcels(reply: string, services: PriceService[], surcharges: ItemSurcharge[]) {
  const fuel = getFuel()
  const vat = vatPct(fuel)
  return [...reply.matchAll(PRICE_TAG)].map((m) => {
    const [country = "", kg = "", size = "", kind = "", item = ""] = m[1].split("|").map((x) => x.trim())
    const dims = size.match(/\d+(?:[.,]\d+)?/g)?.map((d) => Number(d.replace(",", ".")))
    const isDoc = /tai|tài|doc/i.test(kind)
    const items = isDoc ? [] : (item.match(/\d+/g) ?? []).map((no) => surcharges.find((x) => x.no === no)).filter((x): x is ItemSurcharge => !!x)
    const q = quote(country, Number(kg.replace(",", ".")) || 0, dims?.length === 3 ? dims : undefined, isDoc, services, fuel)
    // Hàng có pin: UPS cấm "pin và sản phẩm chứa pin", DHL qua Singapore không nhận hàng có pin (kiến thức file 06) – không báo 2 dịch vụ này.
    const battery = items.some((x) => /^pin\b/i.test(x.item))
    const lines = q.quotes.filter((x) => !(battery && BATTERY_BANNED.includes(x.code)))
      .map((x) => ({ q: x, ...fullPrice(x, items, q.weight, vat) })).sort((a, b) => a.total - b.total)
    return { ...q, lines, size, isDoc, kg, hasDims: dims?.length === 3, items }
  })
}
