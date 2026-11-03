import { readFile } from "node:fs/promises"
import { extname } from "node:path"
import { type AiConfig, fallbackConfig, generateReply, HANDOVER_TAG, IMAGE_TAG, NO_FOLLOW_UP_TAG, ORDER_EDIT_TAG, ORDER_TAG, PHONE_TAG, REGION_ASK_TAG, REGION_TAG } from "./ai.ts"
import * as db from "./db.ts"
import * as notify from "./notify.ts"
import { PRICE_TAG, priceFallback, priceResult } from "./price.ts"
import * as region from "./region.ts"
import { TRACK_TAG, codesText, deliveredText, isDelivered, track, trackResult, type Tracking } from "./tracking.ts"
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
/** meta.tracked: các vận đơn code đã tra (done = đã giao thành công) – để theo dõi mã chưa giao xong. */
async function aiReply(hist: db.Message[], extra = "", meta: { tracked?: { code: string; done: boolean }[] } = {}): Promise<string> {
  // AI xin tính giá (thẻ TINH_GIA) / tra vận đơn (thẻ TRA_DON): code tra rồi hỏi AI lần nữa kèm kết quả để viết câu trả lời.
  // Đã có kết quả thì lần thử lại chỉ gọi bước viết câu trả lời, đỡ tốn lượt gọi AI (gói miễn phí giới hạn lượt/phút).
  let looked = "", fallback = "", handoverChosen = false
  let cfg: AiConfig | undefined // undefined = model chọn trong trang admin
  for (let i = 1; i <= AI_TRIES; i++) {
    try {
      let reply = await generateReply(hist, cfg, extra + looked)
      if (!looked && (reply.match(PRICE_TAG) || reply.match(TRACK_TAG))) {
        ;({ looked, fallback, tracked: meta.tracked } = await lookup(reply))
        reply = await generateReply(hist, cfg, extra + looked)
      }
      reply = reply.replace(PRICE_TAG, "").replace(TRACK_TAG, "").trim()
      handoverChosen = reply.includes(HANDOVER_TAG)
      if (reply && !handoverChosen) return reply
    } catch (err) {
      console.error(`Gọi AI lỗi (lần ${i}/${AI_TRIES}):`, err instanceof Error ? err.message : err)
      // Model quá tải / hết lượt: lần sau thử model dự phòng thay vì gọi lại đúng model đang quá tải.
      if (/\b(503|504|429)\b|UNAVAILABLE|DEADLINE_EXCEEDED|RESOURCE_EXHAUSTED|overloaded/i.test(String(err instanceof Error ? err.message : err))) cfg = fallbackConfig()
      if (i < AI_TRIES) await new Promise((r) => setTimeout(r, RETRY_MS))
    }
  }
  // Code đã tra xong mà AI cứ lặp lại thẻ hoặc lỗi: gửi kết quả code tự viết, không chuyển nhân viên.
  if (fallback && !handoverChosen) return fallback
  return HANDOVER_TAG
}

/** Tra theo các thẻ AI viết: kết quả cho AI viết câu trả lời, và câu trả lời code tự viết để dự phòng. */
async function lookup(reply: string) {
  const parts: { forAi: string; forCustomer: string }[] = []
  if (reply.match(PRICE_TAG)) parts.push({ forAi: priceResult(reply), forCustomer: priceFallback(reply) })
  const tracked = reply.match(TRACK_TAG) ? await trackResult(reply) : undefined
  if (tracked) parts.push(tracked)
  return { looked: parts.map((p) => p.forAi).join("\n"), fallback: parts.map((p) => p.forCustomer).filter(Boolean).join("\n\n"), tracked: tracked?.status }
}

export type Outgoing = { text: string } | { image: db.Image } | { requestPhone: true } | { buttons: { text: string; items: region.Button[] } }

/** Tin bot lưu khi gửi nút chia sẻ SĐT (để lịch sử và AI biết đã xin). */
export const PHONE_REQUEST_LOG = "[Gửi yêu cầu chia sẻ số điện thoại]"

