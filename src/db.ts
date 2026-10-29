import { mkdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

export type Role = "user" | "bot" | "staff"
export type Message = { id?: number; role: Role; text: string; created_at: number }
export type User = { id: string; name: string | null; phone: string | null; paused_until: number; last_user_at: number; followed_up_at: number }
export type Image = { id: number; name: string; usage: string; file: string; created_at: number }
export type Order = { id: number; user_id: string; name: string | null; phone: string | null; summary: string; created_at: number }
export type DayCustomer = { id: string; name: string | null; phone: string | null; msgs: number; first_at: number; last_at: number; is_new: number; handover: number }
export type UserRow = User & { last_text: string | null; last_role: Role | null }

const path = process.env.DB_PATH ?? "data/app.db"
if (path !== ":memory:") mkdirSync("data", { recursive: true })

// ponytail: SQLite đủ cho vài nghìn tin/ngày; lên PostgreSQL khi chạy nhiều máy chủ
export const db = new DatabaseSync(path)
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    paused_until INTEGER NOT NULL DEFAULT 0,
    last_user_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    zalo_msg_id TEXT UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_user ON messages (user_id, id);
  -- Hàng chờ gửi ZBS Template Message theo số điện thoại.
  -- ponytail: mỗi số chỉ nhận 1 lần cho mỗi mẫu (UNIQUE); cần gửi định kỳ thì bỏ ràng buộc này
  CREATE TABLE IF NOT EXISTS zns_jobs (
    id INTEGER PRIMARY KEY,
    phone TEXT NOT NULL,
    name TEXT,
    template_id TEXT NOT NULL,
    template_name TEXT,
    tag TEXT NOT NULL,
    data TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    msg_id TEXT,
    created_at INTEGER NOT NULL,
    sent_at INTEGER,
    UNIQUE (phone, template_id)
  );
  CREATE TABLE IF NOT EXISTS zns_optout (phone TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
  -- Ảnh gửi khách (bảng giá, hướng dẫn…) nhân viên tải lên; file nằm trong data/images/.
  -- usage: mô tả tình huống nên gửi, AI đọc để chọn ảnh.
  CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY, name TEXT NOT NULL, usage TEXT NOT NULL DEFAULT '',
    file TEXT NOT NULL, created_at INTEGER NOT NULL);
  -- Đơn khách đã chốt qua bot (bot ghi tóm tắt để nhân viên liên hệ lấy hàng).
  CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, phone TEXT, summary TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS messages_time ON messages (created_at);
`)
// Cột thêm sau khi đã có dữ liệu: DB cũ chưa có thì thêm vào.
for (const col of ["users phone TEXT", "users followed_up_at INTEGER NOT NULL DEFAULT 0", "images usage TEXT NOT NULL DEFAULT ''"]) {
  const [table, ...def] = col.split(" ")
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${def.join(" ")}`)
  } catch {} // đã có cột
}

export function getKv(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined
  return row?.value
}

export function setKv(key: string, value: string) {
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value)
}

/** Lưu tin nhắn, trả về id của tin. Trả về 0 nếu tin này đã lưu rồi (Zalo gửi lặp webhook). */
export function addMessage(userId: string, role: Role, text: string, zaloMsgId?: string): number {
  const now = Date.now()
  const res = db
    .prepare("INSERT OR IGNORE INTO messages (user_id, role, text, zalo_msg_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, role, text, zaloMsgId ?? null, now)
  if (res.changes === 0) return 0
  db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId)
  if (role === "user") db.prepare("UPDATE users SET last_user_at = ? WHERE id = ?").run(now, userId)
  return Number(res.lastInsertRowid)
}

export function deleteMessage(id: number) {
  db.prepare("DELETE FROM messages WHERE id = ?").run(id)
}

