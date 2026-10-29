import { readFile } from "node:fs/promises"
import { extname } from "node:path"
import { generateReply, HANDOVER_TAG, IMAGE_TAG, ORDER_TAG, PHONE_TAG } from "./ai.ts"
import * as db from "./db.ts"
import * as zalo from "./zalo.ts"
import { normalizePhone } from "./zns.ts"

/** Bot chuyển nhân viên mà sau ngần này phút chưa có nhân viên trả lời thì bot tự nhận lại khách. */
const HANDOVER_MINUTES = Number(process.env.HANDOVER_MINUTES || 10)
/** Nhân viên đã trả lời khách trong app Zalo OA: bot nhường khách đó lâu hơn. */
const STAFF_REPLY_MINUTES = 60
/** Nhân viên bấm "chuyển vai trò" thì bot nhường khách đó 24 giờ (hoặc tới khi bấm chuyển lại cho bot). */
export const STAFF_MODE_MINUTES = 24 * 60
const HANDOVER_WORDS = ["gặp nhân viên", "gặp người", "người thật", "tư vấn viên", "nhân viên tư vấn", "nói chuyện với người", "gọi tổng đài"]
export const HANDOVER_REPLY =
  "Dạ, em đã chuyển yêu cầu của anh/chị tới nhân viên chăm sóc khách hàng. Nhân viên sẽ phản hồi anh/chị trong thời gian sớm nhất ạ."

export function wantsHuman(text: string): boolean {
  const t = text.toLowerCase()
  return HANDOVER_WORDS.some((w) => t.includes(w))
}

/** SĐT Việt Nam đầu tiên trong tin nhắn ("0912 345 678", "+84 912.345.678"), dạng 84xxxxxxxxx. */
export function findPhone(text: string): string | null {
  for (const m of text.matchAll(/(?<!\d)(?:\+?84|0)[\s.-]?\d(?:[\s.-]?\d){8}(?!\d)/g)) {
    const phone = normalizePhone(m[0])
    if (phone) return phone
  }
  return null
}

const AI_TRIES = 3
const RETRY_MS = Number(process.env.AI_RETRY_MS ?? 2000)

/** Model rẻ (flash-lite) đôi khi chọn chuyển nhân viên ngẫu nhiên, Gemini miễn phí hay báo quá tải:
 *  hỏi lại tối đa 3 lần, chỉ chuyển nhân viên khi cả 3 lần đều chuyển hoặc đều lỗi. */
async function aiReply(hist: db.Message[], extra = ""): Promise<string> {
  for (let i = 1; i <= AI_TRIES; i++) {
    try {
      const reply = await generateReply(hist, undefined, extra)
      if (reply && !reply.includes(HANDOVER_TAG)) return reply
    } catch (err) {
      console.error(`Gọi AI lỗi (lần ${i}/${AI_TRIES}):`, err instanceof Error ? err.message : err)
      if (i < AI_TRIES) await new Promise((r) => setTimeout(r, RETRY_MS))
    }
  }
  return HANDOVER_TAG
}

export type Outgoing = { text: string } | { image: db.Image } | { requestPhone: true }

/** Tin bot lưu khi gửi nút chia sẻ SĐT (để lịch sử và AI biết đã xin). */
export const PHONE_REQUEST_LOG = "[Gửi yêu cầu chia sẻ số điện thoại]"

/** Thông tin riêng của khách đưa thêm cho AI. */
function customerInfo(userId: string) {
  const phone = db.getUser(userId)?.phone
  return phone
    ? `\n# THÔNG TIN KHÁCH\nĐã có số điện thoại của khách: 0${phone.slice(2)}. KHÔNG xin lại số điện thoại, không thêm dòng ${PHONE_TAG}.`
    : ""
}

/** Sinh câu trả lời cho các tin khách chưa được trả lời, lưu vào DB, trả về các tin cần gửi (chữ trước, ảnh sau).
 *  Trả về null nếu không cần trả lời (bot tắt / đang chuyển nhân viên / không có tin mới). */
