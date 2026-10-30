process.env.DB_PATH = ":memory:"
process.env.GEMINI_API_KEY = "" // không gọi AI thật trong test
process.env.AI_RETRY_MS = "0"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"

const db = await import("../src/db.ts")
const { answer, findPhone, onOaMessage, onUserInfo, onUserMessage, resumeAfterHandover, staffSend, wantsHuman, HANDOVER_REPLY, PHONE_REQUEST_LOG } =
  await import("../src/bot.ts")
const { verifySignature } = await import("../src/zalo.ts")
const views = await import("../src/views.ts")

const textOf = (out: Awaited<ReturnType<typeof answer>>) =>
  out?.map((o) => ("text" in o ? o.text : "image" in o ? `ảnh ${o.image.id}` : "nút chia sẻ SĐT"))

/** Giả lập AI (qua API OpenAI) trả lần lượt các câu cho sẵn; trả về hàm khôi phục. */
function fakeAi(replies: string[]) {
  db.setKv("ai_provider", "openai")
  db.setKv("ai_model", "test")
  db.setKv("ai_key_openai", "test-key")
  const real = globalThis.fetch
  globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: replies.shift() ?? "" } }] })) as typeof fetch
  return () => {
    globalThis.fetch = real
    db.setKv("ai_provider", "gemini")
  }
}

test("chữ ký webhook: đúng thì nhận, sai body thì từ chối", () => {
  const raw = '{"app_id":"123","event_name":"user_send_text","timestamp":"1700000000000"}'
  const mac = createHash("sha256").update(`123${raw}1700000000000secret`).digest("hex")
  assert.ok(verifySignature(raw, "123", "1700000000000", `mac=${mac}`, "secret"))
  assert.ok(!verifySignature(raw.replace("123", "999"), "123", "1700000000000", `mac=${mac}`, "secret"))
  assert.ok(!verifySignature(raw, "123", "1700000000000", "", "secret"))
})

test("khách đòi gặp nhân viên → bot chuyển và tạm dừng", async () => {
  assert.ok(wantsHuman("Cho tôi GẶP NHÂN VIÊN"))
  db.addMessage("u1", "user", "cho mình gặp nhân viên với")
  assert.deepEqual(textOf(await answer("u1")), [HANDOVER_REPLY])
  assert.ok(db.isPaused("u1"))
  db.addMessage("u1", "user", "alo?")
  assert.equal(await answer("u1"), null)
})

test("AI lỗi → chuyển nhân viên thay vì im lặng", async () => {
  db.addMessage("u2", "user", "giá gửi hàng?")
  assert.deepEqual(textOf(await answer("u2")), [HANDOVER_REPLY])
})

test("AI lỡ chọn chuyển nhân viên 1 lần → hỏi lại, khách vẫn được báo giá", async () => {
  const restore = fakeAi(["[CHUYEN_NHAN_VIEN]", "Dạ giá tham khảo 1.000.000đ ạ"])
  try {
    db.addMessage("p1", "user", "5kg quần áo đi Trung Quốc bao nhiêu?")
    assert.deepEqual(textOf(await answer("p1")), ["Dạ giá tham khảo 1.000.000đ ạ"])
    assert.ok(!db.isPaused("p1"))
  } finally {
    restore()
  }
})

test("AI 3 lần đều chuyển nhân viên → chuyển thật", async () => {
  const restore = fakeAi(["[CHUYEN_NHAN_VIEN]", "[CHUYEN_NHAN_VIEN]", "[CHUYEN_NHAN_VIEN]"])
  try {
    db.addMessage("p2", "user", "hàng tôi bị vỡ, tôi muốn khiếu nại")
    assert.deepEqual(textOf(await answer("p2")), [HANDOVER_REPLY])
    assert.ok(db.isPaused("p2"))
  } finally {
    restore()
  }
})

