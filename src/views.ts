import type { DayCustomer, Image, Message, Order, User, UserRow, ZnsJob, ZnsStatus } from "./db.ts"
import { ENABLED as ZNS_ENABLED, TAG_LABEL, type Template } from "./zns.ts"
import { PROVIDERS, type AiConfig, type Provider } from "./ai.ts"

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

const TZ = "Asia/Ho_Chi_Minh"
const fullTime = (ms: number) => (ms ? new Date(ms).toLocaleString("vi-VN", { timeZone: TZ }) : "")
/** Hôm nay: "21:37" – ngày khác: "19/10 14:25". */
function shortTime(ms: number) {
  if (!ms) return ""
  const d = new Date(ms)
  const day = (x: Date) => x.toLocaleDateString("vi-VN", { timeZone: TZ })
  const hm = d.toLocaleTimeString("vi-VN", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })
  if (day(d) === day(new Date())) return hm
  const [dd, mm] = day(d).split(/\D+/)
  return `${dd.padStart(2, "0")}/${mm.padStart(2, "0")} ${hm}`
}
const isPaused = (u?: User) => !!u && u.paused_until > Date.now()
const displayName = (u: { id: string; name: string | null }) => u.name || `Khách …${u.id.slice(-4)}`
const initial = (u: { id: string; name: string | null }) => (u.name?.trim().split(/\s+/).at(-1)?.[0] ?? "K").toUpperCase()