export async function answer(userId: string): Promise<Outgoing[] | null> {
  if (db.getKv("bot_enabled") === "0" || db.isPaused(userId)) return null
  const hist = db.history(userId, 20)
  const pending: string[] = []
  for (let i = hist.length - 1; i >= 0 && hist[i].role === "user"; i--) pending.push(hist[i].text)
  if (!pending.length) return null

  if (pending.some(wantsHuman)) return [handover(userId)]
  const reply = await aiReply(hist, customerInfo(userId))
  if (reply.includes(HANDOVER_TAG)) return [handover(userId)]
  return finish(userId, reply)
}

const RESUME_RULE = `
# LƯU Ý LÚC NÀY
Trước đó bạn đã chuyển khách cho nhân viên nhưng nhân viên chưa phản hồi. KHÔNG được trả lời "${HANDOVER_TAG}".
Hãy xin lỗi vì để khách chờ, rồi trả lời tiếp câu hỏi của khách trong phạm vi kho kiến thức. Nếu kho kiến thức không có thông tin
hoặc khách khiếu nại: ghi nhận nội dung, xin số điện thoại (thêm dòng ${"[XIN_SDT]"}) để nhân viên gọi lại sớm nhất.`
const RESUME_FALLBACK =
  "Dạ em xin lỗi đã để anh/chị chờ ạ. Anh/chị vui lòng để lại số điện thoại, nhân viên bên em sẽ gọi lại hỗ trợ anh/chị sớm nhất ạ."

/** Bot chuyển nhân viên mà quá HANDOVER_MINUTES chưa có nhân viên trả lời: bot nhận lại và trả lời tiếp. */
export async function resumeAfterHandover(now = Date.now()) {
  if (db.getKv("bot_enabled") === "0") return
  // Chỉ xét các lần chuyển hết hạn trong 6 giờ gần đây, tránh gửi cho hội thoại cũ.
  for (const userId of db.handoverExpired(now - 6 * 3_600_000, now, HANDOVER_REPLY)) {
    if (busy.has(userId)) continue
    busy.add(userId)
    try {
      let reply = RESUME_FALLBACK
      try {
        reply = await aiReply(db.history(userId, 20), RESUME_RULE + customerInfo(userId))
      } catch {}
      if (reply.includes(HANDOVER_TAG)) reply = RESUME_FALLBACK
      const out = finish(userId, reply)
      // Câu dự phòng xin SĐT bằng chữ; khách chưa có số thì gửi kèm nút chia sẻ.
      if (reply === RESUME_FALLBACK && !out.some((o) => "requestPhone" in o)) out.push(...phoneRequest(userId))
      await deliver(userId, out)
    } catch (err) {
      console.error(`Bot nhận lại khách ${userId} lỗi:`, err)
    } finally {
      busy.delete(userId)
    }
  }
}

/** Nút "chia sẻ số điện thoại" chỉ gửi khi chưa có số và 24 giờ qua chưa gửi. */
function phoneRequest(userId: string): Outgoing[] {
  if (db.getUser(userId)?.phone || db.recentBotMessage(userId, PHONE_REQUEST_LOG, 24 * 3_600_000)) return []
  db.addMessage(userId, "bot", PHONE_REQUEST_LOG)
  return [{ requestPhone: true }]
}

