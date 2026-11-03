import type { DayCustomer, Image, Message, Order, User, UserRow, ZnsJob, ZnsStatus } from "./db.ts"
import { ENABLED as ZNS_ENABLED, TAG_LABEL, type Template } from "./zns.ts"
import { PROVIDERS, type AiConfig, type Provider } from "./ai.ts"
import { KNOWLEDGE_EXT, type KnowledgeFile } from "./import.ts"
import type { PriceService } from "./price.ts"
import { BRANCHES, isBranch, isRegion, REGIONS } from "./region.ts"
import { xlsx } from "./xlsx.ts"

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
.dock{position:sticky;bottom:0;z-index:2;background:var(--paper);border-top:1px solid var(--line);padding:12px 0 16px;display:flex;flex-direction:column;gap:10px}
.dock .composer{position:static;padding:0}
.dock .banner{margin:0}
.track-box{display:grid;grid-template-columns:1fr auto;gap:8px;margin:0}
.track-box textarea{font:inherit;font-size:14px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);resize:none;min-width:0}
.who h1{font-size:26px;line-height:1.2}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.tag{font-size:13px;font-weight:600;padding:2px 10px;border-radius:999px;background:var(--surface);border:1px solid var(--line);white-space:nowrap}
.tag.soft{font-weight:500;color:var(--muted)}
.tag.warn{background:var(--tape-soft);border-color:var(--tape)}
.more{margin-top:8px}
.more summary{cursor:pointer;color:var(--muted);font-size:14px;width:max-content;padding:4px 0}
.more summary:hover{color:var(--ink)}
.more-body{display:flex;flex-direction:column;gap:8px;padding:6px 0 4px}
.more-body form{margin:0}
textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);resize:vertical}
textarea:focus{border-color:var(--focus)}
.editor{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:24px}
.editor label{font-weight:600;display:block}
.editor p{margin:2px 0 8px;color:var(--muted);font-size:14px}
.editor textarea{font-family:ui-monospace,Consolas,monospace;font-size:13.5px;line-height:1.6;min-height:62vh}
.actions{position:sticky;bottom:0;padding:14px 0;background:var(--paper);display:flex;gap:14px;align-items:center}
.saved{color:var(--ok);font-weight:600}
.kfiles{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.kfiles li{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;border:1px solid var(--line);border-radius:8px;padding:8px 12px}
.kfiles details{flex:1;min-width:0}
.kfiles summary{cursor:pointer;overflow-wrap:anywhere}
.picked{list-style:none;padding:0;margin:0;display:grid;gap:6px}
.picked:empty{display:none}
.picked li{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--line);border-radius:8px;padding:4px 4px 4px 12px;overflow-wrap:anywhere}
.kfiles pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;font-size:13px;margin:8px 0 0}
.follow{margin-top:20px;max-width:760px}
.follow label{font-weight:600;display:block}
.follow p{margin:2px 0 8px;color:var(--muted);font-size:14px}
.sent-img{display:block;margin-top:6px;max-width:240px;max-height:240px;border-radius:8px;border:1px solid var(--line)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
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
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.btn{display:inline-flex;align-items:center;gap:6px;transition:background .15s,border-color .15s,color .15s}
.btn.sm{font-size:14px;padding:7px 12px;min-height:38px}
.btn.icon{padding:7px 9px}
.switches{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-bottom:16px}
.sw{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.sw.off{background:#FDF5F4;border-color:#F1C9C4}
.sw form{margin:0}
.sw-title{display:block;font-size:13px;color:var(--muted)}
.sw-state{display:block;font-weight:600}
.sw.off .sw-state{color:var(--signal)}
.settings-box{background:var(--surface);border:1px solid var(--line);border-radius:10px;margin-bottom:24px}
.settings-box>summary{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:12px 14px;cursor:pointer;list-style:none}
.settings-box>summary::-webkit-details-marker{display:none}
.settings-box>summary::after{content:"Mở";margin-left:auto;font-size:13px;color:var(--focus);font-weight:600}
.settings-box[open]>summary::after{content:"Đóng"}
.settings-box>summary .muted{font-size:14px}
.settings-body{display:grid;gap:20px;padding:4px 14px 16px;border-top:1px solid var(--line)}
.settings-body h3{font-size:15px;margin:14px 0 6px}
.settings-body .hint{margin-top:6px}
.toolbar{display:flex;flex-direction:column;gap:10px;margin-bottom:12px}
.search{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:0 12px;color:var(--muted)}
.search:focus-within{border-color:var(--focus);box-shadow:0 0 0 3px rgba(43,108,223,.15)}
.search input{flex:1;border:0;outline:0;background:transparent;font:inherit;font-size:16px;padding:11px 0;color:var(--ink);min-width:0}
.filters{display:flex;flex-wrap:wrap;gap:8px}
.fchip{font:inherit;font-size:14px;font-weight:600;padding:7px 12px;min-height:38px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer;transition:background .15s,border-color .15s,color .15s}
.fchip b{font-weight:700;color:var(--muted);margin-left:2px;font-variant-numeric:tabular-nums}
.fchip:hover{border-color:var(--muted)}
.fchip[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:#fff}
.fchip[aria-pressed=true] b{color:var(--tape)}
.fchip.warn:not([aria-pressed=true]){background:var(--tape-soft);border-color:var(--tape)}
.row-main{min-width:0;display:flex;flex-direction:column;gap:2px}
.phone{font-weight:400;color:var(--muted);font-size:14px;margin-left:6px;font-variant-numeric:tabular-nums}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;line-height:1.6;background:var(--bot);color:var(--ink);white-space:nowrap}
.chip.ghost{background:transparent;border:1px solid var(--line);color:var(--muted)}
.chip.warn{background:var(--tape);color:var(--ink)}
.chip.ok{background:#DDF1E5;color:var(--ok)}
.list li[hidden]{display:none}
.waiting .row{background:#FFFBEA}
.staff-box>summary{cursor:pointer;margin-bottom:10px}
.daynav{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.daynav input{font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);min-height:38px}
.tiles .tile{display:flex;flex-direction:column;gap:2px}
.tile small{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.table-wrap.flat{border:0}
.compare th[scope=row]{color:var(--ink);font-weight:600;white-space:nowrap}
.compare td{min-width:150px}
.bar-cell{display:flex;align-items:center;gap:8px}
.bar{display:inline-block;height:10px;border-radius:5px;background:var(--ink);min-width:2px}
.bar.nam{background:var(--focus)}
.bar.none{background:var(--line)}
.bar-cell b{font-variant-numeric:tabular-nums}
.jobs .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.jobs .small{font-size:13px;color:var(--muted)}
.jobs tr[hidden]{display:none}
.tabs{margin:0 0 16px}
@media (prefers-reduced-motion:reduce){.btn,.fchip{transition:none}}
@media (max-width:760px){
.login{grid-template-columns:1fr;grid-template-rows:auto 1fr}
.login-brand{padding:20px 16px;gap:16px}
.logout{margin:0 0 0 auto}
.shell{grid-template-columns:minmax(0,1fr)}
.compare td{min-width:110px}
.head{flex-direction:column}
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

const MANAGER_PAGES: Page[] = ["settings", "images", "ai"]

const head = (title: string) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} – Newpost CSKH</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head>`

/** Form có data-live: gửi ngầm rồi thay phần trang (mặc định cả main, hoặc vùng ghi trong data-live) bằng bản mới,
 *  giữ vị trí cuộn và khung đang mở – không tải lại trang, không nhảy lên đầu. Lỗi thì gửi form kiểu thường. */
const LIVE_FORMS = `<script>(() => {
  document.addEventListener("submit", async (e) => {
    const f = e.target
    if (!(f instanceof HTMLFormElement) || !f.hasAttribute("data-live")) return
    e.preventDefault()
    const sel = f.dataset.live || "main.main", body = new URLSearchParams(new FormData(f, e.submitter))
    for (const b of f.querySelectorAll("button,select")) b.disabled = true
    try {
      const res = await fetch(f.action, { method: "POST", body })
      const doc = new DOMParser().parseFromString(await res.text(), "text/html")
      const fresh = doc.querySelector(sel), old = document.querySelector(sel)
      if (!res.ok || !fresh || !old) return location.reload()
      const open = [...old.querySelectorAll("details")].map((d) => d.open), y = scrollY
      old.replaceChildren(...fresh.childNodes)
      old.querySelectorAll("details").forEach((d, i) => { if (open[i]) d.open = true })
      for (const s of old.querySelectorAll("script")) { const n = document.createElement("script"); n.textContent = s.textContent; s.replaceWith(n) }
      scrollTo(0, y)
    } catch { f.submit() }
  })
})()</script>`

function layout(title: string, active: Page | null, body: string) {
  // Trang chỉ quản lý được vào: đánh dấu data-manager, server bỏ các link này khi nhân viên thường đăng nhập.
  const nav = NAV.filter(([key]) => key !== "zns" || ZNS_ENABLED)
    .map(([key, href, label]) => `<a ${MANAGER_PAGES.includes(key) ? "data-manager " : ""}href="${href}"${key === active ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("")
  return `${head(title)}<body><div class="shell">
<aside class="side"><div class="brand">Newpost Global<span>Chăm sóc khách hàng Zalo</span></div><nav class="nav">${nav}</nav>
<form class="logout" method="post" action="/logout"><button>Đăng xuất</button></form></aside>
<main class="main">${body}<span id="latest"></span></main></div>${LIVE_FORMS}</body></html>`
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

/** Trang hội thoại và Chat thử: gửi tin không tải lại trang, tự hiện tin mới mỗi 3 giây, Enter để gửi.
 *  Chat thử (as = "user"): tin khách hiện ngay kèm dòng "Đang soạn trả lời…" trong lúc chờ AI.
 *  Không có JavaScript thì form vẫn gửi và tải lại trang như cũ. */
const LIVE_CHAT = (id: string, as: "staff" | "user" = "staff") => `<script>(() => {
const uid = ${JSON.stringify(id)}, as = ${JSON.stringify(as)}, th = document.querySelector(".thread"), f = document.querySelector("form.composer")
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
const bubble = (role, meta, text) => {
  const el = document.createElement("div")
  el.className = "msg " + role + " pending"
  el.innerHTML = '<span class="meta"></span>'
  el.firstChild.textContent = meta
  el.append(text)
  th.append(el)
  return el
}
f.onsubmit = async (e) => {
  if (e.submitter?.name === "reset") return // nút Bắt đầu lại của Chat thử: gửi form bình thường
  e.preventDefault()
  const text = ta.value.trim()
  if (!text || sending) return
  sending = true
  btn.disabled = true
  ta.value = ""
  document.querySelector("p.empty")?.remove()
  const tmp = bubble(as, as === "user" ? "Khách, đang gửi…" : "Nhân viên, đang gửi…", text)
  const typing = as === "user" ? bubble("bot", "Bot", "Đang soạn trả lời…") : null
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
    typing?.remove()
    toBottom()
  } catch (err) {
    typing?.remove()
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

const ICON = {
  search: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  chevL: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg>',
  chevR: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
}

/** Nhãn bưu cục ngắn cho danh sách. */
const branchShort = (b: string | null) => (b === "bac" ? "Bưu cục Bắc" : b === "nam" ? "Bưu cục Nam" : "")

function userRow(u: UserRow) {
  const prefix = u.last_role === "bot" ? "Bot: " : u.last_role === "staff" ? "Nhân viên: " : ""
  const waiting = isPaused(u)
  const chips = [
    waiting ? '<span class="chip warn">Chờ nhân viên</span>' : "",
    isBranch(u.branch) ? `<span class="chip">${esc(branchShort(u.branch))}</span>` : "",
    isRegion(u.region) ? `<span class="chip ghost">${esc(REGIONS[u.region])}</span>` : "",
  ].join("")
  // data-*: để ô tìm kiếm và nút lọc trên trang lọc ngay trên trình duyệt, không tải lại trang.
  const search = [displayName(u), u.phone ? phoneView(u.phone) : "", u.last_text ?? ""].join(" ").toLowerCase()
  return `<li class="${waiting ? "waiting" : ""}" data-state="${waiting ? "waiting" : "bot"}" data-branch="${isBranch(u.branch) ? u.branch : "none"}" data-search="${esc(search)}">
<a class="row" href="/admin/u?id=${encodeURIComponent(u.id)}#latest">
<span class="avatar" aria-hidden="true">${esc(initial(u))}</span>
<span class="row-main"><span class="who">${esc(displayName(u))}${u.phone ? ` <span class="phone">${esc(phoneView(u.phone))}</span>` : ""}</span>
<span class="preview">${esc(prefix + (u.last_text ?? ""))}</span>${chips ? `<span class="chips">${chips}</span>` : ""}</span>
<span class="when">${shortTime(u.last_user_at)}</span></a></li>`
}

/** Nút lọc + ô tìm kiếm cho danh sách có data-state / data-branch / data-search. */
const LIST_FILTER = `<script>(() => {
  const box = document.getElementById("q"), list = document.getElementById("inbox"), empty = document.getElementById("no-match")
  let filter = "all"
  const apply = () => {
    const q = box.value.trim().toLowerCase()
    let shown = 0
    for (const li of list.children) {
      const ok = (filter === "all" || li.dataset.state === filter || li.dataset.branch === filter) && (!q || li.dataset.search.includes(q))
      li.hidden = !ok
      if (ok) shown++
    }
    empty.hidden = shown > 0
  }
  box.addEventListener("input", apply)
  for (const b of document.querySelectorAll("[data-filter]")) b.addEventListener("click", () => {
    filter = b.dataset.filter
    for (const x of document.querySelectorAll("[data-filter]")) x.setAttribute("aria-pressed", String(x === b))
    apply()
  })
})()</script>`

export function dashboard(p: {
  users: UserRow[]; botEnabled: boolean; handoverEnabled: boolean; zaloConnected: boolean; tokenExpires: number
  replyFrom: string; replyTo: string; debounce: number; inHours: boolean
  staff: { id: string; name: string | null; branch?: string }[]; telegram: { hasToken: boolean; chat: string }; flash: string
}) {
  // Nhân viên nhận thông báo cũng nhắn OA: xếp mục riêng, không lẫn vào khách.
  const staffSet = new Set(p.staff.map((s) => s.id))
  const staffRows = p.users.filter((u) => staffSet.has(u.id))
  const customers = p.users.filter((u) => !staffSet.has(u.id))
  // Khách chờ nhân viên lên đầu, sau đó theo tin mới nhất.
  const sorted = [...customers.filter(isPaused), ...customers.filter((u) => !isPaused(u))]
  const count = (f: (u: UserRow) => boolean) => customers.filter(f).length
  const filters: [string, string, number][] = [
    ["all", "Tất cả", customers.length],
    ["waiting", "Chờ nhân viên", count(isPaused)],
    ["bot", "Bot đang trả lời", count((u) => !isPaused(u))],
    ["bac", "Bưu cục Bắc", count((u) => u.branch === "bac")],
    ["nam", "Bưu cục Nam", count((u) => u.branch === "nam")],
    ["none", "Chưa chọn bưu cục", count((u) => !isBranch(u.branch))],
  ]
  const hours = p.replyFrom && p.replyTo && p.replyFrom !== p.replyTo ? `${p.replyFrom}–${p.replyTo}` : "cả ngày"
  const card = (on: boolean, title: string, state: string, action: string, form: string) => `<div class="sw ${on ? "on" : "off"}">
<div><span class="sw-title">${title}</span><span class="sw-state"><span class="dot${on ? "" : " off"}"></span>${state}</span></div>${form ? `<form method="post" action="${form}" data-live>${action}</form>` : action}</div>`

  return layout(
    "Hội thoại",
    "chats",
    `<div class="head"><h1>Hội thoại</h1></div>
${p.flash ? `<p class="banner" role="status">${esc(p.flash)}</p>` : ""}
<div class="switches">
${card(p.zaloConnected, "Zalo OA", p.zaloConnected ? "Đã kết nối" : "Chưa kết nối",
  p.zaloConnected ? `<a class="btn ghost sm" href="/admin/zalo/connect" title="Token tự làm mới, hết hạn ${esc(fullTime(p.tokenExpires))}">Kết nối lại</a>`
    : '<a class="btn sm" href="/admin/zalo/connect">Kết nối Zalo OA</a>', "")}
${card(p.botEnabled, "Bot tự trả lời", p.botEnabled ? "Đang bật" : "Đang tắt – chỉ nhân viên trả lời",
  `<button class="btn ${p.botEnabled ? "ghost " : ""}sm">${p.botEnabled ? "Tắt bot" : "Bật bot"}</button>`, "/admin/toggle")}
${card(p.handoverEnabled, "Chuyển nhân viên", p.handoverEnabled ? "Bot chuyển khi cần" : "Đang tắt – ca khó bot xin SĐT",
  `<button class="btn ${p.handoverEnabled ? "ghost " : ""}sm">${p.handoverEnabled ? "Tắt" : "Bật"}</button>`, "/admin/handover-toggle")}
</div>
<!--manager--><details class="settings-box"><summary>${ICON.gear}<b>Cài đặt bot</b>
<span class="muted">Trả lời ${esc(hours)} · chờ khách ${p.debounce} giây · Telegram ${p.telegram.hasToken && p.telegram.chat ? "đã cài" : "chưa cài"} · Zalo ${p.staff.length} nhân viên nhận báo</span></summary>
<div class="settings-body">
<section><h3>Giờ trả lời</h3>
<form class="inline" method="post" action="/admin/hours" aria-label="Giờ bot trả lời" data-live>
<label>Từ <input type="time" name="from" value="${esc(p.replyFrom)}"></label>
<label>đến <input type="time" name="to" value="${esc(p.replyTo)}"></label>
<label>Chờ khách nhắn xong <input type="number" name="debounce" min="0" max="300" required value="${p.debounce}" style="width:5.5em"> giây</label>
<button class="btn sm">Lưu</button></form>
<p class="hint">${p.replyFrom && p.replyTo && p.replyFrom !== p.replyTo
  ? p.inHours ? "Đang trong giờ trả lời." : "Đang ngoài giờ: bot chưa trả lời, tới giờ sẽ trả lời các tin còn chờ."
  : "Để trống giờ là bot trả lời cả ngày."}</p></section>
<section><h3>Báo nhân viên qua nhóm Telegram</h3>
<p class="hint">Có 2 loại thông báo: <b>khách nhắn OA</b> (mỗi khách 1 lần mỗi ngày) và <b>đơn hàng</b> (đơn mới, khách sửa đơn, khách đổi bưu cục – mỗi lần đều báo).
Tạo bot bằng <b>@BotFather</b>, thêm bot vào nhóm, nhắn 1 tin trong nhóm, dán token rồi bấm Lưu (để trống chat ID là tự tìm nhóm).</p>
<form class="stack" method="post" action="/admin/notify" data-live>
<label for="tg-token">Token bot Telegram</label><input id="tg-token" name="token" type="password" autocomplete="off" placeholder="${p.telegram.hasToken ? "Đã có token, để trống nếu không đổi" : "123456:ABC..."}">
<label for="tg-chat">Chat ID nhóm</label><input id="tg-chat" name="chat" value="${esc(p.telegram.chat)}" placeholder="Để trống để tự tìm">
<div class="row-actions"><button class="btn sm">Lưu</button><button class="btn ghost sm" name="action" value="test">Lưu và gửi thử</button>
${p.telegram.hasToken ? '<button class="btn danger sm" name="action" value="clear" formnovalidate>Tắt Telegram</button>' : ""}</div>
</form></section>
<section><h3>Báo nhân viên qua Zalo cá nhân</h3>
<p class="hint">Nhân viên quan tâm OA và nhắn OA 1 tin, rồi mở hội thoại của nhân viên đó bấm <b>Nhận thông báo</b>.
Chọn chi nhánh để nhân viên chỉ nhận thông báo khách của bưu cục mình (khách chưa chọn bưu cục thì báo tất cả).
Zalo chỉ cho OA nhắn trong 48 giờ kể từ tin cuối của nhân viên, nên nhân viên cần nhắn OA ít nhất 2 ngày 1 lần.</p>
<ul class="kfiles">${p.staff.map((s) => `<li><a href="/admin/u?id=${encodeURIComponent(s.id)}">${esc(displayName(s))}</a>
<form class="inline" method="post" action="/admin/notify/staff-branch" data-live><input type="hidden" name="id" value="${esc(s.id)}">
<label class="sr" for="sb-${esc(s.id)}">Chi nhánh của ${esc(displayName(s))}</label><select id="sb-${esc(s.id)}" name="branch" onchange="this.form.requestSubmit()">
${[["all", "Cả hai chi nhánh"], ["bac", "Chi nhánh miền Bắc"], ["nam", "Chi nhánh miền Nam"]]
  .map(([k, v]) => `<option value="${k}"${(s.branch ?? "all") === k ? " selected" : ""}>${v}</option>`).join("")}</select>
<noscript><button class="btn ghost sm">Lưu</button></noscript></form>
<form method="post" action="/admin/notify/staff" data-live><input type="hidden" name="id" value="${esc(s.id)}"><button class="btn danger sm" aria-label="Gỡ ${esc(displayName(s))} khỏi danh sách nhận thông báo" onclick="return confirm('Gỡ nhân viên này khỏi danh sách nhận thông báo?')">Gỡ khỏi danh sách</button></form></li>`).join("")
  || '<li class="empty">Chưa có nhân viên nào.</li>'}</ul></section>
</div></details><!--/manager-->
<section class="group">
<div class="toolbar">
<label class="search">${ICON.search}<span class="sr">Tìm khách</span><input id="q" type="search" placeholder="Tìm theo tên, số điện thoại, nội dung tin" autocomplete="off"></label>
<div class="filters" role="group" aria-label="Lọc hội thoại">${filters
  .map(([key, label, n]) => `<button type="button" class="fchip${key === "waiting" && n ? " warn" : ""}" data-filter="${key}" aria-pressed="${key === "all"}">${label} <b>${n}</b></button>`)
  .join("")}</div>
</div>
${customers.length
  ? `<ul class="list" id="inbox">${sorted.map(userRow).join("")}</ul>
<p class="empty" id="no-match" hidden>Không có hội thoại nào khớp. Thử bỏ bớt chữ tìm kiếm hoặc chọn "Tất cả".</p>${LIST_FILTER}`
  : '<ul class="list"><li class="empty">Chưa có khách nào nhắn vào OA. Thử bot ở mục Chat thử trong lúc chờ.</li></ul>'}
</section>
${staffRows.length
  ? `<details class="group staff-box"><summary><b>Nhân viên nhận thông báo</b> <span class="muted">(${staffRows.length})</span></summary>
<ul class="list">${staffRows.map(userRow).join("")}</ul></details>`
  : ""}`,
  )
}

export function conversation(u: User | undefined, id: string, msgs: Message[], err = "", isStaff = false, watching: string[] = []) {
  // Nhân viên nhận thông báo: bot không trả lời họ, nên luôn hiện ô chat, không cần các nhắc nhở dành cho khách.
  const staff = isPaused(u) || isStaff
  const name = displayName({ id, name: u?.name ?? null })
  const hiddenId = `<input type="hidden" name="id" value="${esc(id)}">`
  // Zalo chỉ cho OA nhắn tư vấn trong 48 giờ kể từ tin cuối của khách.
  const windowClosed = !isStaff && !!u?.last_user_at && Date.now() - u.last_user_at > 48 * 3_600_000
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
    // Đầu trang gọn: tên + vài nhãn chính; sửa vùng/bưu cục, Zalo ID, nhận thông báo gom vào "Chi tiết" (đóng sẵn).
    `<div class="convo-top"><a class="back" href="/admin">‹ Tất cả hội thoại</a>
<div class="head"><div class="who"><h1>${esc(name)}</h1><div class="tags">
${u?.phone ? `<span class="tag">${esc(phoneView(u.phone))}</span>` : ""}
${isStaff ? '<span class="tag">Nhân viên nhận thông báo</span>' : isBranch(u?.branch) ? `<span class="tag">${BRANCHES[u.branch]}</span>` : '<span class="tag warn">Chưa chọn bưu cục</span>'}
${!isStaff && isRegion(u?.region) ? `<span class="tag soft">${REGIONS[u.region]}</span>` : ""}
${watching.length ? `<span class="tag soft">Theo dõi ${watching.length} vận đơn</span>` : ""}</div></div>${isStaff ? "" : role}</div>
<details class="more"><summary>Chi tiết</summary><div class="more-body">
${isStaff ? "" : `<form class="inline" method="post" action="/admin/u/region" data-live=".convo-top">${hiddenId}
<label class="muted" for="region">Vùng</label><select id="region" name="region" onchange="this.form.requestSubmit()"><option value="">Chưa rõ</option>${Object.entries(REGIONS)
  .map(([k, v]) => `<option value="${k}"${u?.region === k ? " selected" : ""}>${v}</option>`).join("")}</select>
<label class="muted" for="branch">Bưu cục</label><select id="branch" name="branch" onchange="this.form.requestSubmit()"><option value="">Chưa chọn</option>${Object.entries(BRANCHES)
  .map(([k, v]) => `<option value="${k}"${u?.branch === k ? " selected" : ""}>${v}</option>`).join("")}</select></form>`}
<p class="hint">Zalo ID ${esc(id)}${watching.length ? ` · Đang theo dõi: ${watching.map(esc).join(", ")}` : ""}</p>
<!--manager--><form class="inline" method="post" action="/admin/notify/staff" data-live=".convo-top">${hiddenId}<input type="hidden" name="back" value="u"><input type="hidden" name="on" value="${isStaff ? "0" : "1"}">
<span class="hint">${isStaff ? "Người này nhận thông báo khách nhắn, bot không trả lời họ." : "Người này là nhân viên?"}</span>
<button class="btn ghost sm">${isStaff ? "Thôi nhận thông báo" : "Cho nhận thông báo"}</button></form><!--/manager-->
</div></details></div>
${staff && !isStaff ? `<p class="banner">Bạn đang chat với khách này thay bot, bot im lặng đến ${esc(fullTime(u!.paused_until))}. Bấm Bot trả lời để giao lại cho bot.</p>` : ""}
${err ? `<p class="banner error" role="alert">Chưa gửi được tin: ${esc(err)}</p>` : ""}
${thread(msgs)}
<div class="dock">${isStaff ? "" : `<form class="track-box" method="post" action="/admin/u/track" onsubmit="this.querySelector('button').disabled=true"
  title="Bot nhắn khách mã + hành trình hiện tại, giao thành công tự báo khách">${hiddenId}
<textarea name="code" rows="1" required maxlength="400" aria-label="Mã vận đơn gửi khách" placeholder="Mã vận đơn gửi khách (nhiều mã cách nhau dấu phẩy)"></textarea>
<button class="btn ghost">Gửi mã &amp; theo dõi</button></form>`}
${composer}</div>
${LIVE_CHAT(id)}`,
  )
}

export function testChat(msgs: Message[], paused: boolean) {
  return layout(
    "Chat thử",
    "test",
    `<h1>Chat thử</h1>
<p class="muted">Nhắn như một khách hàng để xem bot trả lời. Tin ở đây không gửi qua Zalo.</p>
${msgs.length ? "" : '<p class="empty">Gõ câu hỏi đầu tiên bên dưới, ví dụ: Gửi 3kg quần áo đi Nhật, thùng 40x30x20, hết bao nhiêu?</p>'}
${thread(msgs)}
${paused ? '<p class="banner">Bot đã chuyển hội thoại thử này cho nhân viên nên sẽ không trả lời nữa. Bấm Bắt đầu lại để thử tiếp.</p>' : ""}
<form class="composer" method="post" action="/admin/test">
<textarea name="text" rows="2" required autofocus aria-label="Tin nhắn thử" placeholder="Nhập tin như khách hàng (Enter để gửi)"></textarea>
<div class="row-actions"><button class="btn">Gửi</button><button class="btn ghost" name="reset" value="1" formnovalidate>Bắt đầu lại</button></div>
</form>
${LIVE_CHAT("test-admin", "user")}`,
  )
}

const tokens = (text: string) => `khoảng ${Math.max(1, Math.round(text.length / 3 / 1000))} nghìn token`
const vnTime = (ms: number) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(ms)

export function settings(prompt: string, knowledge: string, saved: boolean, followUp: string, flash = "", files: KnowledgeFile[] = [], prices: PriceService[] = []) {
  const priceList = prices
    .map((s) => `<li><div><b>${esc(s.name)}</b> <span class="muted">· ${s.goods.zones.length} vùng · ${esc(s.file)} · nạp lúc ${vnTime(s.updated)}</span></div>
<form method="post" action="/admin/price/delete"><input type="hidden" name="code" value="${esc(s.code)}">
<button class="btn danger" onclick="return confirm('Xóa bảng giá này? Bot sẽ không báo giá dịch vụ này nữa.')">Xóa</button></form></li>`)
    .join("")
  const list = files
    .map((f) => `<li><details><summary><b>${esc(f.name)}</b> <span class="muted">· ${tokens(f.text)} · nạp lúc ${vnTime(f.updated)}</span></summary>
<pre>${esc(f.text)}</pre></details>
<form method="post" action="/admin/knowledge/delete"><input type="hidden" name="name" value="${esc(f.name)}">
<button class="btn danger" onclick="return confirm('Xóa file này? Bot sẽ không dùng kiến thức trong file này nữa.')">Xóa</button></form></li>`)
    .join("")
  return layout(
    "Kiến thức & giọng văn",
    "settings",
    `<h1>Kiến thức & giọng văn</h1>
${flash ? `<p class="banner" role="status">${esc(flash)}</p>` : ""}
<section class="group panel"><h2>Nạp kho kiến thức từ file</h2>
<form class="stack" method="post" action="/admin/knowledge/upload" enctype="multipart/form-data" onsubmit="this.querySelector('button').disabled=true">
<label for="kfile">File (chọn được nhiều file một lúc)</label><input id="kfile" name="file" type="file" accept="${KNOWLEDGE_EXT.join(",")}" multiple required>
<ul id="kpicked" class="picked" aria-live="polite"></ul>
<script>(() => {
  // Liệt kê file đã chọn, mỗi file một nút Bỏ để gỡ file chọn nhầm trước khi nạp.
  const input = document.getElementById("kfile"), list = document.getElementById("kpicked")
  const show = () => {
    list.replaceChildren(...[...input.files].map((f, i) => {
      const li = document.createElement("li"), b = document.createElement("button")
      li.textContent = f.name + " "
      b.type = "button"; b.className = "btn ghost"; b.textContent = "Bỏ"; b.setAttribute("aria-label", "Bỏ file " + f.name)
      b.onclick = () => {
        const dt = new DataTransfer()
        ;[...input.files].forEach((x, j) => j !== i && dt.items.add(x))
        input.files = dt.files
        show()
      }
      li.append(b)
      return li
    }))
  }
  input.addEventListener("change", show)
})()</script>
<p class="hint">File Excel bảng giá của hãng (mẫu CHUAN_MB_…) tự thành bảng tính giá, nạp lại thì thay giá cũ của hãng đó.
File khác (.md nên dùng, .txt, .csv mã UTF-8, Word .docx, Excel .xlsx) thành kiến thức cho bot; nạp lại cùng tên là thay bản cũ. File PDF: mở bằng Word rồi lưu .docx.</p>
<div><button class="btn">Nạp file</button></div></form>
<h3>Bảng giá đã nạp <span class="muted">(${prices.length})</span></h3>
<p class="hint">Bot không tự đọc bảng giá: hệ thống tự tính cước theo các bảng này rồi bot báo cho khách.</p>
${priceList ? `<ul class="kfiles">${priceList}</ul>` : '<p class="empty">Chưa nạp bảng giá nào.</p>'}
<h3>File kiến thức đã nạp <span class="muted">(${files.length})</span></h3>
${list ? `<ul class="kfiles">${list}</ul>` : '<p class="empty">Chưa nạp file nào.</p>'}</section>
<form method="post" action="/admin/settings"><div class="editor">
<div><label for="prompt">Giọng văn và cách xử lý</label><p>Bot xưng hô thế nào, xử lý các tình huống thường gặp ra sao.</p>
<textarea id="prompt" name="prompt">${esc(prompt)}</textarea></div>
<div><label for="knowledge">Kho kiến thức</label><p>Bảng giá, hotline, quy định, câu hỏi thường gặp. Bot chỉ trả lời dựa trên phần này và các file đã nạp ở trên.
Tổng cộng ${tokens(knowledge + files.map((f) => f.text).join(""))} mỗi lần bot trả lời: viết gọn, bỏ dòng trùng lặp là đỡ tốn.</p>
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

type Stats = { day: string; customers: DayCustomer[]; orders: Order[]; messages: (Message & { user_id: string })[] }
const hm = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })

const regionName = (r: string | null) => (isRegion(r) ? REGIONS[r] : "")
const branchName = (b: string | null) => (isBranch(b) ? BRANCHES[b] : "Chưa chọn bưu cục")
const branchKey = (b: string | null) => (isBranch(b) ? b : "none")
/** Ngày "YYYY-MM-DD" cộng thêm n ngày. */
const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** Nút tab lọc bảng theo chi nhánh: hiện/ẩn các dòng có data-branch-row, không tải lại trang. */
const BRANCH_TABS = `<script>(() => {
  const tabs = document.querySelectorAll("[data-tab]")
  for (const t of tabs) t.addEventListener("click", () => {
    for (const x of tabs) x.setAttribute("aria-pressed", String(x === t))
    for (const row of document.querySelectorAll("[data-branch-row]")) row.hidden = t.dataset.tab !== "all" && row.dataset.branchRow !== t.dataset.tab
    for (const empty of document.querySelectorAll("[data-empty-for]")) {
      const table = document.getElementById(empty.dataset.emptyFor)
      empty.hidden = !table || [...table.querySelectorAll("[data-branch-row]")].some((r) => !r.hidden)
    }
  })
})()</script>`

export function statsPage(s: Stats) {
  const ordered = new Set(s.orders.map((o) => o.user_id))
  const link = (id: string, name: string | null) =>
    `<a href="/admin/u?id=${encodeURIComponent(id)}#latest">${esc(displayName({ id, name }))}</a>`
  const groups: [string, string][] = [["bac", "Chi nhánh miền Bắc"], ["nam", "Chi nhánh miền Nam"], ["none", "Chưa chọn bưu cục"]]
  const cust = (k: string) => s.customers.filter((c) => branchKey(c.branch) === k)
  const ord = (k: string) => s.orders.filter((o) => branchKey(o.branch) === k)

  // Chỉ số chính: tổng ngày + chia theo chi nhánh ngay trong ô.
  const metrics: [string, (k: string | null) => number][] = [
    ["Khách nhắn tin", (k) => (k ? cust(k) : s.customers).length],
    ["Khách mới", (k) => (k ? cust(k) : s.customers).filter((c) => c.is_new).length],
    ["Có số điện thoại", (k) => (k ? cust(k) : s.customers).filter((c) => c.phone).length],
    ["Đơn đã chốt", (k) => (k ? ord(k) : s.orders).length],
    ["Chuyển nhân viên", (k) => (k ? cust(k) : s.customers).filter((c) => c.handover).length],
  ]
  const tiles = metrics
    .map(([label, f]) => `<div class="tile"><span>${label}</span><b>${f(null)}</b>
<small>Bắc ${f("bac")} · Nam ${f("nam")}${f("none") ? ` · Chưa chọn ${f("none")}` : ""}</small></div>`)
    .join("")

  // So sánh chi nhánh: mỗi chỉ số một hàng, thanh ngang có ghi số (không chỉ dựa vào màu).
  const compare = metrics
    .map(([label, f]) => {
      const max = Math.max(1, f("bac"), f("nam"), f("none"))
      const cell = (k: string) => `<td><span class="bar-cell"><span class="bar ${k}" style="width:${Math.round((f(k) / max) * 100)}%"></span><b>${f(k)}</b></span></td>`
      return `<tr><th scope="row">${label}</th>${cell("bac")}${cell("nam")}${cell("none")}</tr>`
    })
    .join("")
  const regionRow = (k: string) => {
    const list = cust(k)
    const counts = Object.entries(REGIONS).map(([r, name]) => [name, list.filter((c) => c.region === r).length] as const).filter(([, n]) => n)
    const unknown = list.filter((c) => !isRegion(c.region)).length
    return [...counts.map(([name, n]) => `${name} ${n}`), unknown ? `Chưa rõ ${unknown}` : ""].filter(Boolean).join(" · ") || "—"
  }

  const branchChip = (b: string | null) => `<span class="chip${isBranch(b) ? "" : " ghost"}">${esc(isBranch(b) ? (b === "bac" ? "Bắc" : "Nam") : "Chưa chọn")}</span>`
  const orderRows = s.orders
    .map((o) => `<tr data-branch-row="${branchKey(o.branch)}"><td>${hm(o.created_at)}</td><td>${branchChip(o.branch)}</td><td>${link(o.user_id, o.name)}</td>
<td>${esc(regionName(o.region)) || '<span class="muted">chưa rõ</span>'}</td><td>${o.phone ? esc(phoneView(o.phone)) : ""}</td><td>${esc(o.summary)}</td></tr>`)
    .join("")
  const custRows = s.customers
    .map((c) => {
      const notes = [c.is_new ? '<span class="chip">Khách mới</span>' : "", c.handover ? '<span class="chip warn">Chuyển nhân viên</span>' : "",
        ordered.has(c.id) ? '<span class="chip ok">Đã chốt đơn</span>' : ""].join("")
      return `<tr data-branch-row="${branchKey(c.branch)}"><td>${link(c.id, c.name)}</td><td>${branchChip(c.branch)}</td>
<td>${esc(regionName(c.region)) || '<span class="muted">chưa rõ</span>'}</td>
<td>${c.phone ? esc(phoneView(c.phone)) : '<span class="muted">chưa có</span>'}</td>
<td class="num">${c.msgs}</td><td class="num">${hm(c.first_at)} – ${hm(c.last_at)}</td><td><span class="chips">${notes}</span></td></tr>`
    })
    .join("")
  const tabs = [["all", "Tất cả", s.customers.length], ...groups.map(([k, label]) => [k, label, cust(k).length])] as [string, string, number][]

  return layout(
    "Thống kê",
    "stats",
    `<div class="head"><h1>Thống kê ngày</h1>
<form class="daynav" method="get" action="/admin/stats">
<a class="btn ghost sm icon" href="/admin/stats?date=${shiftDay(s.day, -1)}" aria-label="Ngày trước">${ICON.chevL}</a>
<label class="sr" for="date">Ngày</label><input id="date" type="date" name="date" value="${esc(s.day)}" onchange="this.form.submit()">
<a class="btn ghost sm icon" href="/admin/stats?date=${shiftDay(s.day, 1)}" aria-label="Ngày sau">${ICON.chevR}</a>
<noscript><button class="btn ghost sm">Xem</button></noscript>
<a class="btn sm" href="/admin/stats.xlsx?date=${esc(s.day)}">${ICON.download}Tải Excel</a></form></div>
<div class="tiles">${tiles}</div>
<section class="group panel"><h2>So sánh chi nhánh</h2>
<div class="table-wrap flat"><table class="jobs compare"><thead><tr><th></th><th scope="col">Miền Bắc</th><th scope="col">Miền Nam</th><th scope="col">Chưa chọn bưu cục</th></tr></thead>
<tbody>${compare}<tr><th scope="row">Khách theo vùng</th>${groups.map(([k]) => `<td class="small">${esc(regionRow(k))}</td>`).join("")}</tr></tbody></table></div>
<p class="hint">Chi nhánh theo bưu cục khách chọn gửi hàng (khách bấm nút trên Zalo, hoặc nhân viên chọn trong trang hội thoại).</p></section>
<div class="filters tabs" role="group" aria-label="Lọc theo chi nhánh">${tabs
  .map(([k, label, n]) => `<button type="button" class="fchip" data-tab="${k}" aria-pressed="${k === "all"}">${label} <b>${n}</b></button>`)
  .join("")}</div>
<section class="group"><h2>Đơn đã chốt <span class="muted">(${s.orders.length})</span></h2>
${orderRows
  ? `<div class="table-wrap"><table class="jobs" id="t-orders"><thead><tr><th>Giờ</th><th>Bưu cục</th><th>Khách</th><th>Vùng</th><th>SĐT</th><th>Thông tin đơn</th></tr></thead><tbody>${orderRows}</tbody></table></div>
<p class="empty" data-empty-for="t-orders" hidden>Chi nhánh này chưa có đơn nào được chốt trong ngày.</p>`
  : '<p class="empty">Chưa có đơn nào được chốt trong ngày.</p>'}</section>
<section class="group"><h2>Khách nhắn tin <span class="muted">(${s.customers.length})</span></h2>
${custRows
  ? `<div class="table-wrap"><table class="jobs" id="t-cust"><thead><tr><th>Khách</th><th>Bưu cục</th><th>Vùng</th><th>SĐT</th><th class="num">Số tin</th><th class="num">Nhắn trong ngày</th><th>Ghi chú</th></tr></thead><tbody>${custRows}</tbody></table></div>
<p class="empty" data-empty-for="t-cust" hidden>Chi nhánh này không có khách nào nhắn tin trong ngày.</p>`
  : '<p class="empty">Không có khách nào nhắn tin trong ngày này.</p>'}
<p class="hint">SĐT được tự nhận khi khách gõ số điện thoại trong tin nhắn, bấm chia sẻ số, hoặc khi chốt đơn.</p></section>
${BRANCH_TABS}`,
  )
}

/** File Excel thống kê ngày: Tổng quan, Khách hàng (đầy đủ thông tin), Đơn đã chốt (tách cột), Tin nhắn trong ngày. */
export function statsXlsx(s: Stats, publicUrl = "") {
  const ROLE = { user: "Khách", bot: "Bot", staff: "Nhân viên" } as Record<string, string>
  const dt = (ms: number) => (ms ? new Date(ms).toLocaleString("vi-VN", { timeZone: TZ, hour12: false }) : "")
  const phone = (p: string | null) => (p ? phoneView(p) : "")
  const byUser = new Map<string, Message[]>()
  for (const m of s.messages) byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m])
  const ordersOf = (id: string) => s.orders.filter((o) => o.user_id === id)
  const people = new Map(s.customers.map((c) => [c.id, c]))

  // Tổng quan: mỗi chỉ số một dòng, cột theo chi nhánh.
  const groups = ["bac", "nam", "none"]
  const cust = (k: string | null) => s.customers.filter((c) => !k || branchKey(c.branch) === k)
  const ord = (k: string | null) => s.orders.filter((o) => !k || branchKey(o.branch) === k)
  const metric = (label: string, f: (k: string | null) => number) => [label, f(null), ...groups.map((k) => f(k))]
  const overview: (string | number)[][] = [
    ["Chỉ số (ngày " + s.day + ")", "Tổng", "Chi nhánh miền Bắc", "Chi nhánh miền Nam", "Chưa chọn bưu cục"],
    metric("Khách nhắn tin", (k) => cust(k).length),
    metric("Khách mới (lần đầu nhắn OA)", (k) => cust(k).filter((c) => c.is_new).length),
    metric("Khách có số điện thoại", (k) => cust(k).filter((c) => c.phone).length),
    metric("Đơn đã chốt", (k) => ord(k).length),
    metric("Khách được chuyển nhân viên", (k) => cust(k).filter((c) => c.handover).length),
    metric("Tổng tin khách gửi trong ngày", (k) => cust(k).reduce((n, c) => n + c.msgs, 0)),
    ...Object.entries(REGIONS).map(([r, name]) => metric(`Khách ở ${name}`, (k) => cust(k).filter((c) => c.region === r).length)),
    metric("Khách chưa rõ vùng", (k) => cust(k).filter((c) => !isRegion(c.region)).length),
  ]

  const customers: (string | number)[][] = [
    ["Chi nhánh", "Vùng", "Tên Zalo", "Số điện thoại", "Zalo ID", "Khách mới", "Lần đầu nhắn OA", "Nhắn đầu trong ngày", "Nhắn cuối trong ngày",
      "Số tin trong ngày", "Tổng tin từ trước tới nay", "Chuyển nhân viên", "Số đơn đã chốt", "Đơn đã chốt", "Khách hỏi gì (tin của khách trong ngày)",
      "Trả lời cuối của bot / nhân viên", "Link hội thoại"],
    ...s.customers.map((c) => {
      const msgs = byUser.get(c.id) ?? []
      const asked = msgs.filter((m) => m.role === "user").map((m) => `${hm(m.created_at)} ${m.text}`).join("\n")
      const lastReply = msgs.filter((m) => m.role !== "user").at(-1)
      const orders = ordersOf(c.id)
      return [
        branchName(c.branch), regionName(c.region) || "Chưa rõ", displayName(c), phone(c.phone), c.id, c.is_new ? "Có" : "", dt(c.first_ever),
        hm(c.first_at), hm(c.last_at), c.msgs, c.total_msgs, c.handover ? "Có" : "", orders.length, orders.map((o) => o.summary).join("\n"),
        asked.slice(0, 5000), lastReply ? `${ROLE[lastReply.role] ?? lastReply.role}: ${lastReply.text}`.slice(0, 2000) : "",
        publicUrl ? `${publicUrl}/admin/u?id=${encodeURIComponent(c.id)}` : "",
      ]
    }),
  ]

  // Đơn: tách các phần "Nước đến: … | Hàng: … | …" bot ghi thành cột riêng.
  const FIELDS = ["Nước đến", "Hàng", "Cân nặng", "Kích thước", "Giá báo", "Lấy hàng"]
  const field = (summary: string, name: string) =>
    summary.split("|").map((p) => p.trim()).find((p) => p.toLowerCase().startsWith(name.toLowerCase() + ":"))?.slice(name.length + 1).trim() ?? ""
  const orders: (string | number)[][] = [
    ["Giờ chốt", "Sửa lần cuối", "Chi nhánh", "Vùng", "Tên Zalo", "SĐT", ...FIELDS, "Toàn bộ thông tin đơn", "Link hội thoại"],
    ...s.orders.map((o) => [
      dt(o.created_at), o.updated_at ? dt(o.updated_at) : "", branchName(o.branch), regionName(o.region) || "Chưa rõ", displayName({ id: o.user_id, name: o.name }),
      phone(o.phone) || field(o.summary, "SĐT"), ...FIELDS.map((f) => field(o.summary, f)), o.summary,
      publicUrl ? `${publicUrl}/admin/u?id=${encodeURIComponent(o.user_id)}` : "",
    ]),
  ]

  const messages: (string | number)[][] = [
    ["Thời gian", "Chi nhánh", "Tên Zalo", "SĐT", "Người gửi", "Nội dung"],
    ...s.messages.map((m) => {
      const c = people.get(m.user_id)
      return [dt(m.created_at), branchName(c?.branch ?? null), displayName({ id: m.user_id, name: c?.name ?? null }), phone(c?.phone ?? null), ROLE[m.role] ?? m.role, m.text]
    }),
  ]

  return xlsx([
    { name: "Tổng quan", rows: overview, widths: [34, 10, 20, 20, 20] },
    { name: "Khách hàng", rows: customers, widths: [24, 12, 22, 14, 22, 10, 18, 12, 12, 10, 12, 12, 10, 50, 60, 50, 40] },
    { name: "Đơn đã chốt", rows: orders, widths: [18, 18, 24, 12, 22, 14, 14, 20, 12, 16, 16, 30, 60, 40] },
    { name: "Tin nhắn", rows: messages, widths: [18, 24, 22, 14, 11, 90] },
  ])
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
