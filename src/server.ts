import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { extname } from "node:path"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import * as ai from "./ai.ts"
import * as bot from "./bot.ts"
import * as db from "./db.ts"
import { deleteKnowledgeFile, fileToText, listKnowledgeFiles, saveKnowledgeFile } from "./import.ts"
import { deletePriceService, listPriceServices, parsePriceWorkbook, savePriceService } from "./price.ts"
import * as views from "./views.ts"
import * as zalo from "./zalo.ts"
import * as zns from "./zns.ts"

const env = process.env
const TEST_USER = "test-admin"
const KIND: Record<string, string> = {
  image: "hình ảnh", sticker: "sticker", file: "tệp", audio: "tin nhắn thoại",
  video: "video", gif: "ảnh GIF", location: "vị trí", link: "liên kết",
}

for (const k of ["PUBLIC_URL", "ZALO_APP_ID", "ZALO_APP_SECRET", "ZALO_OA_SECRET_KEY", "GEMINI_API_KEY", "ADMIN_PASSWORD"]) {
  if (!env[k]) console.warn(`⚠ Thiếu ${k} trong file .env`)
}

const readBody = async (req: IncomingMessage, limit = 1_000_000) => (await readRaw(req, limit)).toString("utf8")

function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error("Body quá lớn"))
        req.destroy()
      } else chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

const mask = (k: string | undefined) => (k ? `••••${k.slice(-4)}` : "")

function aiView(flash: string, error: string) {
  const keys = Object.fromEntries(
    (Object.keys(ai.PROVIDERS) as ai.Provider[]).map((p) => [p, mask(db.getKv(`ai_key_${p}`) || (p === "gemini" ? env.GEMINI_API_KEY : ""))]),
  ) as Record<ai.Provider, string>
  return views.aiPage({ cfg: ai.currentConfig(), keys, flash, error })
}

function send(res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type })
  res.end(body)
}

function redirect(res: ServerResponse, to: string) {
  res.writeHead(303, { Location: to })
  res.end()
}

const sha = (s: string) => createHash("sha256").update(s).digest()
const safeEqual = (a: string, b: string) => timingSafeEqual(sha(a), sha(b))

// --- Đăng nhập: cookie "sid" = "<hạn dùng>.<chữ ký>", không cần lưu phiên ở server. ---
// Khóa ký lấy từ mật khẩu: đổi ADMIN_PASSWORD là mọi phiên cũ tự hết hiệu lực.
const SESSION_MS = 7 * 24 * 3_600_000
const sign = (exp: string) => createHmac("sha256", `session:${env.ADMIN_PASSWORD}:${env.ZALO_APP_SECRET ?? ""}`).update(exp).digest("hex")

function isLoggedIn(req: IncomingMessage): boolean {
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? "")?.[1] ?? ""
  const [exp, mac] = sid.split(".")
  return !!env.ADMIN_PASSWORD && !!exp && !!mac && Number(exp) > Date.now() && safeEqual(mac, sign(exp))
}

function setSession(req: IncomingMessage, res: ServerResponse, value: string, maxAgeSec: number) {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""
  res.setHeader("Set-Cookie", `sid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`)
}

// Chống dò mật khẩu: sai 5 lần trong 15 phút (theo IP) thì tạm khóa.
// ponytail: đếm trong bộ nhớ, mất khi server khởi động lại; đủ cho 1 tiến trình
const failedLogins = new Map<string, number[]>()
// IP thật của khách: Cloudflare Tunnel gửi cf-connecting-ip, Caddy trên VPS gửi x-forwarded-for.
const clientIp = (req: IncomingMessage) =>
  String(req.headers["cf-connecting-ip"] || String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress)
function recentFails(ip: string) {
  const list = (failedLogins.get(ip) ?? []).filter((t) => Date.now() - t < 15 * 60_000)
  failedLogins.set(ip, list)
  return list
}

