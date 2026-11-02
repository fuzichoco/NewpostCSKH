import * as db from "./db.ts"
import * as zalo from "./zalo.ts"

// Báo cho nhân viên khi có khách nhắn: qua Zalo cá nhân (nhân viên quan tâm OA, OA nhắn tư vấn cho họ)
// và/hoặc nhóm Telegram (bot Telegram của công ty).

/** Zalo ID các nhân viên nhận thông báo. Zalo chỉ cho OA nhắn trong 48 giờ kể từ lần cuối nhân viên nhắn OA. */
export function staffIds(): string[] {
  try {
    return JSON.parse(db.getKv("notify_zalo") ?? "[]")
  } catch {
    return []
  }
}

export function setStaff(userId: string, on: boolean) {
  const ids = staffIds().filter((x) => x !== userId)
  if (on) ids.push(userId)
  db.setKv("notify_zalo", JSON.stringify(ids))
}

async function telegramApi(token: string, method: string, body?: object): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown }
  if (!data.ok) throw new Error(`Telegram báo lỗi: ${data.description ?? res.status}`)
  return data.result
}

/** Nhóm (hoặc chat riêng) gần nhất vừa nhắn cho bot Telegram: dùng để tự lấy chat ID, khỏi bắt người dùng tra. */
export async function findTelegramChat(token: string): Promise<{ id: string; title: string } | null> {
  const updates = (await telegramApi(token, "getUpdates")) as any[]
  for (const u of updates.reverse()) {
    const chat = (u.message ?? u.my_chat_member ?? u.channel_post ?? u.edited_message)?.chat
    if (chat) return { id: String(chat.id), title: chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(" ") }
  }
  return null
}

export async function sendTelegram(text: string, token = db.getKv("tg_token"), chat = db.getKv("tg_chat")) {
  if (token && chat) await telegramApi(token, "sendMessage", { chat_id: chat, text, disable_web_page_preview: true })
}

/** Gửi tới mọi kênh đã cài; kênh nào lỗi chỉ ghi log, không chặn kênh khác. Trả về danh sách lỗi. */
export async function notifyStaff(text: string): Promise<string[]> {
  const jobs = [sendTelegram(text), ...staffIds().map((id) => zalo.sendText(id, text))]
  const errors: string[] = []
  for (const r of await Promise.allSettled(jobs)) {
    if (r.status === "rejected") errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
  }
  for (const e of errors) console.error("Gửi thông báo nhân viên lỗi:", e)
  return errors
}
