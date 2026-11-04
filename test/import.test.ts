import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { deflateRawSync } from "node:zlib"
import { deleteKnowledgeFile, fileToText, listKnowledgeFiles, saveKnowledgeFile } from "../src/import.ts"

/** Tạo file zip tối thiểu (nén deflate như Word/Excel) để thử đọc .docx/.xlsx. */
function zip(files: Record<string, string>) {
  const locals: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text)), n = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(n.length, 26)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(8, 10); dir.writeUInt32LE(data.length, 20); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42)
    locals.push(local, n, data); central.push(dir, n)
    offset += 30 + n.length + data.length
  }
  const size = central.reduce((s, b) => s + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...central, end])
}

test("đọc .md giữ nguyên, bỏ BOM; file không UTF-8 thì báo lỗi dễ hiểu", () => {
  assert.equal(fileToText("gia.md", Buffer.from("﻿# Giá\n| A | B |")), "# Giá\n| A | B |")
  assert.throws(() => fileToText("gia.csv", Buffer.from([0x47, 0xe1, 0x20])), /UTF-8/)
  assert.throws(() => fileToText("gia.pdf", Buffer.from("x")), /PDF/)
})

test("đọc Word: đoạn văn và bảng", () => {
  const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`
  const cell = (t: string) => `<w:tc>${p(t)}</w:tc>`
  const xml = `<w:document><w:body>${p("Quy định &amp; đóng gói")}<w:tbl><w:tr>${cell("Nước")}${cell("Zone")}</w:tr><w:tr>${cell("Japan")}${cell("2")}</w:tr></w:tbl></w:body></w:document>`
  assert.equal(fileToText("qd.docx", zip({ "word/document.xml": xml })), "Quy định & đóng gói\nNước | Zone\nJapan | 2")
})

test("đọc Excel: mỗi trang một mục, mỗi hàng một dòng", () => {
  const xlsx = zip({
    "xl/workbook.xml": '<workbook><sheets><sheet name="Giá DHL" sheetId="1"/></sheets></workbook>',
    "xl/sharedStrings.xml": "<sst><si><t>Kg</t></si><si><t>Zone 1</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2"><v>0.5</v></c><c r="B2"><v>500000</v></c><c r="C2" s="1"/></row></sheetData>',
  })
  assert.equal(fileToText("gia.xlsx", xlsx), "## Giá DHL\nKg | Zone 1\n0.5 | 500000")
})

test("file đã nạp: lưu riêng, nạp lại cùng tên thì thay, AI đọc gộp sau kho chính, xóa đúng tên", async () => {
  process.env.DB_PATH = ":memory:"
  process.chdir(mkdtempSync(join(tmpdir(), "kfiles-")))
  mkdirSync("data")
  writeFileSync("data/knowledge.md", "# Kho chính\n")
  assert.deepEqual(saveKnowledgeFile("Giá UPS.xlsx", "UPS 1kg"), { name: "Giá UPS", replaced: false })
  saveKnowledgeFile("A/../b.md", "đóng gói")
  assert.deepEqual(saveKnowledgeFile("Giá UPS.md", "UPS 2kg"), { name: "Giá UPS", replaced: true })
  assert.deepEqual(listKnowledgeFiles().map((f) => f.name), ["A_.._b", "Giá UPS"])
  const { readKnowledge } = await import("../src/ai.ts")
  assert.equal(readKnowledge(), "# Kho chính\n\n## A_.._b\nđóng gói\n\n## Giá UPS\nUPS 2kg")
  assert.equal(deleteKnowledgeFile("../knowledge"), false)
  assert.equal(deleteKnowledgeFile("Giá UPS"), true)
  assert.deepEqual(listKnowledgeFiles().map((f) => f.name), ["A_.._b"])
})

test("bảng giá Excel: nhận diện, tính cước trọn gói / theo kg / quy đổi kích thước / tài liệu", async () => {
  const { parsePriceWorkbook, quote, priceResult } = await import("../src/price.ts")
  const c = (ref: string, v: string | number) =>
    typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`
  const sheet = (rows: string[]) => `<worksheet><sheetData>${rows.join("")}</sheetData></worksheet>`
  const head = [
    `<row r="1">${c("A1", "Zone Code")}${c("C1", "Z01")}${c("D1", "Z02")}</row>`,
    `<row r="2">${c("A2", "Countries")}${c("C2", "JP,KH1")}${c("D2", "US")}</row>`,
    `<row r="4">${c("A4", "Time Line")}${c("C4", "2-3 days")}</row>`,
  ]
  const xlsx = zip({
    "xl/workbook.xml": '<workbook><sheets><sheet name="X#THU" sheetId="1" r:id="rId9"/><sheet name="X#HANG" sheetId="2" r:id="rId8"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId8" Target="worksheets/hang.xml"/><Relationship Id="rId9" Target="worksheets/thu.xml"/></Relationships>',
    "xl/worksheets/thu.xml": sheet([...head, `<row r="6">${c("A6", 0.5)}${c("B6", 0)}${c("C6", 50000)}${c("D6", 60000)}</row>`]),
    "xl/worksheets/hang.xml": sheet([...head,
      `<row r="6">${c("A6", 0.5)}${c("B6", 0)}${c("C6", 100000)}${c("D6", 200000)}</row>`,
      `<row r="7">${c("A7", 1)}${c("B7", 0)}${c("C7", 150000.4)}${c("D7", 250000)}</row>`,
      `<row r="8">${c("A8", 20)}${c("B8", 1)}${c("C8", 10000)}${c("D8", 20000)}</row>`]),
  })
  assert.equal(parsePriceWorkbook("bao-cao.xlsx", zip({ "xl/workbook.xml": '<workbook><sheets><sheet name="A"/></sheets></workbook>' })), null)
  const s = parsePriceWorkbook("CHUAN_MB_ABC_2026_06_15.xlsx", xlsx)!
  assert.equal(s.code, "ABC")
  assert.deepEqual(s.goods.zones.map((z) => [z.name, z.codes, z.time]), [["Z01", ["JP", "KH"], "2-3 ngày"], ["Z02", ["US"], ""]])
  const price = (country: string, kg: number, dims?: number[], doc = false) => quote(country, kg, dims, doc, [s]).quotes[0]?.price ?? null
  assert.equal(price("JP", 0.7), 150000) // làm tròn lên 1 kg, giá trọn gói, làm tròn đồng
  assert.equal(price("jp", 1.2), 20000) // vượt mốc trọn gói: 2 kg × 10.000
  assert.equal(price("JP", 5, [40, 30, 29.2]), 80000) // quy đổi 40×30×30/5000 = 7,2 → 7,5 → 8 kg × 10.000
  assert.equal(price("KH1", 0.5), 100000)
  assert.equal(price("US", 0.5, undefined, true), 60000) // tài liệu
  assert.equal(price("US", 1, undefined, true), 250000) // tài liệu nặng hơn bảng tài liệu → bảng hàng
  assert.equal(price("XX", 1), null)
  assert.deepEqual(quote("JP", 25, undefined, false, [s]).tooHeavy, ["ABC"])
  const text = priceResult("[TINH_GIA: JP | 0,7 | - | hang]\n[TINH_GIA: JP | 1 | - | hang]", [s])
  assert.match(text, /ABC: TỔNG 162\.000đ = cước 150\.000đ \+ VAT 8% 12\.000đ \(thời gian 2-3 ngày\)/)
  assert.match(text, /kích thước chưa có/)
  assert.match(text, /Tổng các kiện:\n- ABC: 324\.000đ/)
})