const CSS = `
:root{--ink:#142033;--ink-2:#1F2E46;--paper:#F4F6F9;--surface:#fff;--line:#DCE2EA;--muted:#5F6F84;
--tape:#FFC42E;--tape-soft:#FFF4D1;--signal:#C8372A;--bot:#E6EDF7;--ok:#1F7A47;--focus:#2B6CDF}
*{box-sizing:border-box}
body{margin:0;font:15px/1.55 "Be Vietnam Pro",system-ui,sans-serif;color:var(--ink);background:var(--paper)}
a{color:inherit}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.shell{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100vh}
.side{background:var(--ink);color:#fff;padding:28px 14px;display:flex;flex-direction:column;gap:32px;position:sticky;top:0;height:100vh}
.brand{font-weight:700;font-size:18px;line-height:1.25;padding:0 10px}
.brand span{display:block;font-weight:400;font-size:13px;color:#A9B6C8;margin-top:2px}
.nav{display:flex;flex-direction:column;gap:2px}
.nav a{color:#D3DCE8;text-decoration:none;padding:9px 10px 9px 13px;border-radius:6px}
.nav a:hover{background:var(--ink-2);color:#fff}
.nav a[aria-current=page]{color:#fff;background:var(--ink-2);box-shadow:inset 3px 0 0 var(--tape)}
.main{padding:32px clamp(16px,4vw,48px) 48px;max-width:1080px;width:100%}
h1{font-size:26px;line-height:1.2;margin:0 0 20px;font-weight:700;letter-spacing:-.01em}
h2{font-size:15px;font-weight:600;margin:0 0 10px}
.muted{color:var(--muted)}
.btn{font:inherit;font-weight:600;font-size:14px;padding:8px 14px;border-radius:6px;border:1px solid var(--ink);
background:var(--ink);color:#fff;cursor:pointer;text-decoration:none;display:inline-block;line-height:1.4}
.btn:hover{background:var(--ink-2)}
.btn.ghost{background:var(--surface);color:var(--ink);border-color:var(--line)}
.btn.ghost:hover{border-color:var(--muted)}
.btn.tape{background:var(--tape);border-color:var(--tape);color:var(--ink)}
.status{display:flex;flex-wrap:wrap;gap:12px 28px;align-items:center;padding:12px 16px;background:var(--surface);
border:1px solid var(--line);border-radius:8px;margin-bottom:32px}
.status form{margin:0;display:flex;align-items:center;gap:10px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:8px;background:var(--ok);vertical-align:middle}
.dot.off{background:var(--signal)}
.off-text{color:var(--signal);font-weight:600}
.group{margin-bottom:32px}
.group h2 .muted{font-weight:400}
.tape-band{height:8px;border-radius:8px 8px 0 0;background:repeating-linear-gradient(-45deg,var(--tape) 0 12px,var(--ink) 12px 24px)}
.list{list-style:none;margin:0;padding:0;background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden}
.tape-band+.list{border-top:0;border-radius:0 0 8px 8px}
.list li+li{border-top:1px solid var(--line)}
.row{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:14px;align-items:center;padding:12px 16px;text-decoration:none}
.row:hover{background:#F8FAFC}
.avatar{width:40px;height:40px;border-radius:50%;background:var(--bot);display:grid;place-items:center;font-weight:600}
.waiting .avatar{background:var(--tape)}
.who{font-weight:600;display:block}
.preview{display:block;color:var(--muted);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.when{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.empty{padding:24px 16px;color:var(--muted)}
.head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px 24px;align-items:flex-start;margin-bottom:20px}
.head h1{margin:0}
.head form{margin:0}
.back{display:inline-block;margin-bottom:12px;color:var(--muted);text-decoration:none;font-size:14px}
.back:hover{color:var(--ink)}
.banner{padding:12px 16px;border-radius:8px;background:var(--tape-soft);border:1px solid var(--tape);margin:0 0 20px}
.convo-top{position:sticky;top:0;z-index:2;background:var(--paper);margin:-32px 0 16px;padding:24px 0 12px;border-bottom:1px solid var(--line)}
.convo-top .head{margin-bottom:0}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px 18px}
.panel h2{margin-bottom:8px}
.stack{display:flex;flex-direction:column;gap:6px;max-width:640px}
.stack label{font-weight:600;margin-top:6px}
.stack input:not([type=checkbox]),.stack select,.inline select,.inline input{font:inherit;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)}
.inline{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.inline select{max-width:100%}
.hint{margin:0;font-size:13px;color:var(--muted)}
.stack label.check{font-weight:400;display:flex;gap:8px;align-items:flex-start;margin-top:10px}
.stack label.check input{margin-top:4px}
code{background:var(--bot);padding:1px 5px;border-radius:4px;font-size:13px}
.btn[disabled]{opacity:.45;cursor:not-allowed}
.table-wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:8px}
.jobs{border-collapse:collapse;width:100%;font-size:14px}
.jobs th,.jobs td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
.jobs th{font-weight:600;color:var(--muted);white-space:nowrap}
.jobs tr:last-child td{border-bottom:0}
.jobs td:first-child{font-variant-numeric:tabular-nums;white-space:nowrap}
.st{display:inline-block;padding:1px 8px;border-radius:10px;font-size:13px;font-weight:600;background:var(--bot)}
.st.sent{background:#DDF1E5;color:var(--ok)}
.st.failed{background:#FCECEA;color:var(--signal)}
.st.pending{background:var(--tape-soft)}
.st.skipped{color:var(--muted)}
.banner.error{background:#FCECEA;border-color:var(--signal)}
.seg{display:inline-flex;margin:0;padding:3px;background:var(--surface);border:1px solid var(--line);border-radius:8px}
.seg button{font:inherit;font-weight:600;font-size:14px;padding:7px 14px;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer}
.seg button:hover{color:var(--ink)}
.seg button[aria-pressed=true]{background:var(--ink);color:#fff}
.seg button[value=pause][aria-pressed=true]{background:var(--tape);color:var(--ink)}
.thread{display:flex;flex-direction:column;gap:10px;padding:4px 0 24px}
.msg{max-width:min(580px,85%);padding:10px 14px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}
.msg .meta{display:block;font-size:12px;color:var(--muted);margin-bottom:3px}
.msg.user{align-self:flex-start;background:var(--surface);border:1px solid var(--line);border-bottom-left-radius:4px}
.msg.bot{align-self:flex-end;background:var(--bot);border-bottom-right-radius:4px}
.msg.staff{align-self:flex-end;background:var(--tape-soft);border:1px solid var(--tape);border-bottom-right-radius:4px}
.msg.pending{opacity:.6}
.msg.failed{border-color:var(--signal);background:#FCECEA}
.msg.failed .meta{color:var(--signal)}
.composer{position:sticky;bottom:0;background:var(--paper);padding:12px 0 16px;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}
.composer .row-actions{display:flex;flex-direction:column;gap:8px}
textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);resize:vertical}
textarea:focus{border-color:var(--focus)}
.editor{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:24px}
.editor label{font-weight:600;display:block}
.editor p{margin:2px 0 8px;color:var(--muted);font-size:14px}
.editor textarea{font-family:ui-monospace,Consolas,monospace;font-size:13.5px;line-height:1.6;min-height:62vh}
.actions{position:sticky;bottom:0;padding:14px 0;background:var(--paper);display:flex;gap:14px;align-items:center}
.saved{color:var(--ok);font-weight:600}
.follow{margin-top:20px;max-width:760px}
.follow label{font-weight:600;display:block}
.follow p{margin:2px 0 8px;color:var(--muted);font-size:14px}
.sent-img{display:block;margin-top:6px;max-width:240px;max-height:240px;border-radius:8px;border:1px solid var(--line)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:32px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 16px}
.tile b{display:block;font-size:26px;line-height:1.2;font-variant-numeric:tabular-nums}
.tile span{color:var(--muted);font-size:14px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
.card img{width:100%;height:180px;object-fit:contain;background:var(--paper);border-bottom:1px solid var(--line)}
.card form{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.card input,.card textarea{font:inherit;font-size:14px;padding:7px 10px;border:1px solid var(--line);border-radius:6px}
.card .row-actions{display:flex;gap:8px;justify-content:space-between;align-items:center}
.btn.danger{background:var(--surface);color:var(--signal);border-color:var(--line)}
.tag-new{display:inline-block;padding:0 6px;border-radius:8px;font-size:12px;font-weight:600;background:var(--tape-soft);margin-left:6px}
.logout{margin:auto 0 0}
.logout button{font:inherit;font-size:14px;background:none;border:0;color:#A9B6C8;padding:9px 13px;cursor:pointer;border-radius:6px}
.logout button:hover{color:#fff;background:var(--ink-2)}
.login{display:grid;grid-template-columns:minmax(260px,2fr) 3fr;min-height:100vh}
.login-brand{background:var(--ink);color:#fff;padding:40px 32px;display:flex;flex-direction:column;justify-content:space-between}
.login-brand .brand{font-size:24px;padding:0}
.login-brand .brand span{font-size:15px}
.login-brand .tape-band{border-radius:4px;height:12px}
.login-form{display:grid;place-items:center;padding:40px 24px}
.login-form form{width:100%;max-width:360px;display:flex;flex-direction:column;gap:8px}
.login-form h1{margin:0}
.login-form p{margin:0 0 16px}
.login-form label{font-weight:600;margin-top:4px}
.login-form input{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)}
.login-form input:focus{border-color:var(--focus)}
.login-form .btn{margin-top:12px;padding:11px 14px}
@media (max-width:760px){
.login{grid-template-columns:1fr;grid-template-rows:auto 1fr}
.login-brand{padding:20px 16px;gap:16px}
.logout{margin:0 0 0 auto}
.shell{grid-template-columns:1fr}
.side{flex-direction:row;align-items:center;padding:10px 16px;gap:16px;overflow-x:auto;position:static;height:auto}
.brand span{display:none}
.nav{flex-direction:row}
.nav a{border-radius:0;padding:9px 10px;white-space:nowrap}
.nav a[aria-current=page]{box-shadow:inset 0 -3px 0 var(--tape)}
.main{padding-top:24px}
.convo-top{margin-top:-24px;padding-top:16px}
.editor{grid-template-columns:1fr}
.editor textarea{min-height:40vh}
}`

