// Gửi ZBS Template Message (trước đây là ZNS) tới số điện thoại khách.
// Theo thông báo V251209 của Zalo: gửi qua SĐT vẫn dùng API ZNS hiện tại, mẫu tin phải được duyệt trước.
import * as db from "./db.ts"
import * as zalo from "./zalo.ts"

const BIZ = "https://business.openapi.zalo.me"

/** Tạm ẩn khi chưa có mẫu tin được duyệt; bật lại bằng ZNS_ENABLED=1 trong .env. */
export const ENABLED = process.env.ZNS_ENABLED === "1"

export type TemplateParam = { name: string; require: boolean; maxLength?: number }
export type Template = { id: string; name: string; tag: string; price?: number; preview?: string; params: TemplateParam[] }

export const TAG_LABEL: Record<string, string> = {
  TRANSACTION: "Giao dịch",
  CUSTOMER_CARE: "Chăm sóc khách hàng",
  PROMOTION: "Hậu mãi",
}

/** "0912 345 678", "+84912345678", "912345678" → "84912345678"; sai định dạng → null. */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "")
  if (d.startsWith("0")) d = `84${d.slice(1)}`
  else if (d.length === 9) d = `84${d}`
  return /^84[35789]\d{8}$/.test(d) ? d : null
}

/** Mỗi dòng: "SĐT, Tên" (tên không bắt buộc, ngăn cách bằng dấu phẩy, chấm phẩy hoặc tab). */
export function parseList(text: string) {
  const valid: { phone: string; name: string }[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const [rawPhone, ...rest] = line.split(/[,;\t]/)
    const phone = normalizePhone(rawPhone)
    if (!phone) invalid.push(line)
    else if (!seen.has(phone)) {
      seen.add(phone)
      valid.push({ phone, name: rest.join(" ").trim() })
    }
  }
  return { valid, invalid }
}

/** Zalo (V261001): tin Chăm sóc khách hàng và Hậu mãi chỉ gửi 7h–22h; tin Giao dịch gửi mọi lúc. */
export function allowedNow(tag: string, now = new Date()): boolean {
  if (tag === "TRANSACTION") return true
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "numeric", hourCycle: "h23" }).format(now))
  return hour >= 7 && hour < 22
}

async function bizGet(path: string) {
  return zalo.zaloFetch(`${BIZ}${path}`, { headers: { access_token: await zalo.accessToken() } })
}

/** Các mẫu đã được duyệt (status=1) của OA. */
export async function listTemplates(): Promise<{ id: string; name: string }[]> {
  const r = await bizGet("/template/all?offset=0&limit=100&status=1")
  return (r.data ?? []).map((t: any) => ({ id: String(t.templateId), name: String(t.templateName ?? t.templateId) }))
}

export async function templateInfo(id: string): Promise<Template> {
  const d = (await bizGet(`/template/info/v2?template_id=${encodeURIComponent(id)}`)).data ?? {}
  return {
    id,
    name: String(d.templateName ?? id),
    // Không rõ loại thì coi như Hậu mãi để luôn tôn trọng khung giờ 7h–22h.
    tag: TAG_LABEL[d.templateTag] ? d.templateTag : "PROMOTION",
    price: d.price === undefined ? undefined : Number(d.price),
    preview: d.previewUrl,
    params: (d.listParams ?? []).map((p: any) => ({ name: String(p.name), require: !!p.require, maxLength: p.maxLength })),
  }
}

async function sendOne(job: db.ZnsJob): Promise<string | undefined> {
  const r = await zalo.zaloFetch(`${BIZ}/message/template`, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: await zalo.accessToken() },
    body: JSON.stringify({ phone: job.phone, template_id: job.template_id, template_data: JSON.parse(job.data), tracking_id: `job-${job.id}` }),
  })
  return r.data?.msg_id
}

// Gửi lần lượt, 1 tin mỗi 2 giây.
// ponytail: 1 tin/2s ≈ 1.800 tin/giờ, đủ cho danh sách vài nghìn số; cần nhanh hơn thì gửi song song theo lô
let busy = false
async function tick() {
  if (busy) return
  busy = true
  try {
    const job = db.nextZnsJob()
    if (!job || !allowedNow(job.tag)) return // ngoài khung giờ: giữ nguyên, chờ tới giờ cho phép
    if (db.isOptedOut(job.phone)) return db.finishZnsJob(job.id, "skipped", "Khách từ chối nhận tin")
    try {
      db.finishZnsJob(job.id, "sent", null, await sendOne(job))
    } catch (err) {
      db.finishZnsJob(job.id, "failed", (err instanceof Error ? err.message : String(err)).slice(0, 300))
    }
  } finally {
    busy = false
  }
}

export function startWorker() {
  setInterval(tick, 2000).unref()
}