test("bảng giá: mốc khoảng cân lẻ 0,5 (DHL Việt Nam) thì tính theo bước 0,5 kg, mốc chẵn thì làm tròn lên 1 kg", async () => {
  const { quote } = await import("../src/price.ts")
  const table = (bands: number[]) => ({
    zones: [{ name: "Z1", codes: ["JP"], time: "" }],
    rows: [{ kg: 30, perKg: false, prices: [3_000_000] }, ...bands.map((kg) => ({ kg, perKg: true, prices: [100_000] }))],
  })
  const svc = (code: string, bands: number[]) => ({ code, name: code, file: "", updated: 0, goods: table(bands) })
  const price = (s: ReturnType<typeof svc>, kg: number) => quote("JP", kg, undefined, false, [s as any]).quotes[0].price
  assert.equal(price(svc("VDHL", [49.5, 69.5]), 30.5), 3_050_000) // 30,5 kg × 100.000
  assert.equal(price(svc("VDHL", [49.5, 69.5]), 49.6), 5_000_000) // làm tròn 50 kg, khoảng 69,5
  assert.equal(price(svc("UPS", [44, 70]), 30.5), 3_100_000) // làm tròn lên 31 kg

  // Phụ phí xăng dầu theo từng dịch vụ: dịch vụ không nhập % thì giữ cước gốc.
  const fuel = { pct: { SDHL: 49.5, CTQ: 28 }, from: "", to: "", updated: 0 }
  const q = quote("JP", 1, undefined, false, [svc("SDHL", [70]) as any, svc("UPS", [70]) as any], fuel).quotes
  assert.deepEqual(q.map((x) => [x.code, x.base, x.fuel, x.price]), [["UPS", 3_000_000, null, 3_000_000], ["SDHL", 3_000_000, 49.5, 4_485_000]])
})