/** Chỉ cho quay về trang trong /admin sau khi đăng nhập (tránh chuyển hướng ra trang lạ). */
const safeNext = (next: string | null) => (next && /^\/admin(\/|\?|#|$)/.test(next) ? next : "/admin")

/** Chặn trang web lạ gửi form thay nhân viên (CSRF). */
function sameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin
  const allowed = [req.headers.host, env.PUBLIC_URL && new URL(env.PUBLIC_URL).host]
  return !origin || allowed.includes(new URL(origin).host)
}

async function handleLogin(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!env.ADMIN_PASSWORD) return send(res, 503, "Chưa đặt ADMIN_PASSWORD trong file .env", "text/plain; charset=utf-8")
  if (req.method !== "POST") {
    if (isLoggedIn(req)) return redirect(res, safeNext(url.searchParams.get("next")))
    return send(res, 200, views.loginPage(safeNext(url.searchParams.get("next"))))
  }
  if (!sameOrigin(req)) return send(res, 403, "Sai nguồn gửi form", "text/plain; charset=utf-8")
  const form = new URLSearchParams(await readBody(req, 10_000))
  const next = safeNext(form.get("next"))
  const ip = clientIp(req)
  if (recentFails(ip).length >= 5) {
    return send(res, 429, views.loginPage(next, "Nhập sai quá nhiều lần. Thử lại sau 15 phút."))
  }
  if (!safeEqual(form.get("password") ?? "", env.ADMIN_PASSWORD)) {
    recentFails(ip).push(Date.now())
    return send(res, 401, views.loginPage(next, "Mật khẩu chưa đúng."))
  }
  failedLogins.delete(ip)
  const exp = String(Date.now() + SESSION_MS)
  setSession(req, res, `${exp}.${sign(exp)}`, SESSION_MS / 1000)
  redirect(res, next)
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse) {
  const raw = await readBody(req)
  let e: any
  try {
    e = JSON.parse(raw)
  } catch {
    return send(res, 400, "bad json", "text/plain")
  }
  const signature = String(req.headers["x-zevent-signature"] ?? "")
  if (e.app_id !== env.ZALO_APP_ID || !zalo.verifySignature(raw, e.app_id, String(e.timestamp), signature, env.ZALO_OA_SECRET_KEY ?? "")) {
    // Trả 200 để Zalo không gửi lại (và để nút "Kiểm tra" của Zalo qua được), nhưng KHÔNG xử lý.
    console.warn(`Bỏ qua webhook ${e.event_name}: sai app_id hoặc chữ ký (kiểm tra ZALO_APP_ID / ZALO_OA_SECRET_KEY)`)
    return send(res, 200, "ignored", "text/plain")
  }

  const ev = String(e.event_name)
  const msg = e.message ?? {}
  if (ev.startsWith("user_send_") && e.sender?.id) {
    const kind = ev.slice("user_send_".length)
    bot.onUserMessage(e.sender.id, msg.text || `[Khách gửi ${KIND[kind] ?? kind}]`, msg.msg_id)
  } else if (ev === "user_submit_info" && e.sender?.id) {
    bot.onUserInfo(e.sender.id, e.info ?? {}, `info-${e.sender.id}-${e.timestamp}`)
  } else if (ev.startsWith("oa_send_") && e.recipient?.id) {
    const kind = ev.slice("oa_send_".length)
    bot.onOaMessage(e.recipient.id, msg.text || `[Gửi ${KIND[kind] ?? kind}]`, msg.msg_id)
  }
  send(res, 200, "ok", "text/plain")
}

// --- Ảnh gửi khách ---
const IMAGE_DIR = "data/images"
const MB = 1024 * 1024
// Định dạng và dung lượng Zalo nhận khi OA gửi ảnh.
const IMAGE_EXT: Record<string, { ext: string; max: number }> = {
  "image/jpeg": { ext: ".jpg", max: MB }, "image/png": { ext: ".png", max: MB }, "image/gif": { ext: ".gif", max: 5 * MB },
}

const imagesBack = (res: ServerResponse, msg: string) => redirect(res, `/admin/images?msg=${encodeURIComponent(msg)}`)