type Page = "chats" | "stats" | "test" | "settings" | "images" | "zns" | "ai"
const NAV: [Page, string, string][] = [
  ["chats", "/admin", "Hội thoại"],
  ["stats", "/admin/stats", "Thống kê"],
  ["zns", "/admin/zns", "Gửi tin theo SĐT"],
  ["test", "/admin/test", "Chat thử"],
  ["settings", "/admin/settings", "Kiến thức & giọng văn"],
  ["images", "/admin/images", "Ảnh gửi khách"],
  ["ai", "/admin/ai", "Model AI"],
]

const head = (title: string) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} – Newpost CSKH</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head>`

function layout(title: string, active: Page | null, body: string) {
  const nav = NAV.filter(([key]) => key !== "zns" || ZNS_ENABLED).map(([key, href, label]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ""}>${label}</a>`).join("")
  return `${head(title)}<body><div class="shell">
<aside class="side"><div class="brand">Newpost Global<span>Chăm sóc khách hàng Zalo</span></div><nav class="nav">${nav}</nav>
<form class="logout" method="post" action="/logout"><button>Đăng xuất</button></form></aside>
<main class="main">${body}<span id="latest"></span></main></div></body></html>`
}

const ROLE_LABEL = { user: "Khách", bot: "Bot", staff: "Nhân viên" }
/** Tin bot gửi ảnh được lưu là "[Gửi hình ảnh] #id tên": hiện ảnh thu nhỏ. */
function msgBody(text: string) {
  const img = /^\[Gửi hình ảnh\] #(\d+) (.*)$/s.exec(text)
  if (!img) return esc(text)
  return `<span class="muted">Đã gửi ảnh: ${esc(img[2])}</span><img class="sent-img" src="/admin/images/file?id=${img[1]}" alt="${esc(img[2])}" loading="lazy">`
}
/** HTML các tin nhắn (dùng cả khi trang tự cập nhật tin mới). */
export const messagesHtml = (msgs: Message[]) =>
  msgs
    .map((m) => `<div class="msg ${m.role}" data-id="${m.id ?? 0}"><span class="meta">${ROLE_LABEL[m.role]}, ${shortTime(m.created_at)}</span>${msgBody(m.text)}</div>`)
    .join("")
const thread = (msgs: Message[]) => `<div class="thread" data-last="${msgs.at(-1)?.id ?? 0}">${messagesHtml(msgs)}</div>`

/** Trang hội thoại: gửi tin không tải lại trang, tự hiện tin mới mỗi 3 giây, Enter để gửi.
 *  Không có JavaScript thì form vẫn gửi và tải lại trang như cũ. */
