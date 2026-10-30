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
  assert.match(text, /ABC: 150\.000đ \(thời gian 2-3 ngày\)/)
  assert.match(text, /kích thước chưa có/)
  assert.match(text, /Tổng các kiện:\n- ABC: 300\.000đ/)
})