/** N tin gần nhất của khách, cũ trước mới sau. */
export function history(userId: string, limit = 20): Message[] {
  const rows = db
    .prepare("SELECT id, role, text, created_at FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, limit) as Message[]
  return rows.reverse()
}

/** Tin mới hơn tin có id afterId (trang hội thoại tự cập nhật). */
export function messagesAfter(userId: string, afterId: number): Message[] {
  return db
    .prepare("SELECT id, role, text, created_at FROM messages WHERE user_id = ? AND id > ? ORDER BY id LIMIT 100")
    .all(userId, afterId) as Message[]
}

/** Bot lưu ảnh nó gửi là "[Gửi hình ảnh] #id tên". */
export const IMAGE_ECHO = "[Gửi hình ảnh]"

/** Tin OA gửi đi (webhook oa_send_*) có phải do hệ thống này gửi không – bot, hoặc nhân viên chat
 *  trong trang quản trị (tin tự gửi chưa có zalo_msg_id). So theo nội dung trong 5 phút gần nhất.
 *  Tin không phải chữ (ảnh, nút chia sẻ SĐT…) quay về dạng "[Gửi …]": khớp với tin "[Gửi…" bot vừa lưu. */
export function isOwnEcho(userId: string, text: string, windowMs = 5 * 60_000): boolean {
  const nonText = /^\[Gửi [^\]]*\]$/.test(text) ? 1 : 0
  return !!db
    .prepare(`SELECT 1 FROM messages WHERE user_id = ? AND role IN ('bot', 'staff') AND zalo_msg_id IS NULL
              AND (text = ? OR (? = 1 AND role = 'bot' AND text LIKE '[Gửi%')) AND created_at > ?`)
    .get(userId, text, nonText, Date.now() - windowMs)
}

/** Bot đã lưu tin có nội dung này cho khách trong khoảng thời gian gần đây chưa. */
export function recentBotMessage(userId: string, text: string, windowMs: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM messages WHERE user_id = ? AND role = 'bot' AND text = ? AND created_at > ?")
    .get(userId, text, Date.now() - windowMs)
}

/** Khách bot đã chuyển nhân viên, hết thời gian chờ (paused_until trong [from, to]) mà chưa có nhân viên trả lời:
 *  tin cuối của phía OA (bot/nhân viên) vẫn là câu chuyển nhân viên. */
export function handoverExpired(from: number, to: number, handoverText: string): string[] {
  const rows = db
    .prepare(`SELECT u.id FROM users u
      JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE user_id = u.id AND role IN ('bot', 'staff'))
      WHERE u.paused_until BETWEEN ? AND ? AND m.role = 'bot' AND m.text = ? AND u.id != 'test-admin'`)
    .all(from, to, handoverText) as { id: string }[]
  return rows.map((r) => r.id)
}

export function pauseBot(userId: string, minutes: number) {
  db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId)
  db.prepare("UPDATE users SET paused_until = ? WHERE id = ?").run(Date.now() + minutes * 60_000, userId)
}

export function isPaused(userId: string): boolean {
  const row = db.prepare("SELECT paused_until FROM users WHERE id = ?").get(userId) as { paused_until: number } | undefined
  return (row?.paused_until ?? 0) > Date.now()
}

export function getUser(userId: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as User | undefined
}

export function setUserName(userId: string, name: string) {
  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, userId)
}

/** Khách có tin cuối (sau mốc thời gian) là của khách, tức là chưa được trả lời. */
export function pendingUsers(sinceMs: number): string[] {
  const rows = db
    .prepare(`SELECT user_id FROM messages WHERE id IN (SELECT MAX(id) FROM messages GROUP BY user_id)
              AND role = 'user' AND created_at > ? AND user_id != 'test-admin'`)
    .all(sinceMs) as { user_id: string }[]
  return rows.map((r) => r.user_id)
}

export function setPhone(userId: string, phone: string) {
  db.prepare("UPDATE users SET phone = ? WHERE id = ?").run(phone, userId)
}