const LIVE_CHAT = (id: string) => `<script>(() => {
const uid = ${JSON.stringify(id)}, th = document.querySelector(".thread"), f = document.querySelector("form.composer")
let last = +th.dataset.last || 0, sending = false
const atBottom = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 160
const toBottom = () => scrollTo(0, document.documentElement.scrollHeight)
async function poll() {
  if (sending || document.hidden) return
  try {
    const r = await fetch("/admin/u/new?id=" + encodeURIComponent(uid) + "&after=" + last)
    if (!r.ok) return
    const j = await r.json()
    if (!j.html || sending) return
    const stay = atBottom()
    th.insertAdjacentHTML("beforeend", j.html)
    last = j.last
    if (stay) toBottom()
  } catch {}
}
setInterval(poll, 3000)
document.addEventListener("visibilitychange", poll)
if (!f) return
const ta = f.querySelector("textarea"), btn = f.querySelector("button")
ta.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); f.requestSubmit() }
})
f.onsubmit = async (e) => {
  e.preventDefault()
  const text = ta.value.trim()
  if (!text || sending) return
  sending = true
  btn.disabled = true
  ta.value = ""
  const tmp = document.createElement("div")
  tmp.className = "msg staff pending"
  tmp.innerHTML = '<span class="meta">Nhân viên, đang gửi…</span>'
  tmp.append(text)
  th.append(tmp)
  toBottom()
  try {
    const r = await fetch(f.action, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "fetch" },
      body: new URLSearchParams({ id: uid, text }),
    })
    const j = await r.json().catch(() => ({ ok: false, error: "Phiên đăng nhập đã hết, hãy tải lại trang" }))
    if (!j.ok) throw new Error(j.error)
    sending = false
    await poll() // lấy tin thật vừa lưu rồi mới bỏ tin tạm, không bị nháy
    tmp.remove()
  } catch (err) {
    tmp.classList.replace("pending", "failed")
    tmp.querySelector(".meta").textContent = "Chưa gửi được: " + err.message
    ta.value = text
  } finally {
    sending = false
    btn.disabled = false
    ta.focus()
  }
}
})()</script>`

function userRow(u: UserRow) {
  const prefix = u.last_role === "bot" ? "Bot: " : u.last_role === "staff" ? "Nhân viên: " : ""
  return `<li class="${isPaused(u) ? "waiting" : ""}"><a class="row" href="/admin/u?id=${encodeURIComponent(u.id)}#latest">
<span class="avatar" aria-hidden="true">${esc(initial(u))}</span>
<span><span class="who">${esc(displayName(u))}</span><span class="preview">${esc(prefix + (u.last_text ?? ""))}</span></span>
<span class="when">${shortTime(u.last_user_at)}</span></a></li>`
}

export function dashboard(p: { users: UserRow[]; botEnabled: boolean; zaloConnected: boolean; tokenExpires: number }) {
  const waiting = p.users.filter(isPaused)
  const others = p.users.filter((u) => !isPaused(u))
  const zalo = p.zaloConnected
    ? `<span title="Token tự làm mới, hết hạn ${esc(fullTime(p.tokenExpires))}"><span class="dot"></span>Đã kết nối Zalo OA</span>
       <a class="muted" href="/admin/zalo/connect">Kết nối lại</a>`
    : `<span class="off-text"><span class="dot off"></span>Chưa kết nối Zalo OA</span> <a class="btn" href="/admin/zalo/connect">Kết nối Zalo OA</a>`
  const bot = p.botEnabled
    ? `<span><span class="dot"></span>Bot đang tự trả lời khách</span><button class="btn ghost">Tắt bot</button>`
    : `<span class="off-text"><span class="dot off"></span>Bot đang tắt, khách chỉ được nhân viên trả lời</span><button class="btn">Bật bot</button>`

  return layout(
    "Hội thoại",
    "chats",
    `<h1>Hội thoại</h1>
<div class="status">${zalo}<form method="post" action="/admin/toggle">${bot}</form></div>
${waiting.length
  ? `<section class="group"><h2>Chờ nhân viên <span class="muted">(${waiting.length})</span></h2>
<div class="tape-band" aria-hidden="true"></div><ul class="list">${waiting.map(userRow).join("")}</ul></section>`
  : ""}
<section class="group"><h2>Bot đang trả lời <span class="muted">(${others.length})</span></h2>
<ul class="list">${others.map(userRow).join("") || '<li class="empty">Chưa có khách nào nhắn vào OA. Thử bot ở mục Chat thử trong lúc chờ.</li>'}</ul></section>`,
  )
}

export function conversation(u: User | undefined, id: string, msgs: Message[], err = "") {
  const staff = isPaused(u)
  const name = displayName({ id, name: u?.name ?? null })
  const hiddenId = `<input type="hidden" name="id" value="${esc(id)}">`
  // Zalo chỉ cho OA nhắn tư vấn trong 48 giờ kể từ tin cuối của khách.
  const windowClosed = !!u?.last_user_at && Date.now() - u.last_user_at > 48 * 3_600_000
  const role = `<form class="seg" method="post" action="/admin/u/bot" aria-label="Ai trả lời khách này">${hiddenId}
<button name="action" value="resume"${staff ? "" : ' aria-pressed="true"'}>Bot trả lời</button>
<button name="action" value="pause"${staff ? ' aria-pressed="true"' : ""}>Nhân viên chat</button></form>`
  const composer = staff
    ? `${windowClosed ? '<p class="banner">Khách nhắn lần cuối đã quá 48 giờ nên Zalo không cho gửi tin tư vấn. Chờ khách nhắn lại.</p>' : ""}
<form class="composer" method="post" action="/admin/u/send" onsubmit="this.querySelector('button').disabled=true">${hiddenId}
<textarea name="text" rows="2" required autofocus maxlength="2000" aria-label="Tin nhắn gửi khách" placeholder="Nhập tin gửi ${esc(name)} qua Zalo"></textarea>
<div class="row-actions"><button class="btn">Gửi</button></div></form>`
    : ""
  return layout(
    name,
    "chats",
    `<div class="convo-top"><a class="back" href="/admin">‹ Tất cả hội thoại</a>
<div class="head"><div><h1>${esc(name)}</h1><div class="muted">${u?.phone ? `SĐT ${esc(phoneView(u.phone))} · ` : ""}Zalo ID ${esc(id)}</div></div>${role}</div></div>
${staff ? `<p class="banner">Bạn đang chat với khách này thay bot, bot im lặng đến ${esc(fullTime(u!.paused_until))}. Bấm Bot trả lời để giao lại cho bot.</p>` : ""}
${err ? `<p class="banner error" role="alert">Chưa gửi được tin: ${esc(err)}</p>` : ""}
${thread(msgs)}
${composer}
${LIVE_CHAT(id)}`,
  )
}

