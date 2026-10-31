import { existsSync, readFileSync } from "node:fs"
import { GoogleGenAI } from "@google/genai"
import { getKv, listImages } from "./db.ts"
import type { Message } from "./db.ts"
import { listKnowledgeFiles } from "./import.ts"
import { listPriceServices } from "./price.ts"

/** AI trả về chuỗi này khi không chắc / cần người thật. */
export const HANDOVER_TAG = "[CHUYEN_NHAN_VIEN]"
/** AI thêm "[GUI_ANH:3]" để gửi ảnh số 3, và một dòng "[DON_HANG] ..." khi khách chốt đơn. */
export const IMAGE_TAG = /\[GUI_ANH:(\d+)\]/g
export const ORDER_TAG = "[DON_HANG]"
/** AI thêm "[XIN_SDT]" khi cần số điện thoại: hệ thống gửi nút chia sẻ SĐT, khách bấm là xong, không phải gõ. */
export const PHONE_TAG = "[XIN_SDT]"
/** AI thêm "[KHONG_HOI_THAM]" khi khách không có nhu cầu gửi hàng mới (tra đơn, khiếu nại…): bot không gửi tin hỏi thăm 2 giờ. */
export const NO_FOLLOW_UP_TAG = "[KHONG_HOI_THAM]"

const RULES = `
# QUY TẮC BẮT BUỘC
- Chỉ trả lời dựa trên KHO KIẾN THỨC bên dưới. Không bịa giá, thời gian, chính sách.
- Khách hỏi giá: làm theo mục "BÁO GIÁ CƯỚC QUỐC TẾ" (hệ thống tính giá), KHÔNG chuyển nhân viên.
  Thiếu thông tin (nước đến, tài liệu hay hàng hóa, cân nặng, kích thước) thì hỏi thêm, KHÔNG chuyển nhân viên.
- Khách hỏi gửi một mặt hàng: tra mục hàng cấm và hạn chế. Mức KHÔNG NHẬN thì tự từ chối lịch sự, KHÔNG chuyển nhân viên.
  Mức CÓ ĐIỀU KIỆN thì trước hết xin tên hàng cụ thể, thành phần, số lượng, nước đến và số điện thoại; khách trả lời đủ rồi mới chuyển nhân viên.
- CHỈ chuyển nhân viên khi: khách khiếu nại / bức xúc; hỏi bồi thường; cần tra cứu một đơn hàng cụ thể;
  kết quả tính giá báo không dịch vụ nào có giá hoặc quá mức cân; hàng mức CÓ ĐIỀU KIỆN (đã xin đủ thông tin như trên); khách cần ước tính
  số tiền thuế hoặc hàng đang bị giữ ở hải quan; hoặc câu hỏi hoàn toàn không có trong kho kiến thức.
  Khi đó trả lời ĐÚNG MỘT DÒNG "${HANDOVER_TAG}" và không viết gì khác.
- Tin "(Nhân viên)" trong lịch sử là do nhân viên thật đã trả lời khách. Bạn đang được giao trả lời tiếp,
  hãy hỗ trợ bình thường; có tin nhân viên trước đó KHÔNG phải lý do để chuyển nhân viên.
- Khách đồng ý gửi hàng / chốt giá: xin đủ nước đến, loại hàng, cân nặng, SỐ ĐIỆN THOẠI liên hệ và địa chỉ lấy hàng
  (cái nào khách đã nói thì không hỏi lại). Khi xin số điện thoại: thêm một dòng "${PHONE_TAG}" để hệ thống gửi nút
  "Chia sẻ" (khách bấm là gửi số, không cần gõ) và nói khách có thể bấm nút hoặc gõ số. Tin "[Khách đã chia sẻ thông tin: ...]"
  là thông tin khách vừa gửi qua nút đó. Khi đã đủ: cảm ơn khách, báo nhân viên sẽ gọi xác nhận và hẹn lấy hàng,
  rồi thêm MỘT dòng cuối đúng mẫu (hệ thống tự ẩn dòng này với khách):
  ${ORDER_TAG} Nước đến: ... | Hàng: ... | Cân nặng: ... | Kích thước: ... | Giá báo: ... | SĐT: ... | Lấy hàng: ...
- Khách đang hỏi về đơn đã gửi (tra cứu, mã vận đơn, hàng chậm, thất lạc), khiếu nại, hoặc nói rõ không có nhu cầu gửi hàng:
  thêm MỘT dòng cuối "${NO_FOLLOW_UP_TAG}" (hệ thống tự ẩn, để không nhắn mời chốt đơn với khách này).
- Trả lời ngắn gọn, dưới 1500 ký tự, văn bản thuần (không dùng markdown như ** hay #).`