test("nhận SĐT trong tin nhắn", () => {
  assert.equal(findPhone("sđt em 0912 345 678 nhé"), "84912345678")
  assert.equal(findPhone("+84 912.345.678"), "84912345678")
  assert.equal(findPhone("giá 1.000.000đ, 5 kg, 20 x 21 x 30"), null)
  assert.equal(findPhone("mã 123456789012"), null)
  onUserMessage("p3", "số của mình 0987654321")
  assert.equal(db.getUser("p3")?.phone, "84987654321")
})

test("AI chốt đơn và gửi ảnh: lưu đơn, ẩn thẻ với khách, gửi ảnh sau chữ", async () => {
  const img = db.addImage("Bảng giá Trung Quốc", "khách hỏi giá đi Trung Quốc", "x.jpg")
  const restore = fakeAi([
    `Dạ em cảm ơn anh, nhân viên sẽ gọi anh để hẹn lấy hàng ạ.\n[GUI_ANH:${img}]\n[GUI_ANH:999]\n[DON_HANG] Nước đến: Trung Quốc | Hàng: quần áo | Cân nặng: 5 kg | SĐT: 0912345678 | Lấy hàng: Q1`,
  ])
  try {
    db.addMessage("p4", "user", "ok chốt nhé")
    const out = await answer("p4")
    assert.deepEqual(textOf(out), ["Dạ em cảm ơn anh, nhân viên sẽ gọi anh để hẹn lấy hàng ạ.", `ảnh ${img}`])
    const [order] = db.ordersBetween(0, Date.now() + 1000).filter((o) => o.user_id === "p4")
    assert.equal(order.phone, "84912345678")
    assert.match(order.summary, /^Nước đến: Trung Quốc/)
    assert.match(db.history("p4").at(-1)!.text, /^\[Gửi hình ảnh\] #\d+ Bảng giá Trung Quốc$/)
    // Zalo báo lại ảnh bot vừa gửi (oa_send_image) → không coi là nhân viên.
    onOaMessage("p4", "[Gửi hình ảnh]")
    assert.ok(!db.isPaused("p4"))
  } finally {
    restore()
  }
})

test("chuyển nhân viên quá 10 phút không ai trả lời → bot nhận lại, trả lời tiếp, chỉ 1 lần", async () => {
  const expire = (id: string) => db.db.prepare("UPDATE users SET paused_until = ? WHERE id = ?").run(Date.now() - 60_000, id)
  db.addMessage("h1", "user", "hàng tôi bị móp, tôi muốn khiếu nại")
  db.addMessage("h1", "bot", HANDOVER_REPLY)
  expire("h1")
  db.addMessage("h2", "user", "cho gặp nhân viên")
  db.addMessage("h2", "bot", HANDOVER_REPLY)
  db.addMessage("h2", "staff", "Dạ em là nhân viên, em hỗ trợ ạ") // nhân viên đã trả lời → bot không nhận lại
  expire("h2")
  const restore = fakeAi(["Dạ em xin lỗi đã để anh/chị chờ ạ. Em đã ghi nhận khiếu nại, anh/chị cho em xin số điện thoại nhé.\n[XIN_SDT]"])
  try {
    await resumeAfterHandover()
    const h1 = db.history("h1").map((m) => m.text)
    assert.match(h1.at(-2)!, /^Dạ em xin lỗi/)
    assert.equal(h1.at(-1), PHONE_REQUEST_LOG) // khách chưa có SĐT → gửi kèm nút chia sẻ
    assert.equal(db.history("h2").at(-1)!.role, "staff")
    await resumeAfterHandover() // lần quét sau không trả lời lặp
    assert.equal(db.history("h1").length, h1.length)
  } finally {
    restore()
  }
})

test("khách bấm chia sẻ thông tin → lưu SĐT; tin nút chia sẻ quay về không bị coi là nhân viên", () => {
  onUserInfo("i1", { phone: "84912345678", name: "An" }, "info-1")
  assert.equal(db.getUser("i1")?.phone, "84912345678")
  assert.match(db.history("i1").at(-1)!.text, /SĐT 0912345678/)
  db.addMessage("i2", "bot", PHONE_REQUEST_LOG)
  onOaMessage("i2", "[Gửi template]")
  assert.ok(!db.isPaused("i2"))
})

test("hỏi thăm: chỉ khách mà bot trả lời xong và im lặng, mỗi lần im chỉ 1 lần", () => {
  const now = Date.now()
  const at = (userId: string, ms: number) =>
    db.db.prepare("UPDATE messages SET created_at = ? WHERE user_id = ?").run(ms, userId) &&
    db.db.prepare("UPDATE users SET last_user_at = ? WHERE id = ?").run(ms - 1000, userId)
  db.addMessage("f1", "user", "giá?"); db.addMessage("f1", "bot", "Dạ giá 1tr ạ"); at("f1", now - 3 * 3_600_000)
  db.addMessage("f2", "user", "giá?"); db.addMessage("f2", "bot", "Dạ giá 1tr ạ"); at("f2", now - 30 * 60_000) // mới 30 phút
  db.addMessage("f3", "user", "giá?"); db.addMessage("f3", "bot", HANDOVER_REPLY); at("f3", now - 3 * 3_600_000)
  db.addMessage("f4", "bot", "Dạ giá 1tr ạ"); db.addMessage("f4", "user", "ok"); at("f4", now - 3 * 3_600_000) // khách nói cuối
  const pick = () => db.followUpCandidates(now - 20 * 3_600_000, now - 2 * 3_600_000, HANDOVER_REPLY).filter((id) => id.startsWith("f"))
  assert.deepEqual(pick(), ["f1"])
  db.markFollowedUp("f1")
  assert.deepEqual(pick(), [])
})

test("thống kê ngày: khách, SĐT, đơn và file CSV", () => {
  const from = Date.now() - 3_600_000
  const s = { day: "2026-10-29", customers: db.customersBetween(from, Date.now() + 1000, HANDOVER_REPLY), orders: db.ordersBetween(from, Date.now() + 1000) }
  const p4 = s.customers.find((c) => c.id === "p4")!
  assert.equal(p4.is_new, 1)
  const p2 = s.customers.find((c) => c.id === "p2")!
  assert.equal(p2.handover, 1)
  const csv = views.statsCsv(s)
  assert.ok(csv.startsWith("﻿"))
  assert.match(csv, /"0987654321"/)
  assert.match(csv, /Nước đến: Trung Quốc/)
})

test("nhân viên nhắn trên Zalo → bot dừng; tin do bot gửi thì bỏ qua", () => {
  db.addMessage("u3", "bot", "xin chào")
  onOaMessage("u3", "xin chào")
  assert.ok(!db.isPaused("u3"))
  onOaMessage("u3", "Em là nhân viên, em hỗ trợ ạ")
  assert.ok(db.isPaused("u3"))
})

test("webhook gửi lặp cùng msg_id chỉ lưu 1 lần", () => {
  assert.ok(db.addMessage("u4", "user", "hi", "m1"))
  assert.ok(!db.addMessage("u4", "user", "hi", "m1"))
})

test("nhân viên chat: gửi lỗi thì không lưu tin, bot vẫn dừng", async () => {
  // Test không có token Zalo nên gửi chắc chắn lỗi.
  await assert.rejects(staffSend("u5", "Em là nhân viên ạ"))
  assert.equal(db.history("u5").length, 0)
  assert.ok(db.isPaused("u5"))
})

test("nhân viên bấm Gửi 2 lần liên tiếp cùng nội dung thì chỉ gửi 1 lần", async () => {
  db.addMessage("u7", "staff", "Dạ em gửi mã vận đơn ạ") // lần bấm thứ nhất đã lưu
  await staffSend("u7", "Dạ em gửi mã vận đơn ạ") // lần 2: bỏ qua, không gọi Zalo nên không lỗi
  assert.equal(db.history("u7").length, 1)
})

test("tin nhân viên gửi từ trang quản trị quay về qua webhook thì không lưu trùng", () => {
  db.addMessage("u6", "staff", "Dạ em kiểm tra ngay ạ")
  onOaMessage("u6", "Dạ em kiểm tra ngay ạ", "zalo-msg-1")
  assert.equal(db.history("u6").length, 1)
})

test("khởi động lại: chỉ khách có tin cuối chưa được trả lời là còn chờ", () => {
  const pending = db.pendingUsers(Date.now() - 60_000)
  assert.ok(pending.includes("u4")) // tin cuối là của khách
  assert.ok(!pending.includes("u3")) // tin cuối là của nhân viên
})

test("AI viết thẻ [TINH_GIA]: hệ thống tính rồi hỏi AI lần nữa kèm kết quả, thẻ không tới khách", async () => {
  db.setKv("ai_provider", "openai")
  db.setKv("ai_model", "test")
  db.setKv("ai_key_openai", "test-key")
  const real = globalThis.fetch
  const systems: string[] = []
  const replies = ["[TINH_GIA: JP | 3 | 40x30x30 | hang]", "Dạ giá đi Nhật ạ [TINH_GIA: JP | 3 | - | hang]"]
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    systems.push(JSON.parse(String(init.body)).messages[0].content)
    return Response.json({ choices: [{ message: { content: replies.shift() ?? "" } }] })
  }) as typeof fetch
  try {
    db.addMessage("g1", "user", "3kg đi Nhật thùng 40x30x30 bao nhiêu")
    assert.deepEqual(textOf(await answer("g1")), ["Dạ giá đi Nhật ạ"])
    assert.equal(systems.length, 2)
    assert.ok(!systems[0].includes("KẾT QUẢ TÍNH GIÁ"))
    assert.match(systems[1], /KẾT QUẢ TÍNH GIÁ[\s\S]*mã nước JP, hàng hóa, cân thực 3 kg, kích thước 40x30x30, trọng lượng tính cước 7,5 kg/)
  } finally {
    globalThis.fetch = real
    db.setKv("ai_provider", "gemini")
  }
})