export function testChat(msgs: Message[], paused: boolean) {
  return layout(
    "Chat thử",
    "test",
    `<h1>Chat thử</h1>
<p class="muted">Nhắn như một khách hàng để xem bot trả lời. Tin ở đây không gửi qua Zalo.</p>
${msgs.length ? thread(msgs) : '<p class="empty">Gõ câu hỏi đầu tiên bên dưới, ví dụ: Gửi 2kg từ Hà Nội vào TP.HCM hết bao nhiêu?</p>'}
${paused ? '<p class="banner">Bot đã chuyển hội thoại thử này cho nhân viên nên sẽ không trả lời nữa. Bấm Bắt đầu lại để thử tiếp.</p>' : ""}
<form class="composer" method="post" action="/admin/test">
<textarea name="text" rows="2" required autofocus aria-label="Tin nhắn thử" placeholder="Nhập tin như khách hàng"></textarea>
<div class="row-actions"><button class="btn">Gửi</button><button class="btn ghost" name="reset" value="1" formnovalidate>Bắt đầu lại</button></div>
</form>`,
  )
}

export function settings(prompt: string, knowledge: string, saved: boolean, followUp: string) {
  return layout(
    "Kiến thức & giọng văn",
    "settings",
    `<h1>Kiến thức & giọng văn</h1>
<form method="post" action="/admin/settings"><div class="editor">
<div><label for="prompt">Giọng văn và cách xử lý</label><p>Bot xưng hô thế nào, xử lý các tình huống thường gặp ra sao.</p>
<textarea id="prompt" name="prompt">${esc(prompt)}</textarea></div>
<div><label for="knowledge">Kho kiến thức</label><p>Bảng giá, hotline, quy định, câu hỏi thường gặp. Bot chỉ trả lời dựa trên phần này.</p>
<textarea id="knowledge" name="knowledge">${esc(knowledge)}</textarea></div>
</div>
<div class="follow"><label for="follow_up">Tin hỏi thăm khi khách im lặng 2 giờ</label>
<p>Bot trả lời xong mà khách không nhắn tiếp 2 giờ thì gửi tin này một lần (chỉ từ 8h đến 21h). Để trống là tắt.</p>
<textarea id="follow_up" name="follow_up" rows="3" maxlength="2000">${esc(followUp)}</textarea></div>
<div class="actions"><button class="btn">Lưu thay đổi</button>
${saved ? '<span class="saved" role="status">Đã lưu. Bot dùng nội dung mới từ tin nhắn tiếp theo.</span>' : ""}</div></form>`,
  )
}

export function aiPage(p: { cfg: AiConfig; keys: Record<Provider, string>; flash: string; error: string }) {
  const ids = Object.keys(PROVIDERS) as Provider[]
  const options = ids.map((id) => `<option value="${id}"${id === p.cfg.provider ? " selected" : ""}>${esc(PROVIDERS[id].label)}</option>`).join("")
  const models = ids.flatMap((id) => PROVIDERS[id].models).map((m) => `<option value="${esc(m)}">`).join("")
  const keys = ids
    .map((id) => `<li>${esc(PROVIDERS[id].label)}: ${p.keys[id] ? `đã có key <code>${esc(p.keys[id])}</code>` : "chưa có key"}
 · <a href="${PROVIDERS[id].keyUrl}" target="_blank" rel="noopener">Lấy API key</a></li>`)
    .join("")
  return layout(
    "Model AI",
    "ai",
    `<h1>Model AI</h1>
<p class="muted">Chọn hãng AI và model bot dùng để trả lời khách. Đang dùng: <b>${esc(PROVIDERS[p.cfg.provider].label)}</b>, model <code>${esc(p.cfg.model)}</code>.</p>
${p.flash ? `<p class="banner" role="status">${esc(p.flash)}</p>` : ""}
${p.error ? `<p class="banner error" role="alert">Chưa đổi model: ${esc(p.error)}</p>` : ""}
<section class="group panel"><form class="stack" method="post" action="/admin/ai" onsubmit="this.querySelector('button').disabled=true">
<label for="provider">Hãng AI</label><select id="provider" name="provider">${options}</select>
<label for="model">Model</label><input id="model" name="model" list="models" required value="${esc(p.cfg.model)}" autocomplete="off">
<datalist id="models">${models}</datalist>
<p class="hint">Gõ tên model hoặc chọn gợi ý. Tên model phải đúng với hãng đã chọn.</p>
<label for="key">API key</label><input id="key" name="key" type="password" autocomplete="off" placeholder="Để trống nếu hãng này đã có key">
<p class="hint">Key chỉ lưu trên máy chủ, không hiện lại trên trang. Mỗi hãng giữ key riêng.</p>
<div><button class="btn">Kiểm tra và dùng model này</button></div>
<p class="hint">Hệ thống gửi thử một câu chào tới model. Chỉ khi model trả lời được mới đổi, nên bot không bị gián đoạn nếu key sai.</p>
</form></section>
<section class="group"><h2>API key đã lưu</h2><ul class="hint">${keys}</ul></section>`,
  )
}