async function uploadImage(req: IncomingMessage, res: ServerResponse) {
  // Response chuẩn của Node tự đọc multipart/form-data, khỏi cần thư viện.
  const body = await readRaw(req, 6 * MB)
  const form = await new Response(new Uint8Array(body), { headers: { "Content-Type": String(req.headers["content-type"]) } }).formData()
  const file = form.get("file")
  const name = String(form.get("name") ?? "").trim()
  const usage = String(form.get("usage") ?? "").trim()
  if (!(file instanceof File) || !file.size) return imagesBack(res, "Chưa chọn ảnh.")
  const kind = IMAGE_EXT[file.type]
  if (!kind) return imagesBack(res, `Zalo chỉ nhận ảnh JPG, PNG hoặc GIF (ảnh này là ${file.type || "không rõ định dạng"}). Hãy lưu lại ảnh dạng JPG rồi tải lên.`)
  if (file.size > kind.max) {
    return imagesBack(res, `Ảnh nặng ${(file.size / MB).toFixed(1)} MB, Zalo chỉ nhận tối đa ${kind.max / MB} MB. Hãy nén ảnh (ví dụ tinypng.com) rồi tải lại.`)
  }
  await mkdir(IMAGE_DIR, { recursive: true })
  const stored = `${Date.now()}-${randomBytes(4).toString("hex")}${kind.ext}`
  await writeFile(`${IMAGE_DIR}/${stored}`, Buffer.from(await file.arrayBuffer()))
  const label = name || file.name.replace(/\.[^.]+$/, "")
  db.addImage(label, usage, stored)
  imagesBack(res, `Đã tải ảnh "${label}". Bot sẽ gửi ảnh này khi gặp đúng tình huống đã mô tả.`)
}

const settingsBack = (res: ServerResponse, msg: string) => redirect(res, `/admin/settings?msg=${encodeURIComponent(msg)}`)

/** Nạp một hay nhiều file: Excel bảng giá dạng chuẩn thành bảng tính giá (thay bảng cũ cùng hãng),
 *  file khác thành kiến thức chữ (nạp lại cùng tên thì thay bản cũ). */
async function uploadKnowledge(req: IncomingMessage, res: ServerResponse) {
  const body = await readRaw(req, 30 * MB)
  const form = await new Response(new Uint8Array(body), { headers: { "Content-Type": String(req.headers["content-type"]) } }).formData()
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0)
  if (!files.length) return settingsBack(res, "Chưa chọn file.")
  const msgs: string[] = []
  for (const file of files) {
    try {
      const buf = Buffer.from(await file.arrayBuffer())
      const prices = /\.xlsx$/i.test(file.name) ? parsePriceWorkbook(file.name, buf) : null
      if (prices) {
        const replaced = savePriceService(prices)
        msgs.push(`${replaced ? "Đã thay" : "Đã nạp"} bảng giá ${prices.name} (${prices.goods.zones.length} vùng).`)
        continue
      }
      const text = fileToText(file.name, buf).trim()
      if (!text) {
        msgs.push(`File "${file.name}" không có chữ nào.`)
        continue
      }
      const { name, replaced } = saveKnowledgeFile(file.name, text)
      msgs.push(replaced ? `Đã thay file "${name}" bằng bản mới.` : `Đã nạp file "${name}".`)
    } catch (e) {
      msgs.push(`${file.name}: ${(e as Error).message}`)
    }
  }
  settingsBack(res, `${msgs.join(" ")} Bot dùng nội dung mới từ tin nhắn tiếp theo.`)
}

/** "YYYY-MM-DD" theo giờ Việt Nam → [0h ngày đó, 0h ngày sau). Sai hoặc trống thì lấy hôm nay. */
function dayRange(date: string | null) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) ? date : today
  const from = Date.parse(`${day}T00:00:00+07:00`)
  return { day, from, to: from + 86_400_000 }
}

function statsData(date: string | null) {
  const { day, from, to } = dayRange(date)
  return { day, customers: db.customersBetween(from, to, bot.HANDOVER_REPLY), orders: db.ordersBetween(from, to) }
}