test("phụ phí hải quan theo mặt hàng: đọc bảng trong file kiến thức, chỉ ghi cho chuyên tuyến CTQ/CTU", async () => {
  const { itemSurcharges, priceResult } = await import("../src/price.ts")
  const text = `# 06\n## 8. PHỤ PHÍ HẢI QUAN THEO MẶT HÀNG\n| STT | Mặt hàng | Phụ thu | Ghi chú |\n|---|---|---|---|
| 7 | Mỹ phẩm; thuốc lá | 30.000 đ/kg | **Myanmar: 50.000 đ/kg** |\n| 14 | Nước hoa | 300.000 đ/kiện | |\n\n## 9. MẪU\n| 99 | Không phải bảng | x | |`
  // File trước chỉ nhắc tới cụm chữ trong câu văn (không có bảng): bỏ qua, lấy bảng thật ở file sau.
  const table = itemSurcharges([{ name: "01", text: "Giá đã gồm **phụ phí hải quan theo mặt hàng** (chuyên tuyến).", updated: 0 }, { name: "06", text, updated: 0 }])
  assert.deepEqual(table.map((x) => x.no), ["7", "14"])
  assert.equal(table[0].note, "Myanmar: 50.000 đ/kg")
  const goods = { zones: [{ name: "Z1", codes: ["JP"], time: "" }], rows: [{ kg: 30, perKg: false, prices: [500_000] }] }
  const svc = (code: string) => ({ code, name: code, file: "", updated: 0, goods }) as any
  const out = priceResult("[TINH_GIA: JP | 3 | - | hang | 7,14]", [svc("CTU"), svc("UPS")], table)
  // Phụ thu cộng vào tổng chỉ cho chuyên tuyến: 30.000 đ/kg × 3 kg + 300.000 đ/kiện, rồi VAT 8% trên cả cước và phụ thu.
  assert.match(out, /- CTU: TỔNG 961\.200đ = cước 500\.000đ \+ phụ thu mỹ phẩm 90\.000đ \+ phụ thu nước hoa 300\.000đ \+ VAT 8% 71\.200đ/)
  assert.match(out, /- UPS: TỔNG 540\.000đ = cước 500\.000đ \+ VAT 8% 40\.000đ\n/)
  assert.doesNotMatch(priceResult("[TINH_GIA: JP | 3 | - | hang | -]", [svc("CTU")], table), /= cước.*phụ thu/)
})