/** Danh sách ảnh nhân viên đã tải lên, để AI chọn gửi kèm câu trả lời. */
function imageRules() {
  const images = listImages()
  if (!images.length) return ""
  return `\n# ẢNH CÓ THỂ GỬI KHÁCH
Mỗi ảnh có tên và tình huống nên gửi. Khi tình huống của khách khớp, gửi kèm ảnh bằng cách thêm dòng [GUI_ANH:số]
vào cuối câu trả lời (mỗi ảnh một dòng). Chỉ gửi ảnh thật sự liên quan; ảnh đã gửi trong hội thoại
(tin "[Gửi hình ảnh] #số") thì không gửi lại trừ khi khách xin lại. Vẫn trả lời bằng chữ như bình thường.
${images.map((i) => `- [GUI_ANH:${i.id}] ${i.name}${i.usage ? ` — gửi khi: ${i.usage}` : ""}`).join("\n")}`
}

/** Dịch vụ có bảng giá: AI chỉ thu thông tin và viết thẻ, code tra giá (AI tự đọc bảng hay tra nhầm dòng, nhầm vùng). */
function priceRules() {
  const services = listPriceServices()
  if (!services.length) return ""
  return `\n# BÁO GIÁ CƯỚC QUỐC TẾ
Hệ thống có bảng giá: ${services.map((s) => s.name).join("; ")}. Bạn KHÔNG tự tra hay tự tính giá.
Khách hỏi giá: cần nước đến, tài liệu hay hàng hóa, cân nặng thực tế từng kiện, kích thước Dài × Rộng × Cao (cm) từng kiện.
Thiếu thì hỏi thêm. Tài liệu (giấy tờ) thì KHÔNG hỏi kích thước; khách không biết kích thước thì thôi; hai trường hợp này dùng "-".
Đủ rồi thì trả lời CHỈ các dòng thẻ, mỗi kiện một dòng:
[TINH_GIA: mã nước ISO 2 chữ | cân nặng kg | DàixRộngxCao hoặc - | hang hoặc tai_lieu]
Ví dụ: [TINH_GIA: JP | 3 | 40x30x30 | hang]. Nam Trung Quốc (Quảng Châu, Thâm Quyến, Đông Quan, Phúc Kiến, Phúc Châu…) dùng mã CN1.
Hệ thống sẽ tính và đưa lại "KẾT QUẢ TÍNH GIÁ" để bạn viết câu báo giá cho khách.`
}

export type Provider = "gemini" | "openai" | "anthropic"
export type AiConfig = { provider: Provider; model: string; key: string }