/** Thông tin riêng của khách đưa thêm cho AI. */
function customerInfo(userId: string) {
  const u = db.getUser(userId)
  const lines: string[] = []
  if (u?.phone) lines.push(`Đã có số điện thoại của khách: 0${u.phone.slice(2)}. KHÔNG xin lại số điện thoại, không thêm dòng ${PHONE_TAG}.`)
  const r = region.isRegion(u?.region) ? u.region : null
  const b = region.isBranch(u?.branch) ? u.branch : null
  if (r) lines.push(`Khách ở ${region.REGIONS[r]}.`)
  if (b) lines.push(`Khách làm việc với ${region.BRANCHES[b]}: khi hướng dẫn gửi hàng, địa chỉ hay liên hệ nhân viên thì dùng đúng bưu cục này.`)
  const orders = db.recentOrders(userId, Date.now() - 30 * 86_400_000)
  if (orders.length) {
    const when = (ms: number) => new Date(ms).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
    lines.push("ĐƠN ĐÃ CHỐT (30 ngày gần đây, mới nhất trước):", ...orders.map((o) => `- #${o.id} chốt lúc ${when(o.created_at)}${o.updated_at ? `, sửa lúc ${when(o.updated_at)}` : ""}: ${o.summary}`))
  }
  lines.push("Tập trung tư vấn đúng câu hỏi của khách (gửi đi nước nào, hàng gì, cân nặng, giá cước). KHÔNG hỏi khách ở vùng/miền nào: hệ thống tự hỏi khi cần chuyển nhân viên.")
  if (!r) lines.push("Khách tự nói tỉnh/thành mình ở thì thêm một dòng [VUNG: bac] / [VUNG: trung] / [VUNG: nam] (Bắc: từ Ninh Bình trở ra; Trung: Thanh Hóa đến Bình Thuận và Tây Nguyên; Nam: TP.HCM, Đông Nam Bộ và đồng bằng sông Cửu Long).")
  return `\n# THÔNG TIN KHÁCH\n${lines.join("\n")}`
}

/** Sinh câu trả lời cho các tin khách chưa được trả lời, lưu vào DB, trả về các tin cần gửi (chữ trước, ảnh sau).
 *  Trả về null nếu không cần trả lời (bot tắt / đang chuyển nhân viên / không có tin mới). */