async function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!isLoggedIn(req)) {
    if (req.method === "GET") return redirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`)
    return send(res, 401, "Phiên đăng nhập đã hết, hãy đăng nhập lại", "text/plain; charset=utf-8")
  }

  let form = new URLSearchParams()
  if (req.method === "POST") {
    if (!sameOrigin(req)) return send(res, 403, views.errorPage("Sai nguồn gửi form"))
    if (url.pathname === "/admin/images") return await uploadImage(req, res)
    if (url.pathname === "/admin/knowledge/upload") return await uploadKnowledge(req, res)
    form = new URLSearchParams(await readBody(req))
  }
  const route = `${req.method} ${url.pathname}`
  const id = url.searchParams.get("id") ?? form.get("id") ?? ""

  if (!zns.ENABLED && url.pathname.startsWith("/admin/zns")) return send(res, 404, views.errorPage("Không tìm thấy trang"))

  switch (route) {
    case "GET /admin":
      return send(res, 200, views.dashboard({
        users: db.listUsers().filter((u) => u.id !== TEST_USER),
        botEnabled: db.getKv("bot_enabled") !== "0",
        zaloConnected: !!db.getKv("refresh_token"),
        tokenExpires: Number(db.getKv("expires_at") ?? 0),
      }))
    case "POST /admin/toggle":
      db.setKv("bot_enabled", db.getKv("bot_enabled") === "0" ? "1" : "0")
      return redirect(res, "/admin")
    case "GET /admin/u":
      return send(res, 200, views.conversation(db.getUser(id), id, db.history(id, 200), url.searchParams.get("err") ?? ""))
    case "POST /admin/u/bot":
      db.pauseBot(id, form.get("action") === "pause" ? bot.STAFF_MODE_MINUTES : 0)
      return redirect(res, `/admin/u?id=${encodeURIComponent(id)}#latest`)
    case "POST /admin/u/send": {
      const text = form.get("text")?.trim()
      let err = ""
      if (text) {
        try {
          await bot.staffSend(id, text)
        } catch (e) {
          console.error(`Nhân viên gửi tin cho ${id} lỗi:`, e)
          err = e instanceof Error ? e.message : "Gửi tin thất bại"
        }
      }
      // Trang gửi bằng JavaScript: trả JSON, không tải lại trang.
      if (req.headers["x-requested-with"] === "fetch") {
        return send(res, err ? 502 : 200, JSON.stringify({ ok: !err, error: err }), "application/json; charset=utf-8")
      }
      return redirect(res, `/admin/u?id=${encodeURIComponent(id)}${err ? `&err=${encodeURIComponent(err)}` : ""}#latest`)
    }
    case "GET /admin/u/new": {
      const msgs = db.messagesAfter(id, Number(url.searchParams.get("after")) || 0)
      return send(res, 200, JSON.stringify({ html: views.messagesHtml(msgs), last: msgs.at(-1)?.id ?? null }), "application/json; charset=utf-8")
    }
    case "GET /admin/zns": {
      const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
      let templates: { id: string; name: string }[] = []
      let templatesError = ""
      let selected: zns.Template | null = null
      let selectedError = ""
      try {
        templates = await zns.listTemplates()
      } catch (e) {
        templatesError = errMsg(e)
      }
      const tid = url.searchParams.get("template")?.trim()
      if (tid) {
        try {
          selected = await zns.templateInfo(tid)
        } catch (e) {
          selectedError = errMsg(e)
        }
      }
      return send(res, 200, views.znsPage({
        templates, templatesError, selected, selectedError,
        jobs: db.listZnsJobs(), counts: db.znsCounts(), optouts: db.listOptOut(), flash: url.searchParams.get("msg") ?? "",
      }))
    }
    case "POST /admin/zns/queue": {
      const back = (msg: string) => redirect(res, `/admin/zns?template=${encodeURIComponent(form.get("template") ?? "")}&msg=${encodeURIComponent(msg)}`)
      if (form.get("consent") !== "1") return back("Cần xác nhận khách đã đồng ý nhận tin.")
      const t = await zns.templateInfo(form.get("template") ?? "")
      const { valid, invalid } = zns.parseList(form.get("list") ?? "")
      if (valid.length > 5000) return back("Danh sách quá 5.000 số, hãy chia nhỏ.")
      const missing = t.params.filter((x) => x.require && !form.get(`p_${x.name}`)?.trim())
      if (missing.length) return back(`Chưa điền: ${missing.map((x) => x.name).join(", ")}.`)
      const optedOut = valid.filter((c) => db.isOptedOut(c.phone))
      const jobs = valid
        .filter((c) => !db.isOptedOut(c.phone))
        .map((c) => ({
          phone: c.phone, name: c.name, templateId: t.id, templateName: t.name, tag: t.tag,
          data: Object.fromEntries(t.params.map((x) => [x.name, (form.get(`p_${x.name}`) ?? "").replaceAll("{ten}", c.name || "Quý khách").trim()])),
        }))
      const added = db.queueZnsJobs(jobs)
      const notes = [`Đã đưa ${added} khách vào hàng chờ gửi.`]
      if (jobs.length - added) notes.push(`${jobs.length - added} số đã từng được gửi mẫu này nên bỏ qua.`)
      if (optedOut.length) notes.push(`${optedOut.length} số đã từ chối nhận tin nên bỏ qua.`)
      if (invalid.length) notes.push(`${invalid.length} dòng sai số điện thoại: ${invalid.slice(0, 5).join("; ")}${invalid.length > 5 ? "…" : ""}`)
      return back(notes.join(" "))
    }
    case "POST /admin/zns/cancel":
      return redirect(res, `/admin/zns?msg=${encodeURIComponent(`Đã dừng ${db.cancelPendingZns()} tin đang chờ gửi.`)}`)
    case "POST /admin/zns/retry":
      return redirect(res, `/admin/zns?msg=${encodeURIComponent(`Đã đưa ${db.retryFailedZns()} tin lỗi vào hàng chờ gửi lại.`)}`)
    case "POST /admin/zns/optout": {
      const { valid, invalid } = zns.parseList(form.get("phones") ?? "")
      db.addOptOut(valid.map((c) => c.phone))
      const msg = `Đã thêm ${valid.length} số vào danh sách từ chối.${invalid.length ? ` ${invalid.length} dòng sai định dạng.` : ""}`
      return redirect(res, `/admin/zns?msg=${encodeURIComponent(msg)}`)
    }
    case "GET /admin/test":
      return send(res, 200, views.testChat(db.history(TEST_USER, 100), db.isPaused(TEST_USER)))
    case "POST /admin/test":
      if (form.get("reset")) db.clearUser(TEST_USER)
      else if (form.get("text")?.trim()) {
        db.addMessage(TEST_USER, "user", form.get("text")!.trim())
        let err = ""
        try {
          await bot.answer(TEST_USER)
        } catch (e) {
          err = e instanceof Error ? e.message : "Bot trả lời lỗi"
        }
        // Trang gửi bằng JavaScript: trả JSON, trang tự lấy tin mới, không tải lại.
        if (req.headers["x-requested-with"] === "fetch") {
          return send(res, err ? 502 : 200, JSON.stringify({ ok: !err, error: err }), "application/json; charset=utf-8")
        }
      }
      return redirect(res, "/admin/test#latest")
    case "GET /admin/settings":
      return send(res, 200, views.settings(
        await readFile("data/prompt.md", "utf8"),
        ai.readMainKnowledge(),
        url.searchParams.has("saved"),
        db.getKv("follow_up_text") ?? bot.FOLLOW_UP_DEFAULT,
        url.searchParams.get("msg") ?? "",
        listKnowledgeFiles(),
        listPriceServices(),
      ))
    case "POST /admin/price/delete": {
      const code = form.get("code") ?? ""
      return settingsBack(res, deletePriceService(code) ? `Đã xóa bảng giá ${code}. Bot không báo giá dịch vụ này nữa.` : "Không tìm thấy bảng giá cần xóa.")
    }
    case "POST /admin/knowledge/delete": {
      const name = form.get("name") ?? ""
      return settingsBack(res, deleteKnowledgeFile(name) ? `Đã xóa file "${name}". Bot không dùng kiến thức trong file này nữa.` : "Không tìm thấy file cần xóa.")
    }
    case "POST /admin/settings":
      await writeFile("data/prompt.md", form.get("prompt") ?? "")
      await writeFile("data/knowledge.md", form.get("knowledge") ?? "")
      db.setKv("follow_up_text", form.get("follow_up")?.trim() ?? "")
      return redirect(res, "/admin/settings?saved")
    case "GET /admin/images":
      return send(res, 200, views.imagesPage(db.listImages(), url.searchParams.get("msg") ?? ""))
    case "GET /admin/images/file": {
      const img = db.getImage(Number(id))
      if (!img) return send(res, 404, "Không có ảnh", "text/plain; charset=utf-8")
      res.writeHead(200, { "Content-Type": bot.IMAGE_TYPE[extname(img.file)] ?? "image/jpeg", "Cache-Control": "private, max-age=86400" })
      return res.end(await readFile(`${IMAGE_DIR}/${img.file}`))
    }
    case "POST /admin/images/edit": {
      const img = db.getImage(Number(id))
      if (!img) return imagesBack(res, "Ảnh không còn.")
      db.updateImage(img.id, form.get("name")?.trim() || img.name, form.get("usage")?.trim() ?? "")
      return imagesBack(res, `Đã lưu ảnh "${form.get("name")?.trim() || img.name}".`)
    }
    case "POST /admin/images/delete": {
      const img = db.getImage(Number(id))
      if (img) {
        db.deleteImage(img.id)
        await rm(`${IMAGE_DIR}/${img.file}`, { force: true })
      }
      return imagesBack(res, img ? `Đã xóa ảnh "${img.name}".` : "Ảnh không còn.")
    }
    case "GET /admin/stats":
      return send(res, 200, views.statsPage(statsData(url.searchParams.get("date"))))
    case "GET /admin/stats.csv": {
      const s = statsData(url.searchParams.get("date"))
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="khach-hang-${s.day}.csv"`,
      })
      return res.end(views.statsCsv(s))
    }
    case "GET /admin/ai":
      return send(res, 200, aiView(url.searchParams.get("msg") ?? "", ""))
    case "POST /admin/ai": {
      const provider = form.get("provider") as ai.Provider
      if (!(provider in ai.PROVIDERS)) return send(res, 400, views.errorPage("Hãng AI không hợp lệ"))
      const key = form.get("key")?.trim() || db.getKv(`ai_key_${provider}`) || (provider === "gemini" ? env.GEMINI_API_KEY ?? "" : "")
      const cfg = { provider, model: form.get("model")?.trim() ?? "", key }
      try {
        // Thử trước, chỉ lưu khi model trả lời được để bot đang chạy không bị hỏng vì key/model sai.
        const reply = await ai.generateReply([{ role: "user", text: "Xin chào" } as db.Message], cfg)
        db.setKv("ai_provider", provider)
        db.setKv("ai_model", cfg.model)
        if (form.get("key")?.trim()) db.setKv(`ai_key_${provider}`, key)
        return redirect(res, `/admin/ai?msg=${encodeURIComponent(`Đã chuyển sang ${cfg.model}. Model trả lời thử: "${reply.slice(0, 120)}"`)}`)
      } catch (err) {
        return send(res, 200, aiView("", err instanceof Error ? err.message : String(err)))
      }
    }
    case "GET /admin/zalo/connect":
      return redirect(res, zalo.authUrl())
    case "GET /admin/zalo/callback":
      await zalo.exchangeCode(url.searchParams.get("code") ?? "", url.searchParams.get("state") ?? "")
      return redirect(res, "/admin")
  }
  send(res, 404, views.errorPage("Không tìm thấy trang"))
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost")
  try {
    if (url.pathname === "/webhook/zalo") {
      // Zalo kiểm tra URL phải trả 200 khi lưu cấu hình webhook
      return req.method === "POST" ? await handleWebhook(req, res) : send(res, 200, "ok", "text/plain")
    }
    if (url.pathname === "/login") return await handleLogin(req, res, url)
    if (url.pathname === "/logout" && req.method === "POST") {
      if (!sameOrigin(req)) return send(res, 403, "Sai nguồn gửi form", "text/plain; charset=utf-8")
      setSession(req, res, "", 0)
      return redirect(res, "/login")
    }
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return await handleAdmin(req, res, url)
    // Ảnh trên tin "chia sẻ số điện thoại" (Zalo tải ảnh qua đường link công khai).
    if (url.pathname === "/chia-se-sdt.png") {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" })
      return res.end(await readFile("public/chia-se-sdt.png"))
    }
    // File xác thực tên miền do Zalo cấp: đặt vào thư mục public/
    const verifier = url.pathname.match(/^\/(zalo_verifier[\w-]+\.html)$/)
    if (verifier) return send(res, 200, await readFile(`public/${verifier[1]}`, "utf8"))
    if (url.pathname === "/") {
      // Thẻ meta xác thực tên miền (cách thứ 2 Zalo chấp nhận, ngoài file trong public/)
      const meta = env.ZALO_SITE_VERIFICATION
        ? `<meta name="zalo-platform-site-verification" content="${views.esc(env.ZALO_SITE_VERIFICATION)}" />`
        : ""
      return send(res, 200, `<!doctype html><html><head><meta charset="utf-8">${meta}</head><body>Zalo CSKH đang chạy</body></html>`)
    }
    send(res, 404, "Not found", "text/plain")
  } catch (err) {
    console.error(`${req.method} ${url.pathname} lỗi:`, err)
    if (!res.headersSent) send(res, 500, views.errorPage(err instanceof Error ? err.message : "Lỗi máy chủ"))
  }
}).listen(Number(env.PORT || 3000), () => {
  console.log(`Zalo CSKH chạy tại http://localhost:${env.PORT || 3000}  (trang quản trị: /admin)`)
  bot.resumePending()
  bot.startWorkers()
  if (zns.ENABLED) zns.startWorker()
})