/** Xử lý các thẻ trong câu trả lời của AI, lưu tin và trả về danh sách tin cần gửi. */
function finish(userId: string, raw: string): Outgoing[] {
  let reply = raw
  // Dòng đơn hàng: lưu cho nhân viên, không gửi khách.
  const order = reply.split("\n").find((l) => l.includes(ORDER_TAG))
  if (order) {
    const summary = order.replace(ORDER_TAG, "").trim()
    db.addOrder(userId, findPhone(summary) ?? db.getUser(userId)?.phone ?? null, summary)
    reply = reply.replace(order, "")
  }
  // Thẻ ảnh: ảnh đã bị xóa thì bỏ qua.
  const images = [...new Set([...reply.matchAll(IMAGE_TAG)].map((m) => Number(m[1])))]
    .map((id) => db.getImage(id))
    .filter((img): img is db.Image => !!img)
  const wantsPhone = reply.includes(PHONE_TAG)
  reply = reply.replace(IMAGE_TAG, "").replaceAll(PHONE_TAG, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000)

  const out: Outgoing[] = []
  if (reply) {
    db.addMessage(userId, "bot", reply)
    out.push({ text: reply })
  }
  for (const image of images) {
    db.addMessage(userId, "bot", `${db.IMAGE_ECHO} #${image.id} ${image.name}`)
    out.push({ image })
  }
  if (wantsPhone) out.push(...phoneRequest(userId))
  return out
}

function handover(userId: string): Outgoing {
  db.pauseBot(userId, HANDOVER_MINUTES)
  db.addMessage(userId, "bot", HANDOVER_REPLY)
  return { text: HANDOVER_REPLY }
}

export const IMAGE_TYPE: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif" }

async function deliver(userId: string, out: Outgoing[]) {
  for (const o of out) {
    if ("text" in o) await zalo.sendText(userId, o.text)
    else if ("requestPhone" in o) {
      try {
        await zalo.requestUserInfo(userId)
      } catch (err) {
        console.error(`Gửi nút chia sẻ SĐT cho khách ${userId} lỗi:`, err)
      }
    } else {
      try {
        const file = `data/images/${o.image.file}`
        await zalo.sendImage(userId, await readFile(file), IMAGE_TYPE[extname(file).toLowerCase()] ?? "image/jpeg")
      } catch (err) {
        // Ảnh lỗi không chặn phần còn lại; nhân viên xem log để thay ảnh.
        console.error(`Gửi ảnh "${o.image.name}" cho khách ${userId} lỗi:`, err)
      }
    }
  }
}

// Chờ khách nhắn xong (khách hay gửi nhiều tin liền) rồi trả lời 1 lần.
const DEBOUNCE_MS = 3000
const timers = new Map<string, NodeJS.Timeout>()
const busy = new Set<string>()

function schedule(userId: string, ms = DEBOUNCE_MS) {
  clearTimeout(timers.get(userId))
  timers.set(
    userId,
    setTimeout(async () => {
      timers.delete(userId)
      if (busy.has(userId)) return schedule(userId, 1000)
      busy.add(userId)
      try {
        const out = await answer(userId)
        if (out) await deliver(userId, out)
      } catch (err) {
        console.error(`Trả lời khách ${userId} lỗi:`, err)
      } finally {
        busy.delete(userId)
      }
    }, ms),
  )
}

/** Gọi khi server khởi động: trả lời các tin khách còn chờ (bị bỏ dở do server tắt/khởi động lại). */
export function resumePending() {
  for (const userId of db.pendingUsers(Date.now() - 10 * 60_000)) schedule(userId)
}

/** Khách gửi tin vào OA. */
export function onUserMessage(userId: string, text: string, msgId?: string) {
  if (!db.addMessage(userId, "user", text, msgId)) return // Zalo gửi lặp webhook
  const phone = findPhone(text)
  if (phone) db.setPhone(userId, phone)
  // Chưa có tên thì thử lấy (lần đầu, hoặc lần trước lỗi) – không chặn việc trả lời.
  // Chưa có tên hoặc SĐT thì hỏi Zalo: SĐT chỉ có khi khách từng chia sẻ thông tin với OA.
  const u = db.getUser(userId)
  if (!u?.name || !u.phone) {
    zalo
      .userDetail(userId)
      .then((d) => {
        if (d.name && !u?.name) db.setUserName(userId, d.name)
        const p = d.phone && normalizePhone(d.phone)
        if (p && !db.getUser(userId)?.phone) db.setPhone(userId, p)
      })
      .catch((err) => console.warn(`Không lấy được thông tin khách ${userId}:`, err.message))
  }
  schedule(userId)
}