test("câu báo giá dự phòng: 3 dịch vụ rẻ nhất, phụ thu mặt hàng chỉ ghi cho chuyên tuyến", async () => {
  const { priceFallback } = await import("../src/price.ts")
  const goods = (price: number) => ({ zones: [{ name: "Z1", codes: ["JP"], time: "" }], rows: [{ kg: 30, perKg: false, prices: [price] }] })
  const svc = (code: string, price: number) => ({ code, name: code, file: "", updated: 0, goods: goods(price) }) as any
  const items = [{ no: "7", item: "Mỹ phẩm", fee: "30.000 đ/kg", note: "" }]
  const text = priceFallback("[TINH_GIA: JP | 5 | - | hang | 7]", [svc("UPS", 300), svc("CTU", 200), svc("FED", 400), svc("SDHL", 500)], items)
  // CTU cước rẻ nhất nhưng cộng phụ thu 150.000đ thì đắt nhất: xếp theo tổng.
  assert.match(text, /- UPS: 324đ \(cước 300đ \+ VAT 8% 24đ\)\n- FED: 432đ \(cước 400đ \+ VAT 8% 32đ\)\n- SDHL: 540đ/)
  assert.equal(priceFallback("[TINH_GIA: XX | 5 | - | hang | -]", [svc("UPS", 300)], items), "")
})

test("phụ thu mặt hàng: lấy đúng bậc cân trong ghi chú, theo chiếc thì báo từ", async () => {
  const { itemFee } = await import("../src/price.ts")
  const pin = { no: "4", item: "Pin kèm thiết bị", fee: "300.000–700.000 đ/kiện", note: "1–5 kg: 300k; 5–22 kg: 500k; 22–30 kg: 700k" }
  assert.deepEqual(itemFee(pin, 0.5), { amount: 300_000, from: false })
  assert.deepEqual(itemFee(pin, 8), { amount: 500_000, from: false })
  assert.deepEqual(itemFee({ no: "3", item: "Đồng hồ fake", fee: "100.000 đ/cái", note: "" }, 2), { amount: 100_000, from: true })
  assert.equal(itemFee({ no: "9", item: "X", fee: "kiểm tra từng trường hợp", note: "" }, 2), null)
})

test("tự nhận nhóm phụ thu từ tin khách: mỹ phẩm, điện thoại → pin; quần áo thường không tính hàng fake", async () => {
  const { itemsInText, withItems } = await import("../src/price.ts")
  const table = [
    { no: "2", item: "Đồng hồ thường; hàng fake thương hiệu (quần áo, túi, mắt kính)", fee: "50.000 đ/chiếc", note: "" },
    { no: "4", item: "Pin kèm thiết bị, loa nhỏ cỡ lòng bàn tay", fee: "300.000–700.000 đ/kiện", note: "1–5 kg: 300k" },
    { no: "7", item: "Thuốc nam, đông y; mỹ phẩm; thuốc lá", fee: "30.000 đ/kg", note: "" },
  ]
  assert.deepEqual(itemsInText("gửi 2kg mỹ phẩm đi Mỹ", table), ["7"])
  assert.deepEqual(itemsInText("gửi 1 cái iPhone đi Úc", table), ["4"])
  assert.deepEqual(itemsInText("gửi 5kg quần áo đi Nhật", table), [])
  // "báo giá", "giấy tờ" không phải nhóm Sách, báo, giấy.
  const books = [{ no: "25", item: "Sách, báo, tạp chí, giấy", fee: "10.000 đ/kg", note: "" }]
  assert.deepEqual(itemsInText("báo giá giúp em 2kg quần áo, kèm giấy tờ", books), [])
  assert.deepEqual(itemsInText("gửi 3kg sách đi Mỹ", books), ["25"])
  assert.equal(withItems("[TINH_GIA: US | 2 | 30x20x15 | hang | -]", "2kg mỹ phẩm", table), "[TINH_GIA: US | 2 | 30x20x15 | hang | 7]")
  assert.equal(withItems("[TINH_GIA: US | 0,3 | - | tai_lieu]", "thư và mỹ phẩm", table), "[TINH_GIA: US | 0,3 | - | tai_lieu]")

  // Hàng có pin: không báo UPS và DHL qua Singapore (2 hãng không nhận pin).
  const { priceResult } = await import("../src/price.ts")
  const goods = { zones: [{ name: "Z1", codes: ["US"], time: "" }], rows: [{ kg: 30, perKg: false, prices: [1_000_000] }] }
  const svcs = ["UPS", "SDHL", "FED", "CTU"].map((code) => ({ code, name: code, file: "", updated: 0, goods }) as any)
  const out = priceResult("[TINH_GIA: US | 1 | - | hang | 4]", svcs, table)
  assert.deepEqual([...out.matchAll(/^- (\w+): TỔNG/gm)].map((m) => m[1]), ["FED", "CTU"])
})

