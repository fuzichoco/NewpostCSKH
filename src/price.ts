import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

export function listPriceServices(): PriceService[] {
  if (!existsSync(PRICE_DIR)) return []
  return readdirSync(PRICE_DIR).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(`${PRICE_DIR}/${f}`, "utf8")) as PriceService)
}

/** Nạp lại bảng giá cùng dịch vụ thì thay bản cũ. */
export function savePriceService(s: PriceService) {
  mkdirSync(PRICE_DIR, { recursive: true })
  const path = `${PRICE_DIR}/${s.code}.json`
  const replaced = existsSync(path)
  writeFileSync(path, JSON.stringify(s))
  return replaced
}

export function deletePriceService(code: string) {
  if (!listPriceServices().some((s) => s.code === code)) return false
  rmSync(`${PRICE_DIR}/${code}.json`)
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

export type Quote = { code: string; name: string; zone: string; time: string; price: number }

/** Giá một kiện theo mọi dịch vụ đi nước đó, rẻ nhất trước. tooHeavy: dịch vụ đi nước đó nhưng kiện nặng quá bảng giá. */
export function quote(country: string, kg: number, dims: number[] | undefined, isDoc: boolean, services = listPriceServices()) {
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
    else quotes.push({ code: s.code, name: s.name, zone: t.zones[zone].name, time: t.zones[zone].time, price })
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
  for (const f of files) {
    const at = f.text.search(/PHỤ PHÍ HẢI QUAN THEO MẶT HÀNG/i)
    if (at < 0) continue
    const section = f.text.slice(at).split(/\n#{1,2} /)[0]
    const clean = (x: string) => x.replace(/\*\*/g, "").trim()
    return [...section.matchAll(/^\|\s*(\d+)\s*\|([^|]+)\|([^|]+)\|([^|]*)\|/gm)]
      .map((m) => ({ no: m[1], item: clean(m[2]), fee: clean(m[3]), note: clean(m[4]) }))
  }
  return []
}

/** Đổi các thẻ [TINH_GIA: JP | 3 | 40x30x30 | hang | 7] (mỗi kiện một thẻ) thành kết quả tính giá cho AI viết câu trả lời.
 *  Ô cuối là STT mặt hàng trong bảng phụ phí hải quan theo mặt hàng (hoặc -). */
export function priceResult(reply: string, services = listPriceServices(), surcharges = itemSurcharges()) {
  const parcels = [...reply.matchAll(PRICE_TAG)].map((m) => {
    const [country = "", kg = "", size = "", kind = "", item = ""] = m[1].split("|").map((x) => x.trim())
    const dims = size.match(/\d+(?:[.,]\d+)?/g)?.map((d) => Number(d.replace(",", ".")))
    const isDoc = /tai|tài|doc/i.test(kind)
    const items = (item.match(/\d+/g) ?? []).map((no) => surcharges.find((x) => x.no === no)).filter((x): x is ItemSurcharge => !!x)
    return { ...quote(country, Number(kg.replace(",", ".")) || 0, dims?.length === 3 ? dims : undefined, isDoc, services), size, isDoc, kg, hasDims: dims?.length === 3, items }
  })
  const lines = ["", "# KẾT QUẢ TÍNH GIÁ (hệ thống tính từ bảng giá công bố – dùng ĐÚNG các con số này, KHÔNG tự tính lại)"]
  parcels.forEach((p, i) => {
    lines.push(`Kiện ${i + 1}: mã nước ${p.country}, ${p.isDoc ? "tài liệu" : "hàng hóa"}, cân thực ${p.kg} kg, kích thước ${p.hasDims ? p.size : "chưa có"}, trọng lượng tính cước ${String(p.weight).replace(".", ",")} kg.`)
    for (const q of p.quotes) lines.push(`- ${q.name}: ${money(q.price)}${q.time ? ` (thời gian ${q.time})` : ""}`)
    if (!p.quotes.length && !p.tooHeavy.length) lines.push("- Không dịch vụ nào có giá đi mã nước này.")
    if (p.tooHeavy.length) lines.push(`- Quá mức cân của bảng giá (cần nhân viên báo giá): ${p.tooHeavy.join(", ")}`)
    const affected = p.quotes.filter((q) => ITEM_SURCHARGE_SERVICES.includes(q.code)).map((q) => q.name)
    if (p.items.length && affected.length) {
      lines.push(`- Phụ phí hải quan theo mặt hàng, CHỈ cộng thêm cho ${affected.join(", ")} (giá trên chưa gồm):`)
      for (const x of p.items) lines.push(`  + ${x.item}: ${x.fee}${x.note ? ` (${x.note})` : ""}`)
    }
  })
  if (parcels.length > 1) {
    const totals = new Map<string, number[]>()
    for (const p of parcels) for (const q of p.quotes) totals.set(q.name, [...(totals.get(q.name) ?? []), q.price])
    const all = [...totals].filter(([, v]) => v.length === parcels.length).map(([n, v]) => [n, v.reduce((a, b) => a + b, 0)] as const)
    if (all.length) lines.push("Tổng các kiện:", ...all.sort((a, b) => a[1] - b[1]).map(([n, t]) => `- ${n}: ${money(t)}`))
  }
  lines.push(
    "Cách báo: báo tối đa 3 dịch vụ rẻ nhất ở trên (khách hỏi hãng nào thì báo hãng đó), kèm thời gian nếu có; ghi rõ giá công bố tham khảo,",
    "chưa gồm phụ phí phát sinh và thuế nhập khẩu tại nước đến. Kích thước \"chưa có\" thì nói giá có thể thay đổi khi cân đo thực tế.",
    "Có dòng phụ phí hải quan theo mặt hàng: ghi rõ mức phụ thu đó ngay cạnh giá của dịch vụ bị áp (đúng chữ và số ở trên, KHÔNG tự nhân ra tổng),",
    "dịch vụ khác không có phụ phí này. Ghi chú \"kiểm tra từng trường hợp\" thì nói nhân viên sẽ xác nhận mức phụ thu.",
    "Không dịch vụ nào có giá hoặc quá mức cân: trả lời đúng một dòng [CHUYEN_NHAN_VIEN]. KHÔNG viết thẻ [TINH_GIA] nữa.",
  )
  return lines.join("\n")
}