const ZNS_STATUS: Record<ZnsStatus, string> ={ pending: "Chờ gửi", sent: "Đã gửi", failed: "Lỗi", skipped: "Bỏ qua" }
const phoneView = (p: string) => `0${p.slice(2)}`

export function znsPage(p: {
  templates: { id: string; name: string }[]
  templatesError: string
  selected: Template | null
  selectedError: string
  jobs: ZnsJob[]
  counts: Record<ZnsStatus, number>
  optouts: string[]
  flash: string
}) {
  const t = p.selected
  const options = p.templates
    .map((x) => `<option value="${esc(x.id)}"${x.id === t?.id ? " selected" : ""}>${esc(x.name)} (ID ${esc(x.id)})</option>`)
    .join("")
  const pick = p.templates.length
    ? `<select name="template" required><option value="">Chọn một mẫu đã được Zalo duyệt</option>${options}</select>`
    : `<input name="template" required placeholder="Nhập Template ID" value="${esc(t?.id ?? "")}">`

  const paramInput = (x: Template["params"][number]) => {
    const isName = /name|ten|customer|khach/i.test(x.name)
    return `<label for="p-${esc(x.name)}">${esc(x.name)}${x.require ? "" : ' <span class="muted">(không bắt buộc)</span>'}</label>
<input id="p-${esc(x.name)}" name="p_${esc(x.name)}" ${x.require ? "required" : ""} ${x.maxLength ? `maxlength="${x.maxLength}"` : ""} value="${isName ? "{ten}" : ""}">`
  }

  const step2 = t
    ? `<section class="group panel"><h2>2. Danh sách khách và nội dung</h2>
<p class="muted">Mẫu <b>${esc(t.name)}</b>, loại ${esc(TAG_LABEL[t.tag] ?? t.tag)}${t.price ? `, ${t.price.toLocaleString("vi-VN")}đ/tin` : ""}${t.preview ? `. <a href="${esc(t.preview)}" target="_blank" rel="noopener">Xem mẫu</a>` : ""}.
${t.tag === "TRANSACTION" ? "" : " Loại tin này chỉ gửi từ 7h đến 22h, ngoài giờ hệ thống tự chờ."}</p>
<form class="stack" method="post" action="/admin/zns/queue"><input type="hidden" name="template" value="${esc(t.id)}">
${t.params.map(paramInput).join("") || '<p class="muted">Mẫu này không có ô nào cần điền.</p>'}
<p class="hint">Gõ <code>{ten}</code> để chèn tên của từng khách trong danh sách.</p>
<label for="list">Danh sách khách</label>
<textarea id="list" name="list" rows="8" required placeholder="0912345678, Nguyễn Văn An&#10;0987654321, Trần Thị Bình"></textarea>
<p class="hint">Mỗi dòng một khách: số điện thoại, tên. Tối đa 5.000 dòng. Số trùng hoặc đã từ chối nhận tin sẽ được bỏ qua.</p>
<label class="check"><input type="checkbox" name="consent" value="1" required> Tôi xác nhận các khách trong danh sách đã đồng ý nhận tin từ Newpost Global</label>
<div><button class="btn">Đưa vào hàng chờ gửi</button></div></form></section>`
    : ""

  const rows = p.jobs
    .map((j) => `<tr><td>${esc(phoneView(j.phone))}</td><td>${esc(j.name ?? "")}</td><td>${esc(j.template_name ?? j.template_id)}</td>
<td><span class="st ${j.status}">${ZNS_STATUS[j.status]}</span></td><td class="muted">${esc(j.error ?? (j.sent_at ? shortTime(j.sent_at) : ""))}</td></tr>`)
    .join("")

  return layout(
    "Gửi tin theo SĐT",
    "zns",
    `<h1>Gửi tin theo SĐT</h1>
<p class="muted">Gửi mẫu tin ZBS đã được Zalo duyệt tới số điện thoại Zalo của khách. Zalo tính phí theo từng tin gửi thành công.</p>
${p.flash ? `<p class="banner" role="status">${esc(p.flash)}</p>` : ""}
<section class="group panel"><h2>1. Chọn mẫu tin</h2>
${p.templatesError ? `<p class="banner error">Chưa tải được danh sách mẫu từ Zalo: ${esc(p.templatesError)}</p>` : ""}
${p.selectedError ? `<p class="banner error">Chưa tải được mẫu này: ${esc(p.selectedError)}</p>` : ""}
<form class="inline" method="get" action="/admin/zns">${pick}<button class="btn ghost">Dùng mẫu này</button></form></section>
${step2}
<section class="group"><h2>Tiến độ gửi</h2>
<div class="status">${(Object.keys(ZNS_STATUS) as ZnsStatus[]).map((s) => `<span><span class="st ${s}">${ZNS_STATUS[s]}</span> ${p.counts[s]}</span>`).join("")}
<form method="post" action="/admin/zns/cancel"><button class="btn ghost"${p.counts.pending ? "" : " disabled"}>Dừng các tin chờ gửi</button></form>
<form method="post" action="/admin/zns/retry"><button class="btn ghost"${p.counts.failed ? "" : " disabled"}>Gửi lại tin lỗi</button></form>
<a class="muted" href="/admin/zns${t ? `?template=${encodeURIComponent(t.id)}` : ""}">Tải lại</a></div>
${rows ? `<div class="table-wrap"><table class="jobs"><thead><tr><th>Số điện thoại</th><th>Tên</th><th>Mẫu</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead><tbody>${rows}</tbody></table></div>`
  : '<p class="empty">Chưa có tin nào trong hàng chờ.</p>'}</section>
<section class="group panel"><h2>Khách từ chối nhận tin <span class="muted">(${p.optouts.length})</span></h2>
<p class="muted">Các số ở đây sẽ không bao giờ được gửi tin theo SĐT.</p>
<form class="stack" method="post" action="/admin/zns/optout">
<textarea name="phones" rows="3" required aria-label="Số điện thoại từ chối nhận tin" placeholder="Mỗi dòng một số điện thoại"></textarea>
<div><button class="btn ghost">Thêm vào danh sách từ chối</button></div></form>
${p.optouts.length ? `<p class="muted">${p.optouts.slice(0, 200).map((x) => esc(phoneView(x))).join(", ")}${p.optouts.length > 200 ? "…" : ""}</p>` : ""}</section>`,
  )
}