// --- Ảnh gửi khách ---
export function addImage(name: string, usage: string, file: string): number {
  return Number(db.prepare("INSERT INTO images (name, usage, file, created_at) VALUES (?, ?, ?, ?)").run(name, usage, file, Date.now()).lastInsertRowid)
}
export function updateImage(id: number, name: string, usage: string) {
  db.prepare("UPDATE images SET name = ?, usage = ? WHERE id = ?").run(name, usage, id)
}
export const listImages = () => db.prepare("SELECT * FROM images ORDER BY id").all() as Image[]
export const getImage = (id: number) => db.prepare("SELECT * FROM images WHERE id = ?").get(id) as Image | undefined
export function deleteImage(id: number) {
  db.prepare("DELETE FROM images WHERE id = ?").run(id)
}

// --- Đơn chốt & thống kê ---
export function addOrder(userId: string, phone: string | null, summary: string) {
  db.prepare("INSERT INTO orders (user_id, phone, summary, created_at) VALUES (?, ?, ?, ?)").run(userId, phone, summary, Date.now())
}

export function ordersBetween(from: number, to: number): Order[] {
  return db
    .prepare(`SELECT o.*, u.name FROM orders o LEFT JOIN users u ON u.id = o.user_id
              WHERE o.created_at >= ? AND o.created_at < ? AND o.user_id != 'test-admin' ORDER BY o.id`)
    .all(from, to) as Order[]
}

/** Khách có nhắn tin trong khoảng thời gian; is_new = lần đầu nhắn OA; handover = bot đã chuyển nhân viên. */
export function customersBetween(from: number, to: number, handoverText: string): DayCustomer[] {
  return db
    .prepare(`SELECT u.id, u.name, u.phone, COUNT(*) AS msgs, MIN(m.created_at) AS first_at, MAX(m.created_at) AS last_at,
        NOT EXISTS (SELECT 1 FROM messages p WHERE p.user_id = u.id AND p.created_at < ?) AS is_new,
        EXISTS (SELECT 1 FROM messages h WHERE h.user_id = u.id AND h.role = 'bot' AND h.text = ? AND h.created_at >= ? AND h.created_at < ?) AS handover
      FROM messages m JOIN users u ON u.id = m.user_id
      WHERE m.role = 'user' AND m.created_at >= ? AND m.created_at < ? AND u.id != 'test-admin'
      GROUP BY u.id ORDER BY last_at DESC`)
    .all(from, handoverText, from, to, from, to) as DayCustomer[]
}

/** Khách cần hỏi thăm: tin cuối là của bot, gửi trong [from, to], chưa hỏi thăm từ lần nhắn cuối,
 *  bot không bị dừng, tin cuối không phải câu chuyển nhân viên, và chưa chốt đơn từ lần nhắn cuối. */
export function followUpCandidates(from: number, to: number, skipText: string): string[] {
  const rows = db
    .prepare(`SELECT u.id FROM users u JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE user_id = u.id)
      WHERE m.role = 'bot' AND m.created_at BETWEEN ? AND ? AND m.text != ?
        AND u.followed_up_at < u.last_user_at AND u.paused_until < ? AND u.id != 'test-admin'
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.created_at > u.last_user_at)`)
    .all(from, to, skipText, Date.now()) as { id: string }[]
  return rows.map((r) => r.id)
}

export function markFollowedUp(userId: string) {
  db.prepare("UPDATE users SET followed_up_at = ? WHERE id = ?").run(Date.now(), userId)
}

export function clearUser(userId: string) {
  db.prepare("DELETE FROM messages WHERE user_id = ?").run(userId)
  db.prepare("DELETE FROM orders WHERE user_id = ?").run(userId)
  db.prepare("DELETE FROM users WHERE id = ?").run(userId)
}