export async function answer(userId: string): Promise<Outgoing[] | null> {
  if (db.getKv("bot_enabled") === "0" || notify.staffIds().includes(userId)) return null
  const hist = db.history(userId, 20)
  const pending: string[] = []
  for (let i = hist.length - 1; i >= 0 && hist[i].role === "user"; i--) pending.push(hist[i].text)
  if (!pending.length) return null

  // Nút chọn vùng / bưu cục (chỉ gửi khi chuyển nhân viên): code trả lời, kể cả lúc bot đang tạm dừng chờ nhân viên.
  const u = db.getUser(userId)
  if (pending.every((t) => region.parseChoice(t).region) && region.isRegion(u?.region) && !region.isBranch(u?.branch)) {
    const text = region.branchAfterRegion(u.region)
    db.addMessage(userId, "bot", text)
    return [{ buttons: { text, items: region.branchButtons() } }]
  }
  if (pending.every((t) => region.parseChoice(t).branch) && region.isBranch(u?.branch)) {
    // Chọn xong bưu cục: gửi SĐT + địa chỉ bưu cục (code viết, không qua AI để không sai số), báo nhân viên đúng chi nhánh
    // việc đang chờ (chuyển nhân viên / đơn vừa chốt).
    const wait = db.getKv(waitKey(userId)) ?? ""
    db.setKv(waitKey(userId), "")
    // Khách đổi từ bưu cục khác sang (bấm nhầm, đổi ý): nói rõ đã đổi, báo nhân viên chi nhánh mới việc đang dở.
    const from = db.getKv(`branch_from:${userId}`) ?? ""
    db.setKv(`branch_from:${userId}`, "")
    const changed = region.isBranch(from) && from !== u.branch
    const recent = db.recentOrders(userId, Date.now() - 86_400_000)[0]
    const order = wait.startsWith("order:") ? db.getOrder(Number(wait.slice(6))) : changed ? recent : undefined
    const handoverWait = !order && (wait === "handover" || db.isPaused(userId))
    const text = changed ? region.branchChanged(from, u.branch)
      : order ? region.orderConfirm(u.branch) : handoverWait ? region.branchConfirm(u.branch) : region.branchInfo(u.branch)
    db.addMessage(userId, "bot", text)
    // Telegram đã được báo lúc chuyển nhân viên / chốt đơn: giờ chỉ báo Zalo nhân viên của chi nhánh.
    if (order) notifyOrder(userId, order.id, order.summary, { branch: u.branch, telegram: false }, changed ? "move" : "new", { from })
    return [{ text }, ...choiceRequest(userId)]
  }
  if (db.isPaused(userId)) return null

  // Tắt chuyển nhân viên (nút ở trang Hội thoại): bot không bao giờ im chờ nhân viên, ca khó thì xin SĐT để nhân viên gọi lại.
  const handoverOff = db.getKv("handover_enabled") === "0"
  if (pending.some(wantsHuman) && !handoverOff) return handover(userId)
  const meta: Parameters<typeof aiReply>[2] = {}
  const reply = await aiReply(hist, customerInfo(userId) + (handoverOff ? NO_HANDOVER_RULE : ""), meta)
  // Vận đơn chưa giao xong: theo dõi, giao thành công thì tự báo khách (watchShipments). Đã giao: thôi theo dõi.
  for (const t of meta.tracked ?? []) (t.done ? db.unwatchCode : db.watchCode)(userId, t.code)
  // Khách nhắn thêm trong lúc AI đang soạn: bỏ câu đã soạn, lượt chờ của tin mới sẽ đọc lại tất cả rồi trả lời một lần.
  if (db.history(userId, 1)[0]?.id !== hist.at(-1)?.id) return null
  const needStaff = reply.includes(HANDOVER_TAG) || pending.some(wantsHuman)
  if (!needStaff) return finish(userId, reply)
  if (!handoverOff) return handover(userId)
  // Tắt chuyển nhân viên mà khách cần người: bot vẫn trả lời, xin SĐT, hỏi bưu cục để báo đúng nhân viên.
  const out = finish(userId, reply.includes(HANDOVER_TAG) ? NO_HANDOVER_FALLBACK : reply)
  if (!out.some((o) => "requestPhone" in o)) out.push(...phoneRequest(userId))
  return [...out, ...choiceRequest(userId, "handover")]
}

const NO_HANDOVER_RULE = `
# LƯU Ý LÚC NÀY
Chế độ chuyển nhân viên đang TẮT: KHÔNG được trả lời "${HANDOVER_TAG}". Trả lời trong phạm vi kho kiến thức.
Kho kiến thức không có thông tin, khách khiếu nại hoặc muốn gặp người thật: ghi nhận nội dung, xin số điện thoại (thêm dòng ${PHONE_TAG}) để nhân viên gọi lại sớm nhất.`
const NO_HANDOVER_FALLBACK =
  "Dạ em đã ghi nhận yêu cầu của anh/chị ạ. Anh/chị vui lòng để lại số điện thoại, nhân viên bên em sẽ gọi lại hỗ trợ anh/chị sớm nhất ạ."