export const PROVIDERS: Record<Provider, { label: string; models: string[]; keyUrl: string }> = {
  gemini: { label: "Google Gemini", models: ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-pro-latest"], keyUrl: "https://aistudio.google.com/apikey" },
  openai: { label: "OpenAI (ChatGPT)", models: ["gpt-5-mini", "gpt-5"], keyUrl: "https://platform.openai.com/api-keys" },
  anthropic: { label: "Anthropic (Claude)", models: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"], keyUrl: "https://console.anthropic.com/settings/keys" },
}

/** Cấu hình chọn trong trang admin; chưa chọn thì dùng Gemini trong .env như cũ. */
export function currentConfig(): AiConfig {
  const provider = (getKv("ai_provider") ?? "gemini") as Provider
  const envKey = provider === "gemini" ? process.env.GEMINI_API_KEY : undefined
  const envModel = provider === "gemini" ? process.env.GEMINI_MODEL : undefined
  return {
    provider,
    model: getKv("ai_model") || envModel || PROVIDERS[provider].models[0],
    key: getKv(`ai_key_${provider}`) || envKey || "",
  }
}

type Turn = { role: "user" | "model"; text: string }

/** Kho kiến thức chính (ô soạn trong trang admin). Không đưa lên Git; máy mới clone, chưa nạp file nào thì dùng file mẫu. */
export function readMainKnowledge() {
  if (existsSync("data/knowledge.md")) return readFileSync("data/knowledge.md", "utf8")
  return listKnowledgeFiles().length ? "" : readFileSync("data/knowledge.example.md", "utf8")
}

/** Toàn bộ kiến thức AI dùng: kho chính rồi từng file đã nạp (thứ tự cố định để cache trúng). */
export const readKnowledge = () =>
  [readMainKnowledge().trim(), ...listKnowledgeFiles().map((f) => `## ${f.name}\n${f.text.trim()}`)].filter(Boolean).join("\n\n")

/** extra: hướng dẫn thêm cho riêng lần gọi này (thông tin khách, tình huống đặc biệt). */
export async function generateReply(history: Message[], cfg = currentConfig(), extra = ""): Promise<string> {
  if (!cfg.key) throw new Error(`Chưa nhập API key cho ${PROVIDERS[cfg.provider].label}`)
  // Đọc file mỗi lần để sửa trong trang admin là có hiệu lực ngay.
  // Phần cố định (giọng văn, quy tắc, ảnh, kho kiến thức) đứng trước, phần riêng từng khách (extra) đứng cuối:
  // AI lưu cache phần đầu giống nhau giữa các lần gọi → kho kiến thức tính rẻ hơn nhiều và trả lời nhanh hơn.
  const fixed = `${readFileSync("data/prompt.md", "utf8")}\n${RULES}${priceRules()}${imageRules()}\n\n# KHO KIẾN THỨC\n${readKnowledge()}`
  const system = { fixed, extra: extra.trim() ? `\n\n# THÔNG TIN RIÊNG CHO LẦN TRẢ LỜI NÀY\n${extra.trim()}` : "" }

  // Các hãng đều cần lượt user/model xen kẽ, bắt đầu bằng user: gộp các tin liền nhau cùng vai.
  const turns: Turn[] = []
  for (const m of history) {
    const role = m.role === "user" ? "user" : "model"
    const text = m.role === "staff" ? `(Nhân viên) ${m.text}` : m.text
    const last = turns.at(-1)
    if (last?.role === role) last.text += `\n${text}`
    else turns.push({ role, text })
  }
  while (turns[0]?.role === "model") turns.shift()
  // Phải kết thúc bằng lượt của khách (Gemini báo lỗi nếu cuối là bot), ví dụ khi bot nhận lại khách sau câu chuyển nhân viên.
  while (turns.at(-1)?.role === "model") turns.pop()

  // Zalo không hiển thị markdown: bỏ ** mà model đôi khi vẫn dùng.
  return (await CALL[cfg.provider](cfg, system, turns)).replaceAll("**", "").trim()
}

// Quá 60s thì báo lỗi → bot chuyển nhân viên thay vì để khách chờ mãi.
const TIMEOUT = 60_000

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${res.status} ${data.error?.message ?? res.statusText}`)
  return data
}

type System = { fixed: string; extra: string }

// Gemini và OpenAI tự cache phần đầu prompt trùng nhau; Claude cần đánh dấu cache_control.
const CALL: Record<Provider, (cfg: AiConfig, system: System, turns: Turn[]) => Promise<string>> = {
  async gemini(cfg, system, turns) {
    const client = new GoogleGenAI({ apiKey: cfg.key, httpOptions: { timeout: TIMEOUT } })
    const res = await client.models.generateContent({
      model: cfg.model,
      contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      config: { systemInstruction: system.fixed + system.extra, temperature: 0.3 },
    })
    return res.text ?? ""
  },
  // Không gửi temperature cho OpenAI/Claude: một số model mới chỉ nhận giá trị mặc định.
  async openai(cfg, system, turns) {
    const data = await postJson("https://api.openai.com/v1/chat/completions", { Authorization: `Bearer ${cfg.key}` }, {
      model: cfg.model,
      messages: [{ role: "system", content: system.fixed + system.extra }, ...turns.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text }))],
    })
    return data.choices?.[0]?.message?.content ?? ""
  },
  async anthropic(cfg, system, turns) {
    const data = await postJson("https://api.anthropic.com/v1/messages", { "x-api-key": cfg.key, "anthropic-version": "2023-06-01" }, {
      model: cfg.model,
      max_tokens: 1024,
      system: [
        { type: "text", text: system.fixed, cache_control: { type: "ephemeral" } },
        ...(system.extra ? [{ type: "text", text: system.extra }] : []),
      ],
      messages: turns.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text })),
    })
    return (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
  },
}