/** Nhân viên chat với khách từ trang quản trị: bot dừng với khách này, tin gửi qua Zalo. */
export async function staffSend(userId: string, text: string) {
  db.pauseBot(userId, STAFF_MODE_MINUTES)
  if (db.isOwnEcho(userId, text.slice(0, 2000), 10_000)) return // bấm Gửi 2 lần liên tiếp
  // Lưu trước khi gửi để webhook oa_send_text quay về được nhận ra là tin của mình.
  const id = db.addMessage(userId, "staff", text.slice(0, 2000))
  try {
    await zalo.sendText(userId, text)
  } catch (err) {
    db.deleteMessage(id)
    throw err
  }
}

// --- Hỏi thăm khách im lặng ---
export const FOLLOW_UP_DEFAULT =
  "Dạ, anh/chị còn cần em tư vấn thêm gì không ạ? Nếu anh/chị muốn chốt giá và gửi hàng, anh/chị nhắn em thông tin để em lên đơn ngay nhé."
const FOLLOW_UP_AFTER_MS = 2 * 3_600_000
// Im lặng quá lâu (qua đêm) thì thôi, tránh làm phiền và tránh hết hạn 48 giờ của Zalo.
const FOLLOW_UP_GIVE_UP_MS = 20 * 3_600_000
const hourVN = (now: number) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "numeric", hourCycle: "h23" }).format(now))

/** Bot đã trả lời mà khách im 2 giờ: gửi 1 tin hỏi thăm (mỗi lần khách im chỉ hỏi 1 lần, chỉ 8h–21h).
 *  Nội dung sửa ở trang Kiến thức & giọng văn; để trống là tắt. */
export async function followUp(now = Date.now()) {
  const text = (db.getKv("follow_up_text") ?? FOLLOW_UP_DEFAULT).trim()
  if (!text || db.getKv("bot_enabled") === "0") return
  const h = hourVN(now)
  if (h < 8 || h >= 21) return
  for (const userId of db.followUpCandidates(now - FOLLOW_UP_GIVE_UP_MS, now - FOLLOW_UP_AFTER_MS, HANDOVER_REPLY)) {
    db.markFollowedUp(userId) // đánh dấu trước: gửi lỗi cũng không thử lại liên tục
    const id = db.addMessage(userId, "bot", text)
    try {
      await zalo.sendText(userId, text)
    } catch (err) {
      db.deleteMessage(id)
      console.error(`Hỏi thăm khách ${userId} lỗi:`, err)
    }
  }
}

/** Việc chạy nền mỗi phút: hỏi thăm khách im lặng, bot nhận lại khách nhân viên chưa trả lời. */
export function startWorkers() {
  setInterval(() => {
    followUp().catch((err) => console.error("Hỏi thăm khách lỗi:", err))
    resumeAfterHandover().catch((err) => console.error("Bot nhận lại khách lỗi:", err))
  }, 60_000)
}

/** Khách bấm "Chia sẻ" trên tin yêu cầu thông tin (webhook user_submit_info): lưu SĐT, bot trả lời tiếp. */
export function onUserInfo(userId: string, info: { phone?: unknown; name?: unknown; address?: unknown }, eventId: string) {
  const phone = normalizePhone(String(info.phone ?? ""))
  if (phone) db.setPhone(userId, phone)
  const parts = [phone && `SĐT 0${phone.slice(2)}`, info.name && `tên ${info.name}`, info.address && `địa chỉ ${info.address}`].filter(Boolean)
  onUserMessage(userId, `[Khách đã chia sẻ thông tin: ${parts.join(", ") || "không có số điện thoại"}]`, eventId)
}

/** OA gửi tin cho khách (event oa_send_*): nếu không phải bot gửi thì là nhân viên → bot tạm dừng. */
export function onOaMessage(userId: string, text: string, msgId?: string) {
  if (db.isOwnEcho(userId, text)) return
  if (!db.addMessage(userId, "staff", text, msgId)) return
  db.pauseBot(userId, STAFF_REPLY_MINUTES)
}