test("tra vận đơn: đọc các mốc hành trình (mới nhất trước), mã không có thì báo kiểm tra lại", async () => {
  const { parseTracking, trackResult } = await import("../src/tracking.ts")
  const li = (date: string, title: string, place: string, desc: string) => `<li class="timeline-item x" data-status="A">
<div class="timeline-time"><span class="timeline-day">Thứ Hai</span><span class="timeline-date">${date}</span></div>
<div class="timeline-content"><div class="title"> ${title} </div>${place ? `<div class="location"> ${place} </div>` : ""}<div class="desc"> ${desc} </div></div></li>`
  const html = `<div class="shipping-info"><ul class="tf-list-items"><li><span>Nước gửi:</span> Việt Nam</li></ul></div>
<div class="tracking-details"><ul class="timeline">${li("02-11-2026 18:43", "Đang vận chuyển", "", "Departed &amp; sent")}${li("27-10-2026 11:06", "Kết nối", "HUB HA NOI, VN", "Đã kết nối")}</ul></div>`
  const t = parseTracking("607211381", html)!
  assert.deepEqual(t.info, ["Nước gửi: Việt Nam"])
  assert.deepEqual(t.events[0], { time: "02-11-2026 18:43", title: "Đang vận chuyển", place: "", desc: "Departed & sent" })
  assert.equal(t.events[1].place, "HUB HA NOI, VN")
  assert.equal(parseTracking("1", "Không thể lấy thông tin vận đơn. Vui lòng thử lại sau."), null)
  const r = await trackResult("[TRA_DON: 607211381]\n[TRA_DON: 999]\n[TRA_DON: 12345]", async (code) => (code === "607211381" ? t : null))
  assert.match(r.forAi, /Mã 607211381 \(Nước gửi: Việt Nam\): CHƯA GIAO XONG – hệ thống đã tự theo dõi mã này\n- MỚI NHẤT: 02-11-2026 18:43 \| Đang vận chuyển \| Departed & sent/)
  assert.match(r.forAi, /Mã 12345: KHÔNG tìm thấy/)
  assert.doesNotMatch(r.forAi, /Mã 999/) // quá ngắn, không phải mã vận đơn
  assert.match(r.forCustomer, /^Dạ mã vận đơn 607211381: Đang vận chuyển \(cập nhật 02-11-2026 18:43\)/)
})

test("nhận vùng từ tỉnh/thành khách nói, có dấu hay không dấu", async () => {
  const { regionFromText } = await import("../src/region.ts")
  assert.equal(regionFromText("mình ở Nghệ An muốn gửi đồ đi Nhật"), "trung")
  assert.equal(regionFromText("shop ở Sài Gòn"), "nam")
  assert.equal(regionFromText("nha o can tho"), "nam") // miền Tây tính vào miền Nam
  assert.equal(regionFromText("Hà Nội ạ"), "bac")
  assert.equal(regionFromText("tôi ở Hà Nam"), "bac") // "Nam" trong tên tỉnh không phải miền Nam
  assert.equal(regionFromText("Đà Lạt, Lâm Đồng"), "trung")
  assert.equal(regionFromText("gửi 3kg đi Mỹ"), null)
  assert.equal(regionFromText("hàng ở Hà Nội nhưng người gửi ở Cần Thơ"), null) // nhắc 2 vùng thì không đoán
})

test("khách gõ chữ miền: miền Tây tính miền Nam", async () => {
  const { regionFromText } = await import("../src/region.ts")
  assert.equal(regionFromText("tôi ở miền Tây"), "nam")
  assert.equal(regionFromText("bên mình miền trung"), "trung")
})