const RESUME_RULE = `
# LƯU Ý LÚC NÀY
Trước đó bạn đã chuyển khách cho nhân viên nhưng nhân viên chưa phản hồi. KHÔNG được trả lời "${HANDOVER_TAG}".
Hãy xin lỗi vì để khách chờ, rồi trả lời tiếp câu hỏi của khách trong phạm vi kho kiến thức. Nếu kho kiến thức không có thông tin
hoặc khách khiếu nại: ghi nhận nội dung, xin số điện thoại (thêm dòng ${"[XIN_SDT]"}) để nhân viên gọi lại sớm nhất.`
const RESUME_FALLBACK =
  "Dạ em xin lỗi đã để anh/chị chờ ạ. Anh/chị vui lòng để lại số điện thoại, nhân viên bên em sẽ gọi lại hỗ trợ anh/chị sớm nhất ạ."

/** Bot chuyển nhân viên mà quá HANDOVER_MINUTES chưa có nhân viên trả lời: bot nhận lại và trả lời tiếp. */
export async function resumeAfterHandover(now = Date.now()) {
  if (db.getKv("bot_enabled") === "0" || !inReplyHours(now)) return
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

/** Việc đang chờ khách chọn bưu cục để báo đúng nhân viên chi nhánh: "handover" hoặc "order:<mã đơn>". */
const waitKey = (userId: string) => `branch_wait:${userId}`

/** Tin có nút cho khách chọn vùng, rồi bưu cục (phần nào chưa biết thì hỏi). Mỗi câu hỏi tối đa 1 lần/24 giờ.
 *  reason: việc chờ báo nhân viên chi nhánh sau khi khách chọn bưu cục. */
function choiceRequest(userId: string, reason = ""): Outgoing[] {
  const u = db.getUser(userId)
  if (reason && !region.isBranch(u?.branch)) db.setKv(waitKey(userId), reason)
  const ask = !region.isRegion(u?.region) ? { text: region.REGION_QUESTION, items: region.regionButtons() }
    : !region.isBranch(u?.branch) ? { text: region.BRANCH_QUESTION, items: region.branchButtons() }
    : null
  if (!ask || db.recentBotMessage(userId, ask.text, 24 * 3_600_000)) return []
  db.addMessage(userId, "bot", ask.text)
  return [{ buttons: ask }]
}

/** Xử lý các thẻ trong câu trả lời của AI, lưu tin và trả về danh sách tin cần gửi.
 *  askChoice: khách vừa chọn vùng/bưu cục, hỏi tiếp phần còn thiếu. */
function finish(userId: string, raw: string, askChoice = false): Outgoing[] {
  let reply = raw
  // AI nhận ra vùng khách ở từ tin nhắn (khách nói tỉnh/thành).
  for (const m of reply.matchAll(REGION_TAG)) if (region.isRegion(m[1].toLowerCase())) db.setRegion(userId, m[1].toLowerCase())
  const wantsChoice = askChoice || reply.includes(REGION_ASK_TAG)
  reply = reply.replace(REGION_TAG, "").replaceAll(REGION_ASK_TAG, "")
  // Dòng đơn hàng: lưu cho nhân viên, không gửi khách.
  let orderWait = ""
  // Khách sửa đơn đã chốt: cập nhật đúng đơn đó (chỉ đơn của chính khách), báo nhân viên trước/sau khi sửa.
  // Mã đơn sai thì coi như đơn mới để không mất thông tin.
  const editLine = reply.split("\n").find((l) => ORDER_EDIT_TAG.test(l))
  if (editLine) {
    const id = Number(editLine.match(ORDER_EDIT_TAG)![1])
    const summary = editLine.replace(ORDER_EDIT_TAG, "").trim()
    const old = db.getOrder(id)
    reply = reply.replace(editLine, summary && !(old && old.user_id === userId) ? `${ORDER_TAG} ${summary}` : "")
    if (summary && old && old.user_id === userId) {
      db.updateOrder(id, findPhone(summary), summary)
      const branch = db.getUser(userId)?.branch
      if (region.isBranch(branch)) notifyOrder(userId, id, summary, { branch }, "edit", { old: old.summary })
      else {
        notifyOrder(userId, id, summary, { zalo: false }, "edit", { old: old.summary })
        orderWait = `order:${id}`
      }
    }
  }
  const order = reply.split("\n").find((l) => l.includes(ORDER_TAG))
  if (order) {
    const summary = order.replace(ORDER_TAG, "").trim()
    const id = db.addOrder(userId, findPhone(summary) ?? db.getUser(userId)?.phone ?? null, summary)
    // Địa chỉ lấy hàng trong đơn có tỉnh/thành ("Cầu Giấy, Hà Nội") thì ghi vùng luôn, chỉ còn hỏi bưu cục.
    const place = !region.isRegion(db.getUser(userId)?.region) && region.regionFromText(summary.split("|").find((p) => /lấy hàng/i.test(p)) ?? "")
    if (place) db.setRegion(userId, place)
    reply = reply.replace(order, "")
    // Báo nhân viên ngay: biết bưu cục thì báo đúng chi nhánh; chưa biết thì báo Telegram trước, hỏi khách bưu cục
    // rồi báo Zalo nhân viên chi nhánh khách chọn.
    const branch = db.getUser(userId)?.branch
    if (region.isBranch(branch)) notifyOrder(userId, id, summary, { branch })
    else {
      notifyOrder(userId, id, summary, { zalo: false })
      orderWait = `order:${id}`
    }
  }
  // Thẻ ảnh: ảnh đã bị xóa thì bỏ qua.
  const images = [...new Set([...reply.matchAll(IMAGE_TAG)].map((m) => Number(m[1])))]
    .map((id) => db.getImage(id))
    .filter((img): img is db.Image => !!img)
  const wantsPhone = reply.includes(PHONE_TAG)
  // Khách tra đơn / khiếu nại: coi như đã hỏi thăm lần này, khách nhắn lại thì tính lại từ đầu.
  if (reply.includes(NO_FOLLOW_UP_TAG)) db.markFollowedUp(userId)
  reply = reply.replace(IMAGE_TAG, "").replaceAll(PHONE_TAG, "").replaceAll(NO_FOLLOW_UP_TAG, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000)

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
  if (wantsChoice || orderWait) out.push(...choiceRequest(userId, orderWait))
  return out
}

/** Chuyển nhân viên: biết bưu cục thì đưa luôn SĐT nhân viên bưu cục đó; chưa biết thì hỏi vùng → bưu cục bằng nút. */
function handover(userId: string): Outgoing[] {
  db.pauseBot(userId, HANDOVER_MINUTES)
  db.addMessage(userId, "bot", HANDOVER_REPLY)
  const b = db.getUser(userId)?.branch
  if (!region.isBranch(b)) return [{ text: HANDOVER_REPLY }, ...choiceRequest(userId, "handover")]
  const contact = region.branchContact(b)
  db.addMessage(userId, "bot", contact)
  return [{ text: HANDOVER_REPLY }, { text: contact }]
}

export const IMAGE_TYPE: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif" }

async function deliver(userId: string, out: Outgoing[]) {
  for (const o of out) {
    if ("text" in o) await zalo.sendText(userId, o.text)
    else if ("buttons" in o) {
      try {
        await zalo.sendButtons(userId, o.buttons.text, o.buttons.items)
      } catch (err) {
        // Nút lỗi: gửi chữ kèm các lựa chọn để khách gõ lại.
        console.error(`Gửi nút chọn cho khách ${userId} lỗi:`, err)
        await zalo.sendText(userId, `${o.buttons.text}\n${o.buttons.items.map((b) => `- ${b.payload}`).join("\n")}`)
      }
    } else if ("requestPhone" in o) {
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

// --- Giờ trả lời và thời gian chờ (sửa ở đầu trang Hội thoại) ---
const timeVN = (now: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now)

/** Bot chỉ trả lời trong khung giờ "HH:MM"–"HH:MM" (giờ Việt Nam, cho phép qua đêm như 20:00–06:00).
 *  Chưa đặt hoặc 2 mốc bằng nhau: trả lời cả ngày. */
export function inReplyHours(now = Date.now()) {
  const from = db.getKv("reply_from") ?? "", to = db.getKv("reply_to") ?? ""
  if (!from || !to || from === to) return true
  const t = timeVN(now)
  return from < to ? t >= from && t < to : t >= from || t < to
}

export const DEBOUNCE_DEFAULT = 15
/** Chờ khách nhắn xong (khách hay gửi nhiều tin liền, gõ điện thoại chậm) rồi đọc hết các tin và trả lời 1 lần. */
const debounceMs = () => 1000 * Number(db.getKv("debounce_seconds") ?? DEBOUNCE_DEFAULT)

// --- Báo nhân viên: chỉ 2 loại – khách nhắn OA (mỗi khách 1 lần/ngày) và đơn hàng (chốt / sửa / đổi bưu cục) ---
const dayVN = (now: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(now)
const clockVN = (ms: number) =>
  new Date(ms).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
/** 84912345678 → "0912 345 678". */
const phoneText = (p: string | null | undefined) => (p ? `0${p.slice(2, 5)} ${p.slice(5, 8)} ${p.slice(8)}` : "chưa có")
/** Lấy một phần trong tóm tắt đơn "Nước đến: … | Hàng: … | …"; trống hoặc "-" thì bỏ. */
const orderField = (summary: string, name: string) => {
  const v = summary.split("|").map((x) => x.trim()).find((x) => x.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim() ?? ""
  return v === "-" ? "" : v
}
const ORDER_LINES: [string, string][] = [["Nước đến", "📦 Gửi đi"], ["Hàng", "📦 Hàng"], ["Cân nặng", "⚖️ Cân nặng"], ["Kích thước", "📐 Kích thước"],
  ["Giá báo", "💰 Giá đã báo"], ["Lấy hàng", "🏠 Lấy hàng tại"]]

/** Các dòng giới thiệu khách: tên, SĐT, bưu cục, khu vực. */
function customerLines(userId: string, phone?: string | null) {
  const u = db.getUser(userId)
  return [
    `👤 Khách: ${u?.name || "Chưa rõ tên (xem trong trang quản trị)"}`,
    `📞 SĐT: ${phoneText(phone ?? u?.phone)}`,
    ...(region.isBranch(u?.branch) ? [`🏢 Bưu cục: ${region.BRANCHES[u.branch]}`] : []),
    ...(region.isRegion(u?.region) ? [`📍 Khu vực: ${region.REGIONS[u.region]}`] : []),
  ]
}

/** Báo nhân viên về đơn hàng (mỗi lần một thông báo, không giới hạn theo ngày, không kèm link).
 *  kind: new = đơn mới chốt; edit = khách sửa đơn (old: nội dung trước khi sửa); move = khách đổi bưu cục (from: bưu cục cũ). */
function notifyOrder(userId: string, orderId: number, summary: string, opts: { branch?: string | null; telegram?: boolean; zalo?: boolean },
  kind: "new" | "edit" | "move" = "new", extra: { old?: string; from?: string } = {}) {
  if (userId === "test-admin") return
  const title = kind === "edit" ? `✏️ KHÁCH SỬA ĐƠN #${orderId}` : kind === "move" ? `🔁 ĐƠN #${orderId} CHUYỂN SANG BƯU CỤC CỦA BẠN` : `🛒 ĐƠN MỚI #${orderId} – CẦN GỌI XÁC NHẬN`
  const phone = findPhone(orderField(summary, "SĐT"))
  const changes = kind === "edit" && extra.old
    ? ORDER_LINES.map(([f, label]) => [label, orderField(extra.old!, f), orderField(summary, f)] as const)
        .filter(([, a, b]) => a !== b)
        .map(([label, a, b]) => `- ${label.replace(/^\S+ /, "")}: ${a || "(trống)"} → ${b || "(trống)"}`)
    : []
  const lines = [
    title,
    ...(kind === "move" && region.isBranch(extra.from) ? [`Khách đổi từ ${region.BRANCHES[extra.from]} sang bưu cục của bạn.`] : []),
    ...customerLines(userId, phone),
    ...(changes.length ? ["", "Đã thay đổi:", ...changes] : []),
    "",
    ...ORDER_LINES.map(([f, label]) => [label, orderField(summary, f)] as const).filter(([, v]) => v).map(([label, v]) => `${label}: ${v}`),
    `🕒 Lúc: ${clockVN(Date.now())}`,
    "",
    kind === "edit" ? "👉 Gọi khách xác nhận lại thông tin mới của đơn." : "👉 Gọi khách xác nhận đơn và hẹn giờ lấy hàng.",
  ]
  notify.notifyStaff(lines.join("\n"), opts).catch(() => {})
}

/** Khách vừa nhắn (sau khi chờ khách nhắn xong): báo nhân viên lần đầu trong ngày, khách nhắn tiếp không báo lặp.
 *  Khách đã chọn bưu cục thì chỉ báo nhân viên chi nhánh đó. */
export function notifyNewMessage(userId: string, now = Date.now()) {
  if (userId === "test-admin" || notify.staffIds().includes(userId)) return
  const hist = db.history(userId, 20)
  const pending: string[] = []
  for (let i = hist.length - 1; i >= 0 && hist[i].role === "user"; i--) pending.unshift(hist[i].text)
  const key = `notified_msg:${userId}`
  if (!pending.length || db.getKv(key) === dayVN(now)) return
  db.setKv(key, dayVN(now))
  const u = db.getUser(userId)
  const text = pending.join(" / ")
  const link = process.env.PUBLIC_URL ? [`👉 Xem và trả lời khách: ${process.env.PUBLIC_URL}/admin/u?id=${encodeURIComponent(userId)}`] : []
  const lines = [
    "🔔 KHÁCH NHẮN ZALO OA",
    ...customerLines(userId),
    `💬 Tin nhắn: "${text.length > 300 ? `${text.slice(0, 300)}…` : text}"`,
    `🕒 Lúc: ${clockVN(now)}`,
    ...link,
  ]
  notify.notifyStaff(lines.join("\n"), { branch: region.isBranch(u?.branch) ? u.branch : null }).catch(() => {})
}

const timers = new Map<string, NodeJS.Timeout>()
const busy = new Set<string>()

function schedule(userId: string, ms = debounceMs()) {
  clearTimeout(timers.get(userId))
  timers.set(
    userId,
    setTimeout(async () => {
      timers.delete(userId)
      notifyNewMessage(userId)
      // Ngoài giờ: không trả lời, tới giờ mở bot đọc lại các tin còn chờ (startWorkers).
      if (!inReplyHours()) return
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
  const choice = region.parseChoice(text)
  if (choice.region) db.setRegion(userId, choice.region)
  if (choice.branch) {
    // Khách đổi sang bưu cục khác (bấm lại nút cũ): nhớ bưu cục trước để báo "đã đổi" và báo nhân viên chi nhánh mới.
    const before = db.getUser(userId)?.branch
    if (region.isBranch(before) && before !== choice.branch && !db.getKv(`branch_from:${userId}`)) db.setKv(`branch_from:${userId}`, before)
    db.setBranch(userId, choice.branch)
  }
  // Khách nói nơi ở ("mình ở Nghệ An") thì tự ghi vùng, khỏi phải hỏi bằng nút. Đã có vùng thì không đổi theo câu nhắc tới tỉnh khác.
  const place = !choice.region && !choice.branch && !region.isRegion(db.getUser(userId)?.region) && region.regionFromText(text)
  if (place) db.setRegion(userId, place)
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
  if (!text || db.getKv("bot_enabled") === "0" || !inReplyHours(now)) return
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

// --- Theo dõi vận đơn khách đã hỏi ---
const WATCH_EVERY_MS = 30 * 60_000
const WATCH_MAX_MS = 30 * 86_400_000
// Zalo chỉ cho OA nhắn trong 48 giờ sau tin cuối của khách: quá hạn thì chờ (khách nhắn lại sẽ báo tiếp).
const ZALO_WINDOW_MS = 47 * 3_600_000

/** Tra lại các vận đơn đang theo dõi; giao thành công thì nhắn báo khách rồi thôi theo dõi.
 *  Chạy 24/24; theo dõi tối đa 30 ngày. */
export async function watchShipments(now = Date.now(), lookup = track) {
  // Gom theo khách: nhiều mã cùng giao thành công trong 1 lượt thì báo 1 tin.
  const byUser = new Map<string, Tracking[]>()
  for (const w of db.watches()) {
    if (now - w.created_at > WATCH_MAX_MS) {
      db.unwatchCode(w.user_id, w.code)
      continue
    }
    if (now - w.last_user_at > ZALO_WINDOW_MS) continue
    const t = await lookup(w.code).catch(() => null)
    if (t && isDelivered(t)) byUser.set(w.user_id, [...(byUser.get(w.user_id) ?? []), t])
  }
  for (const [userId, ts] of byUser) {
    const text = deliveredText(ts)
    const id = db.addMessage(userId, "bot", text)
    try {
      await zalo.sendText(userId, text)
      for (const t of ts) db.unwatchCode(userId, t.code)
    } catch (err) {
      db.deleteMessage(id)
      console.error(`Báo giao thành công ${ts.map((t) => t.code).join(", ")} cho ${userId} lỗi:`, err)
    }
  }
}

/** Nhân viên nhập mã vận đơn cho khách (trang hội thoại; nhiều mã cách nhau dấu phẩy / chấm phẩy / xuống dòng):
 *  tra từng mã, nhắn khách 1 tin gộp mã + hành trình hiện tại, mã chưa giao xong thì theo dõi để tự báo khi giao thành công.
 *  Mã sai / không tìm thấy thì không gửi, trả về để báo nhân viên. */
export async function sendTracking(userId: string, raw: string): Promise<{ missing: string[] }> {
  // Khoảng trắng trong 1 mã ("607 000 001") bỏ đi; mã cách nhau bằng , ; hoặc xuống dòng.
  const codes = [...new Set(raw.split(/[,;\n]+/).map((c) => c.replace(/\s/g, "")).filter(Boolean))].slice(0, 10)
  if (!codes.length) throw new Error("Chưa nhập mã vận đơn")
  const found: Tracking[] = [], missing: string[] = []
  for (const code of codes) {
    const t = /^[A-Za-z0-9-]{5,30}$/.test(code) ? await track(code) : null
    if (t) found.push(t)
    else missing.push(code)
  }
  if (!found.length) throw new Error(`Không tìm thấy mã ${missing.join(", ")} trên trang tra cứu NewPost`)
  const text = codesText(found)
  const id = db.addMessage(userId, "bot", text)
  try {
    await zalo.sendText(userId, text)
  } catch (err) {
    db.deleteMessage(id)
    throw err
  }
  for (const t of found) (isDelivered(t) ? db.unwatchCode : db.watchCode)(userId, t.code)
  return { missing }
}

/** Việc chạy nền mỗi phút: hỏi thăm khách im lặng, bot nhận lại khách nhân viên chưa trả lời, tra lại vận đơn (30 phút/lần). */
export function startWorkers() {
  let open = inReplyHours()
  let watchedAt = 0
  setInterval(() => {
    if (Date.now() - watchedAt >= WATCH_EVERY_MS) {
      watchedAt = Date.now()
      watchShipments().catch((err) => console.error("Theo dõi vận đơn lỗi:", err))
    }
    // Vừa tới giờ trả lời: trả lời các tin khách nhắn ngoài giờ (trong 12 giờ qua).
    const nowOpen = inReplyHours()
    if (nowOpen && !open) for (const userId of db.pendingUsers(Date.now() - 12 * 3_600_000)) if (!timers.has(userId)) schedule(userId, 0)
    open = nowOpen
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