export function listUsers(limit = 200): UserRow[] {
  return db
    .prepare(`SELECT u.*,
        (SELECT text FROM messages m WHERE m.user_id = u.id ORDER BY id DESC LIMIT 1) AS last_text,
        (SELECT role FROM messages m WHERE m.user_id = u.id ORDER BY id DESC LIMIT 1) AS last_role
      FROM users u ORDER BY last_user_at DESC LIMIT ?`)
    .all(limit) as UserRow[]
}

// --- Gửi tin theo SĐT (ZBS Template Message) ---
export type ZnsStatus = "pending" | "sent" | "failed" | "skipped"
export type ZnsJob = {
  id: number; phone: string; name: string | null; template_id: string; template_name: string | null; tag: string
  data: string; status: ZnsStatus; error: string | null; msg_id: string | null; created_at: number; sent_at: number | null
}
export type NewZnsJob = { phone: string; name: string; templateId: string; templateName: string; tag: string; data: Record<string, string> }

/** Thêm vào hàng chờ; số đã có cùng mẫu thì bỏ qua. Trả về số dòng thêm được. */
export function queueZnsJobs(jobs: NewZnsJob[]): number {
  const stmt = db.prepare(`INSERT OR IGNORE INTO zns_jobs (phone, name, template_id, template_name, tag, data, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?)`)
  let added = 0
  db.exec("BEGIN")
  try {
    for (const j of jobs) added += Number(stmt.run(j.phone, j.name, j.templateId, j.templateName, j.tag, JSON.stringify(j.data), Date.now()).changes)
    db.exec("COMMIT")
  } catch (err) {
    db.exec("ROLLBACK")
    throw err
  }
  return added
}

export function nextZnsJob(): ZnsJob | undefined {
  return db.prepare("SELECT * FROM zns_jobs WHERE status = 'pending' ORDER BY id LIMIT 1").get() as ZnsJob | undefined
}

export function finishZnsJob(id: number, status: ZnsStatus, error: string | null, msgId?: string) {
  db.prepare("UPDATE zns_jobs SET status = ?, error = ?, msg_id = ?, sent_at = ? WHERE id = ?").run(status, error, msgId ?? null, Date.now(), id)
}

export function listZnsJobs(limit = 200): ZnsJob[] {
  return db.prepare("SELECT * FROM zns_jobs ORDER BY id DESC LIMIT ?").all(limit) as ZnsJob[]
}

export function znsCounts(): Record<ZnsStatus, number> {
  const out: Record<ZnsStatus, number> = { pending: 0, sent: 0, failed: 0, skipped: 0 }
  for (const r of db.prepare("SELECT status, COUNT(*) AS n FROM zns_jobs GROUP BY status").all() as { status: ZnsStatus; n: number }[]) out[r.status] = r.n
  return out
}

/** Dừng: các tin đang chờ chuyển thành "bỏ qua". */
export function cancelPendingZns(): number {
  return Number(db.prepare("UPDATE zns_jobs SET status = 'skipped', error = 'Đã dừng gửi' WHERE status = 'pending'").run().changes)
}

export function retryFailedZns(): number {
  return Number(db.prepare("UPDATE zns_jobs SET status = 'pending', error = NULL WHERE status = 'failed'").run().changes)
}

export function addOptOut(phones: string[]) {
  const stmt = db.prepare("INSERT OR IGNORE INTO zns_optout (phone, created_at) VALUES (?, ?)")
  for (const p of phones) stmt.run(p, Date.now())
  // Các tin còn chờ gửi tới số này cũng bỏ luôn.
  const del = db.prepare("UPDATE zns_jobs SET status = 'skipped', error = 'Khách từ chối nhận tin' WHERE phone = ? AND status = 'pending'")
  for (const p of phones) del.run(p)
}

export function isOptedOut(phone: string): boolean {
  return !!db.prepare("SELECT 1 FROM zns_optout WHERE phone = ?").get(phone)
}

export function listOptOut(): string[] {
  return (db.prepare("SELECT phone FROM zns_optout ORDER BY created_at DESC").all() as { phone: string }[]).map((r) => r.phone)
}
