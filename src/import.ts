import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { inflateRawSync } from "node:zlib"

/** Định dạng nhận khi nạp kho kiến thức từ file (trang "Kiến thức & giọng văn"). */
export const KNOWLEDGE_EXT = [".md", ".txt", ".csv", ".docx", ".xlsx"]

/** Mỗi file nạp vào lưu riêng (đã đổi sang chữ) để xem lại và xóa từng file; AI đọc gộp sau kho kiến thức chính. */
export const KNOWLEDGE_DIR = "data/knowledge-files"
export type KnowledgeFile = { name: string; text: string; updated: number }

export function listKnowledgeFiles(): KnowledgeFile[] {
  if (!existsSync(KNOWLEDGE_DIR)) return []
  return readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith(".md")).sort().map((f) => ({
    name: f.slice(0, -3),
    text: readFileSync(`${KNOWLEDGE_DIR}/${f}`, "utf8"),
    updated: statSync(`${KNOWLEDGE_DIR}/${f}`).mtimeMs,
  }))
}

/** Lưu theo tên file gốc (bỏ đuôi); nạp lại file cùng tên thì thay bản cũ. Trả về tên đã lưu và có thay bản cũ không. */
export function saveKnowledgeFile(fileName: string, text: string) {
  const name = fileName.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 100) || "file"
  const path = `${KNOWLEDGE_DIR}/${name}.md`
  const replaced = existsSync(path)
  mkdirSync(KNOWLEDGE_DIR, { recursive: true })
  writeFileSync(path, `${text.trim()}\n`)
  return { name, replaced }
}

/** Chỉ xóa đúng tên đang có trong danh sách (không nhận đường dẫn lạ). */
export function deleteKnowledgeFile(name: string) {
  if (!listKnowledgeFiles().some((f) => f.name === name)) return false
  rmSync(`${KNOWLEDGE_DIR}/${name}.md`)
  return true
}

/** Đổi file tải lên thành văn bản cho kho kiến thức. Lỗi thì ném Error với lời nhắn tiếng Việt cho nhân viên. */
export function fileToText(name: string, buf: Buffer): string {
  const ext = name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ""
  if (ext === ".docx") return docxText(buf)
  if (ext === ".xlsx") return xlsxText(buf)
  if (![".md", ".txt", ".csv"].includes(ext)) {
    throw new Error(`Chưa đọc được file ${ext || "không có đuôi"}. Nhận ${KNOWLEDGE_EXT.join(", ")}; file PDF hãy mở bằng Word rồi lưu dạng .docx.`)
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "")
  } catch {
    throw new Error("File không phải mã UTF-8 nên sẽ lỗi dấu tiếng Việt. Excel: Lưu thành → \"CSV UTF-8\"; Notepad: Lưu thành → Mã hóa UTF-8.")
  }
}

/** Đọc một file bên trong file zip (.docx/.xlsx đều là zip), khỏi cần thư viện. */
function unzipEntry(buf: Buffer, name: string): string | undefined {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) return
  let p = buf.readUInt32LE(end + 16)
  for (let i = buf.readUInt16LE(end + 10); i > 0; i--) {
    const nameLen = buf.readUInt16LE(p + 28)
    if (buf.toString("utf8", p + 46, p + 46 + nameLen) === name) {
      const local = buf.readUInt32LE(p + 42)
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + buf.readUInt32LE(p + 20))
      return (buf.readUInt16LE(p + 10) === 8 ? inflateRawSync(data) : data).toString("utf8")
    }
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
  }
}

const unxml = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(x?)([0-9a-f]+);/gi, (_, x, n) => String.fromCodePoint(parseInt(n, x ? 16 : 10))).replace(/&amp;/g, "&")

/** Word: mỗi đoạn một dòng, bảng thành dòng "ô | ô | ô". */
function docxText(buf: Buffer) {
  const xml = unzipEntry(buf, "word/document.xml")
  if (!xml) throw new Error("Không đọc được file Word này. Hãy lưu lại dạng .docx rồi tải lên.")
  const text = unxml(
    xml.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tc>/g, "\u0001").replace(/<\/w:tr>/g, "\n"),
  )
  return text.replace(/\n*\u0001/g, " | ").replace(/ \| \n/g, "\n").replace(/ \| $/, "").replace(/\n{3,}/g, "\n\n").trim()
}

/** Excel: từng trang tính thành "## Tên trang", mỗi hàng một dòng "ô | ô | ô". */
function xlsxText(buf: Buffer) {
  return xlsxSheets(buf).map(({ name, rows }) => {
    const lines = rows.map((r) => r.join(" | ").replace(/( \| )+$/, "")).filter((r) => r.replace(/[ |]/g, ""))
    return `## ${name}\n${lines.join("\n")}`
  }).join("\n\n")
}

/** Các trang tính của file Excel; ô đặt đúng vị trí theo địa chỉ (A1, C5…), ô trống là "". */
export function xlsxSheets(buf: Buffer): { name: string; rows: string[][] }[] {
  const book = unzipEntry(buf, "xl/workbook.xml")
  if (!book) throw new Error("Không đọc được file Excel này. Hãy lưu lại dạng .xlsx rồi tải lên.")
  const shared = [...(unzipEntry(buf, "xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml(m[1]))
  // Tên trang → file trang tính theo workbook.xml.rels; file thiếu rels thì đoán sheetN.xml theo thứ tự.
  const rels = new Map(
    [...(unzipEntry(buf, "xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)]
      .map(([, id, target]) => [id, target.startsWith("/") ? target.slice(1) : `xl/${target}`]),
  )
  return [...book.matchAll(/<sheet [^>]*?name="([^"]*)"[^>]*>/g)].map((m, i) => {
    const file = rels.get(m[0].match(/r:id="([^"]+)"/)?.[1] ?? "") ?? `xl/worksheets/sheet${i + 1}.xml`
    const rows: string[][] = []
    for (const r of (unzipEntry(buf, file) ?? "").matchAll(/<row([^>]*)>([\s\S]*?)<\/row>/g)) {
      const row: string[] = []
      for (const [, attrs, body = ""] of r[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? ""
        const col = [...(attrs.match(/r="([A-Z]+)/)?.[1] ?? "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
        row[col >= 0 ? col : row.length] = /t="s"/.test(attrs) ? shared[Number(v)] ?? "" : unxml(v)
      }
      const at = Number(r[1].match(/r="(\d+)"/)?.[1] ?? rows.length + 1) - 1
      rows[at] = Array.from(row, (c) => c ?? "")
    }
    return { name: unxml(m[1]), rows: Array.from(rows, (r) => r ?? []) }
  })
}