export function imagesPage(images: Image[], flash: string) {
  const cards = images
    .map((i) => `<li class="card"><img src="/admin/images/file?id=${i.id}" alt="${esc(i.name)}" loading="lazy">
<form method="post" action="/admin/images/edit"><input type="hidden" name="id" value="${i.id}">
<input name="name" value="${esc(i.name)}" required aria-label="Tên ảnh">
<textarea name="usage" rows="2" aria-label="Gửi khi nào" placeholder="Gửi khi nào?">${esc(i.usage)}</textarea>
<div class="row-actions"><button class="btn ghost">Lưu</button>
<button class="btn danger" formaction="/admin/images/delete" onclick="return confirm('Xóa ảnh này? Bot sẽ không gửi ảnh này nữa.')">Xóa</button></div>
</form></li>`)
    .join("")
  return layout(
    "Ảnh gửi khách",
    "images",
    `<h1>Ảnh gửi khách</h1>
<p class="muted">Ảnh bot tự gửi cho khách khi gặp đúng tình huống: bảng giá, hướng dẫn đóng gói, mẫu khai báo, địa chỉ văn phòng… Bot đọc tên ảnh và mục "Gửi khi nào" để chọn ảnh.</p>
${flash ? `<p class="banner" role="status">${esc(flash)}</p>` : ""}
<section class="group panel"><h2>Tải ảnh mới</h2>
<form class="stack" method="post" action="/admin/images" enctype="multipart/form-data" onsubmit="this.querySelector('button').disabled=true">
<label for="file">Ảnh</label><input id="file" name="file" type="file" accept="image/jpeg,image/png,image/gif" required>
<p class="hint">JPG, PNG tối đa 1 MB; GIF tối đa 5 MB (giới hạn của Zalo).</p>
<label for="name">Tên ảnh</label><input id="name" name="name" placeholder="Ví dụ: Bảng giá DHL đi Mỹ" maxlength="120">
<label for="usage">Gửi khi nào</label>
<textarea id="usage" name="usage" rows="2" maxlength="500" placeholder="Ví dụ: khách hỏi giá gửi hàng đi Mỹ, hoặc xin bảng giá Mỹ"></textarea>
<p class="hint">Mô tả càng rõ tình huống, bot gửi càng đúng lúc.</p>
<div><button class="btn">Tải ảnh lên</button></div></form></section>
<section class="group"><h2>Ảnh đã có <span class="muted">(${images.length})</span></h2>
${cards ? `<ul class="gallery" style="list-style:none;padding:0;margin:0">${cards}</ul>` : '<p class="empty">Chưa có ảnh nào.</p>'}</section>`,
  )
}

type Stats = { day: string; customers: DayCustomer[]; orders: Order[] }
const hm = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })

