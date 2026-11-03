// Tra cứu vận đơn NewPost qua trang https://newpostglobal.vn/track-api/ (WordPress, plugin logisko):
// trang chứa mã nonce, gửi POST admin-ajax.php action=logisko_track_api, nhận về HTML các mốc hành trình (mới nhất trước).

const PAGE = "https://newpostglobal.vn/track-api/"
const AJAX = "https://newpostglobal.vn/wp-admin/admin-ajax.php"
export const TRACK_PAGE = PAGE
export const TRACK_TAG = /\[TRA_DON:([^\]]*)\]/g

export type TrackEvent = { time: string; title: string; place: string; desc: string }
export type Tracking = { code: string; info: string[]; events: TrackEvent[] }

let nonce: { value: string; at: number } | undefined

async function getNonce(force: boolean) {
  if (!force && nonce && Date.now() - nonce.at < 3_600_000) return nonce.value
  const html = await (await fetch(PAGE, { signal: AbortSignal.timeout(15_000) })).text()
  const value = html.match(/track_order_nonce":"(\w+)"/)?.[1]
  if (!value) throw new Error("Không đọc được mã nonce của trang tra cứu vận đơn")
  nonce = { value, at: Date.now() }
  return value
}

const plain = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim()

/** HTML kết quả → các mốc hành trình. Không có mốc nào (mã sai, chưa có trên hệ thống) thì null. */
export function parseTracking(code: string, html: string): Tracking | null {
  const items = html.split('<li class="timeline-item').slice(1)
  if (!items.length) return null
  const shipping = (html.split('class="shipping-info"')[1] ?? "").split('class="timeline')[0]
  const info = [...shipping.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => plain(m[1])).filter(Boolean)
  const events = items.map((li) => {
    const field = (cls: string) => plain(li.match(new RegExp(`class="${cls}">([\\s\\S]*?)</(?:div|span)>`))?.[1] ?? "")
    return { time: field("timeline-date"), title: field("title"), place: field("location"), desc: field("desc") }
  })
  return { code, info, events }
}

export async function track(code: string): Promise<Tracking | null> {
  for (const force of [false, true]) {
    const res = await fetch(AJAX, {
      method: "POST",
      body: new URLSearchParams({ action: "logisko_track_api", nonce: await getNonce(force), tracking_id: code }),
      signal: AbortSignal.timeout(20_000),
    })
    const html = await res.text()
    // Nonce hết hạn: WordPress trả 403 hoặc "-1" → lấy nonce mới rồi thử lại 1 lần.
    if (res.status === 403 || html.trim() === "-1") continue
    return parseTracking(code, html)
  }
  throw new Error("Trang tra cứu vận đơn từ chối yêu cầu")
}

/** Mốc mới nhất là "Đã giao thành công" (Delivered): đơn đã xong, thôi theo dõi. */
export const isDelivered = (t: Tracking) => /giao thành công/i.test(t.events[0]?.title ?? "") || /^delivered\b/i.test(t.events[0]?.desc ?? "")

/** Câu báo khách mã đang theo dõi (thêm vào câu trả lời khi đơn chưa giao xong). */
export const WATCH_NOTE = "Em đã ghi nhận theo dõi vận đơn này, khi đơn giao thành công em sẽ tự nhắn báo anh/chị ngay ạ."

const at = (t: Tracking) => (t.events[0].time ? ` lúc ${t.events[0].time}` : "")
const THANKS = "Cảm ơn anh/chị đã tin tưởng gửi hàng cùng NewPost Global!"

/** Tin bot tự gửi khi các vận đơn đang theo dõi của 1 khách đã giao thành công (nhiều mã gộp 1 tin). */
export const deliveredText = (ts: Tracking[]) =>
  ts.length === 1
    ? `Dạ em báo anh/chị: vận đơn ${ts[0].code} đã giao thành công${at(ts[0])} ạ. ${THANKS}`
    : `Dạ em báo anh/chị: các vận đơn sau đã giao thành công ạ:\n${ts.map((t) => `- ${t.code}${at(t)}`).join("\n")}\n${THANKS}`

/** Tin gửi khách khi nhân viên nhập mã vận đơn: mã + hành trình hiện tại; còn mã chưa giao thì báo đang theo dõi. */
export function codesText(ts: Tracking[]) {
  const line = (t: Tracking) => {
    const e = t.events[0]
    return `${e.title}${e.place ? ` tại ${e.place}` : ""} (cập nhật ${e.time})`
  }
  const pending = ts.filter((t) => !isDelivered(t))
  if (!pending.length) return deliveredText(ts)
  const note = pending.length === 1 && ts.length === 1 ? WATCH_NOTE
    : "Em đã ghi nhận theo dõi các vận đơn chưa giao xong, khi giao thành công em sẽ tự nhắn báo anh/chị ngay ạ."
  return ts.length === 1
    ? `Dạ em gửi anh/chị mã vận đơn: ${ts[0].code}\nHành trình hiện tại: ${line(ts[0])}.\n${note}`
    : `Dạ em gửi anh/chị các mã vận đơn và hành trình hiện tại:\n${ts.map((t) => `- ${t.code}: ${line(t)}`).join("\n")}\n${note}`
}

const event = (e: TrackEvent) => [e.time, e.title, e.place, e.desc].filter(Boolean).join(" | ")

/** Đổi các thẻ [TRA_DON: mã] thành kết quả tra cho AI viết câu trả lời, kèm câu trả lời code tự viết (dự phòng khi AI lỗi). */
export async function trackResult(reply: string, lookup = track) {
  const codes = [...new Set([...reply.matchAll(TRACK_TAG)].map((m) => m[1].replace(/\s/g, "")))]
    .filter((c) => /^[A-Za-z0-9-]{5,30}$/.test(c))
    .slice(0, 5)
  const ai = [
    "",
    "# BƯỚC TRA VẬN ĐƠN ĐÃ XONG",
    "Hệ thống đã tra các mã khách hỏi (kết quả bên dưới). Bây giờ CHỈ viết câu trả lời gửi khách bằng lời. TUYỆT ĐỐI KHÔNG viết thẻ [TRA_DON].",
    "# KẾT QUẢ TRA VẬN ĐƠN (từ hệ thống tra cứu NewPost, mốc mới nhất trước)",
  ]
  const customer: string[] = []
  const status: { code: string; done: boolean }[] = []
  for (const code of codes) {
    let t: Tracking | null
    try {
      t = await lookup(code)
    } catch (err) {
      console.error(`Tra vận đơn ${code} lỗi:`, err instanceof Error ? err.message : err)
      ai.push(`Mã ${code}: hệ thống tra cứu đang lỗi, chưa tra được.`)
      customer.push(`Dạ hệ thống tra cứu mã ${code} đang bận, anh/chị tra lại giúp em tại ${PAGE} hoặc để lại số điện thoại để nhân viên kiểm tra ạ.`)
      continue
    }
    if (!t) {
      ai.push(`Mã ${code}: KHÔNG tìm thấy trên hệ thống (mã sai hoặc chưa được tạo).`)
      customer.push(`Dạ em chưa tìm thấy mã vận đơn ${code} trên hệ thống, anh/chị kiểm tra lại giúp em mã vận đơn ạ.`)
      continue
    }
    const [last, ...prev] = t.events
    const done = isDelivered(t)
    status.push({ code, done })
    ai.push(`Mã ${code}${t.info.length ? ` (${t.info.join("; ")})` : ""}: ${done ? "ĐÃ GIAO THÀNH CÔNG (đơn hoàn thành)" : "CHƯA GIAO XONG – hệ thống đã tự theo dõi mã này"}`,
      `- MỚI NHẤT: ${event(last)}`, ...prev.slice(0, 4).map((e) => `- Trước đó: ${event(e)}`))
    customer.push(`Dạ mã vận đơn ${code}: ${last.title}${last.place ? ` tại ${last.place}` : ""} (cập nhật ${last.time})${last.desc ? `. ${last.desc}` : ""}.${done ? "" : ` ${WATCH_NOTE}`}`)
  }
  ai.push(
    "Cách trả lời: báo trạng thái MỚI NHẤT của từng mã (thời gian, nơi, nội dung; mô tả tiếng Anh thì dịch sang tiếng Việt), có thể nhắc ngắn 1–2 mốc trước.",
    "KHÔNG bịa thêm thông tin, KHÔNG hứa ngày giao. Mã không tìm thấy: nhờ khách kiểm tra lại mã. Tra cứu lỗi, khách khiếu nại hoặc hàng chậm bất thường:",
    `xin số điện thoại để nhân viên kiểm tra. Có thể gửi link để khách tự theo dõi: ${PAGE}`,
    `Mã CHƯA GIAO XONG: cuối câu trả lời PHẢI báo khách: "${WATCH_NOTE}". Mã ĐÃ GIAO THÀNH CÔNG: báo đơn đã hoàn thành, không nói theo dõi.`,
  )
  return { forAi: ai.join("\n"), forCustomer: customer.join("\n"), status }
}