test("tính giá xong mà bước viết câu trả lời lỗi: thử lại chỉ bước đó, không bắt AI viết thẻ lại", async () => {
  db.setKv("ai_provider", "openai")
  db.setKv("ai_model", "test")
  db.setKv("ai_key_openai", "test-key")
  const real = globalThis.fetch
  const systems: string[] = []
  const replies = ["[TINH_GIA: JP | 3 | - | hang]", "", "Dạ giá đây ạ"]
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    systems.push(JSON.parse(String(init.body)).messages[0].content)
    return Response.json({ choices: [{ message: { content: replies.shift() ?? "" } }] })
  }) as typeof fetch
  try {
    db.addMessage("g2", "user", "3kg đi Nhật")
    assert.deepEqual(textOf(await answer("g2")), ["Dạ giá đây ạ"])
    assert.deepEqual(systems.map((s) => s.includes("KẾT QUẢ TÍNH GIÁ")), [false, true, true])
  } finally {
    globalThis.fetch = real
    db.setKv("ai_provider", "gemini")
  }
})

test("khách nhắn thêm trong lúc AI đang soạn: bỏ câu đã soạn, không gửi câu trả lời cũ", async () => {
  db.setKv("ai_provider", "openai")
  db.setKv("ai_model", "test")
  db.setKv("ai_key_openai", "test-key")
  const real = globalThis.fetch
  globalThis.fetch = (async () => {
    db.addMessage("d1", "user", "5kg nha")
    return Response.json({ choices: [{ message: { content: "Dạ anh gửi đi Nhật bao nhiêu kg ạ?" } }] })
  }) as typeof fetch
  try {
    db.addMessage("d1", "user", "gửi đi Nhật")
    assert.equal(await answer("d1"), null)
    assert.deepEqual(db.history("d1", 10).map((m) => m.role), ["user", "user"])
  } finally {
    globalThis.fetch = real
    db.setKv("ai_provider", "gemini")
  }
})