export function statsPage(s: Stats) {
  const ordered = new Set(s.orders.map((o) => o.user_id))
  const tile = (n: number, label: string) => `<div class="tile"><b>${n}</b><span>${label}</span></div>`
  const link = (id: string, name: string | null) =>
    `<a href="/admin/u?id=${encodeURIComponent(id)}#latest">${esc(displayName({ id, name }))}</a>`
  const custRows = s.customers
    .map((c) => {
      const notes = [c.is_new ? "Khách mới" : "", c.handover ? "Đã chuyển nhân viên" : "", ordered.has(c.id) ? "Đã chốt đơn" : ""].filter(Boolean)
      return `<tr><td>${link(c.id, c.name)}</td><td>${c.phone ? esc(phoneView(c.phone)) : '<span class="muted">chưa có</span>'}</td>
<td>${c.msgs}</td><td>${hm(c.first_at)} – ${hm(c.last_at)}</td><td>${esc(notes.join(", "))}</td></tr>`
    })
    .join("")
  const orderRows = s.orders
    .map((o) => `<tr><td>${hm(o.created_at)}</td><td>${link(o.user_id, o.name)}</td><td>${o.phone ? esc(phoneView(o.phone)) : ""}</td><td>${esc(o.summary)}</td></tr>`)
    .join("")
  return layout(
    "Thống kê",
    "stats",
    `<div class="head"><h1>Thống kê ngày</h1>
<form class="inline" method="get" action="/admin/stats"><label for="date" class="muted">Ngày</label>
<input id="date" type="date" name="date" value="${esc(s.day)}" onchange="this.form.submit()"><noscript><button class="btn ghost">Xem</button></noscript>
<a class="btn ghost" href="/admin/stats.csv?date=${esc(s.day)}">Tải Excel (CSV)</a></form></div>
<div class="tiles">${tile(s.customers.length, "Khách nhắn tin")}${tile(s.customers.filter((c) => c.is_new).length, "Khách mới")}
${tile(s.customers.filter((c) => c.phone).length, "Có số điện thoại")}${tile(s.orders.length, "Đơn đã chốt")}
${tile(s.customers.filter((c) => c.handover).length, "Chuyển nhân viên")}</div>
<section class="group"><h2>Đơn đã chốt <span class="muted">(${s.orders.length})</span></h2>
${orderRows ? `<div class="table-wrap"><table class="jobs"><thead><tr><th>Giờ</th><th>Khách</th><th>SĐT</th><th>Thông tin đơn</th></tr></thead><tbody>${orderRows}</tbody></table></div>`
  : '<p class="empty">Chưa có đơn nào được chốt trong ngày.</p>'}</section>
<section class="group"><h2>Khách nhắn tin <span class="muted">(${s.customers.length})</span></h2>
${custRows ? `<div class="table-wrap"><table class="jobs"><thead><tr><th>Khách</th><th>SĐT</th><th>Số tin</th><th>Nhắn trong ngày</th><th>Ghi chú</th></tr></thead><tbody>${custRows}</tbody></table></div>`
  : '<p class="empty">Không có khách nào nhắn tin trong ngày này.</p>'}
<p class="hint">SĐT được tự nhận khi khách gõ số điện thoại trong tin nhắn hoặc khi chốt đơn.</p></section>`,
  )
}

/** CSV mở bằng Excel: có BOM để Excel đọc đúng tiếng Việt. */
export function statsCsv(s: Stats) {
  const cell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`
  const orders = new Map<string, string[]>()
  for (const o of s.orders) orders.set(o.user_id, [...(orders.get(o.user_id) ?? []), o.summary])
  const rows = [
    ["Ngày", "Tên khách", "SĐT", "Zalo ID", "Số tin", "Nhắn đầu", "Nhắn cuối", "Khách mới", "Chuyển nhân viên", "Đơn đã chốt"],
    ...s.customers.map((c) => [
      s.day, displayName(c), c.phone ? phoneView(c.phone) : "", c.id, c.msgs, hm(c.first_at), hm(c.last_at),
      c.is_new ? "Có" : "", c.handover ? "Có" : "", (orders.get(c.id) ?? []).join(" || "),
    ]),
  ]
  return `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`
}

export function loginPage(next: string, error = "") {
  return `${head("Đăng nhập")}<body><div class="login">
<section class="login-brand"><div class="brand">Newpost Global<span>Chăm sóc khách hàng Zalo</span></div>
<div class="tape-band" aria-hidden="true"></div></section>
<main class="login-form"><form method="post" action="/login">
<h1>Đăng nhập</h1><p class="muted">Dành cho nhân viên chăm sóc khách hàng.</p>
${error ? `<p class="banner error" role="alert">${esc(error)}</p>` : ""}
<input type="hidden" name="next" value="${esc(next)}">
<label for="password">Mật khẩu</label>
<input id="password" name="password" type="password" required autofocus autocomplete="current-password">
<button class="btn">Đăng nhập</button></form></main></div></body></html>`
}

export const errorPage = (msg: string) =>
  layout("Có lỗi", null, `<h1>Có lỗi</h1><p class="banner">${esc(msg)}</p><a class="btn ghost" href="/admin">Về trang hội thoại</a>`)
