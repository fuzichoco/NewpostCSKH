process.env.DB_PATH = ":memory:"
process.env.GEMINI_API_KEY = "" // không gọi AI thật trong test
process.env.AI_RETRY_MS = "0"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"

const db = await import("../src/db.ts")
const { answer, findPhone, inReplyHours, onOaMessage, onUserInfo, onUserMessage, resumeAfterHandover, staffSend, wantsHuman, HANDOVER_REPLY, PHONE_REQUEST_LOG } =
  await import("../src/bot.ts")
const { verifySignature } = await import("../src/zalo.ts")
const views = await import("../src/views.ts")
const { sendTracking, watchShipments } = await import("../src/bot.ts")
const { WATCH_NOTE } = await import("../src/tracking.ts")

const textOf = (out: Awaited<ReturnType<typeof answer>>) =>
  out?.map((o) => ("text" in o ? o.text : "image" in o ? `ảnh ${o.image.id}` : "buttons" in o ? `nút: ${o.buttons.items.map((b) => b.title).join(" / ")}` : "nút chia sẻ SĐT"))

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
  assert.deepEqual(textOf(await answer("u1")), [HANDOVER_REPLY, "nút: Miền Bắc / Miền Trung / Miền Nam"])
  assert.ok(db.isPaused("u1"))
  db.addMessage("u1", "user", "alo?")
  assert.equal(await answer("u1"), null)
})

test("AI lỗi → chuyển nhân viên thay vì im lặng", async () => {
  db.addMessage("u2", "user", "giá gửi hàng?")
  assert.deepEqual(textOf(await answer("u2")), [HANDOVER_REPLY, "nút: Miền Bắc / Miền Trung / Miền Nam"])
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
    assert.deepEqual(textOf(await answer("p2")), [HANDOVER_REPLY, "nút: Miền Bắc / Miền Trung / Miền Nam"])
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
    // Chốt đơn mà chưa biết bưu cục: hỏi luôn vùng → bưu cục để báo đúng nhân viên chi nhánh.
    assert.deepEqual(textOf(out), ["Dạ em cảm ơn anh, nhân viên sẽ gọi anh để hẹn lấy hàng ạ.", `ảnh ${img}`, "nút: Miền Bắc / Miền Trung / Miền Nam"])
    const [order] = db.ordersBetween(0, Date.now() + 1000).filter((o) => o.user_id === "p4")
    assert.equal(order.phone, "84912345678")
    assert.match(order.summary, /^Nước đến: Trung Quốc/)
    assert.match(db.history("p4").at(-2)!.text, /^\[Gửi hình ảnh\] #\d+ Bảng giá Trung Quốc$/)
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

test("thống kê ngày: khách, SĐT, đơn và file Excel 4 trang tính", async () => {
  const from = Date.now() - 3_600_000, to = Date.now() + 1000
  const s = { day: "2026-10-29", customers: db.customersBetween(from, to, HANDOVER_REPLY), orders: db.ordersBetween(from, to), messages: db.messagesBetween(from, to) }
  const p4 = s.customers.find((c) => c.id === "p4")!
  assert.equal(p4.is_new, 1)
  assert.ok(p4.total_msgs >= 1 && p4.first_ever > 0)
  const p2 = s.customers.find((c) => c.id === "p2")!
  assert.equal(p2.handover, 1)
  // Đọc lại file bằng bộ đọc Excel của hệ thống: đúng định dạng .xlsx và đủ thông tin.
  const { xlsxSheets } = await import("../src/import.ts")
  const sheets = xlsxSheets(views.statsXlsx(s, "https://cskh.test"))
  assert.deepEqual(sheets.map((x) => x.name), ["Tổng quan", "Khách hàng", "Đơn đã chốt", "Tin nhắn"])
  const all = sheets.map((x) => x.rows.map((r) => r.join("\t")).join("\n")).join("\n")
  assert.match(all, /0987654321/)
  assert.match(all, /Nước đến: Trung Quốc/)
  assert.match(all, /https:\/\/cskh\.test\/admin\/u\?id=/)
  const orders = sheets[2].rows
  assert.equal(orders[1][orders[0].indexOf("Nước đến")], "Trung Quốc")
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

test("khách tra đơn: AI thêm [KHONG_HOI_THAM] → ẩn thẻ, không hỏi thăm sau 2 giờ; khách nhắn lại thì hỏi thăm bình thường", async () => {
  const restore = fakeAi(["Dạ anh tra cứu đơn trên app NewPost Khách Hàng hoặc gọi hotline ạ.\n[KHONG_HOI_THAM]"])
  try {
    db.addMessage("t1", "user", "mã vận đơn 607267991 sao chưa tới")
    assert.deepEqual(textOf(await answer("t1")), ["Dạ anh tra cứu đơn trên app NewPost Khách Hàng hoặc gọi hotline ạ."])
    const later = Date.now() + 3 * 3_600_000
    assert.ok(!db.followUpCandidates(later - 20 * 3_600_000, later - 2 * 3_600_000, HANDOVER_REPLY).includes("t1"))
  } finally {
    restore()
  }
  await new Promise((r) => setTimeout(r, 5)) // tin mới phải sau mốc đã hỏi thăm (cùng mili giây thì không tính)
  onUserMessage("t1", "mà gửi 2kg đi Nhật giá sao")
  const restore2 = fakeAi(["Dạ anh cho em xin kích thước ạ"])
  try {
    await answer("t1")
    const later = Date.now() + 3 * 3_600_000
    assert.ok(db.followUpCandidates(later - 20 * 3_600_000, later - 2 * 3_600_000, HANDOVER_REPLY).includes("t1"))
  } finally {
    restore2()
  }
})

test("giờ trả lời: trong khung, qua đêm, để trống là cả ngày", () => {
  const vn = (hm: string) => Date.parse(`2026-11-02T${hm}:00+07:00`)
  assert.ok(inReplyHours(vn("03:00")))
  db.setKv("reply_from", "08:00")
  db.setKv("reply_to", "21:00")
  assert.ok(!inReplyHours(vn("07:59")) && inReplyHours(vn("08:00")) && inReplyHours(vn("20:59")) && !inReplyHours(vn("21:00")))
  db.setKv("reply_from", "20:00")
  db.setKv("reply_to", "06:00")
  assert.ok(inReplyHours(vn("23:30")) && inReplyHours(vn("05:00")) && !inReplyHours(vn("12:00")))
  db.setKv("reply_from", "")
  db.setKv("reply_to", "")
})

test("báo nhân viên: chuyển nhân viên không báo riêng; khách nhắn thì báo rõ ràng; nhân viên nhắn OA thì bot không trả lời", async () => {
  const notify = await import("../src/notify.ts")
  db.setKv("tg_token", "t")
  db.setKv("tg_chat", "-100")
  const sent: string[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)).text)
    return Response.json({ ok: true, result: {} })
  }) as typeof fetch
  try {
    db.addMessage("n1", "user", "cho gặp nhân viên")
    db.setUserName("n1", "Chị Lan")
    db.setPhone("n1", "84912345678")
    // Như khi chạy thật: báo "khách nhắn" trước, rồi bot trả lời (chuyển nhân viên không báo thêm).
    const { notifyNewMessage } = await import("../src/bot.ts")
    notifyNewMessage("n1")
    await answer("n1")
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(sent.length, 1) // chỉ còn 2 loại thông báo: khách nhắn, đơn hàng
    const lines = sent[0].split("\n")
    assert.equal(lines[0], "🔔 KHÁCH NHẮN ZALO OA")
    assert.ok(lines.includes("👤 Khách: Chị Lan"))
    assert.ok(lines.includes("📞 SĐT: 0912 345 678"))
    assert.ok(lines.includes('💬 Tin nhắn: "cho gặp nhân viên"'))
    notify.setStaff("s1", true)
    db.addMessage("s1", "user", "nhân viên đây")
    assert.equal(await answer("s1"), null)
    notify.setStaff("s1", false)
    assert.deepEqual(notify.staffIds(), [])
  } finally {
    globalThis.fetch = real
    db.setKv("tg_token", "")
  }
})

test("báo nhân viên: mỗi khách chỉ báo 1 lần mỗi ngày dù nhắn nhiều", async () => {
  db.setKv("tg_token", "t")
  db.setKv("tg_chat", "-100")
  const sent: string[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)).text)
    return Response.json({ ok: true, result: {} })
  }) as typeof fetch
  try {
    const { notifyNewMessage } = await import("../src/bot.ts")
    for (const text of ["gửi đi Nhật giá sao", "alo", "còn đó không"]) {
      db.addMessage("n2", "user", text)
      notifyNewMessage("n2")
    }
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(sent.length, 1)
  } finally {
    globalThis.fetch = real
    db.setKv("tg_token", "")
  }
})

test("tắt chuyển nhân viên: khách đòi gặp người thật thì bot vẫn trả lời, không tạm dừng", async () => {
  db.setKv("handover_enabled", "0")
  const restore = fakeAi(["[CHUYEN_NHAN_VIEN]", "[CHUYEN_NHAN_VIEN]", "[CHUYEN_NHAN_VIEN]"])
  try {
    db.addMessage("h1", "user", "cho gặp nhân viên")
    const out = textOf(await answer("h1"))
    assert.ok(out?.[0].includes("để lại số điện thoại"))
    assert.ok(!db.isPaused("h1"))
  } finally {
    restore()
    db.setKv("handover_enabled", "1")
  }
})

test("tra vận đơn: AI viết thẻ TRA_DON → code tra → AI viết câu trả lời; AI lặp thẻ thì gửi kết quả code tự viết", async () => {
  const real = globalThis.fetch
  db.setKv("ai_provider", "openai")
  db.setKv("ai_model", "test")
  db.setKv("ai_key_openai", "test-key")
  const ai = ["[TRA_DON: 607211381]", "[TRA_DON: 607211381]", "[TRA_DON: 607211381]", "[TRA_DON: 607211381]"]
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("track-api")) return new Response('var x = {"track_order_nonce":"abc123"}')
    if (String(url).includes("admin-ajax")) return new Response('<li class="timeline-item a"><span class="timeline-date">02-11-2026 18:43</span><div class="title">Đang vận chuyển</div></li>')
    return Response.json({ choices: [{ message: { content: ai.shift() ?? "" } }] })
  }) as typeof fetch
  try {
    db.addMessage("tr1", "user", "đơn 607211381 tới đâu rồi")
    assert.deepEqual(textOf(await answer("tr1")), [`Dạ mã vận đơn 607211381: Đang vận chuyển (cập nhật 02-11-2026 18:43). ${WATCH_NOTE}`])
    assert.deepEqual(db.watches().map((w) => [w.user_id, w.code]), [["tr1", "607211381"]])
  } finally {
    globalThis.fetch = real
    db.setKv("ai_provider", "gemini")
  }
})

test("theo dõi vận đơn: chưa giao thì chờ; giao thành công thì nhắn khách 1 lần rồi thôi theo dõi (cả ban đêm)", async () => {
  db.setKv("access_token", "t")
  db.setKv("expires_at", String(Date.now() + 3_600_000))
  const sent: string[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/oa/message/cs")) sent.push(JSON.parse(String(init?.body)).message.text)
    return Response.json({ error: 0, data: {} })
  }) as typeof fetch
  const at = (status: string, desc = "") => async (code: string) =>
    ({ code, info: [], events: [{ time: "03-11-2026 13:24", title: status, place: "", desc }] })
  const now = Date.now()
  const noon = now - ((now + 7 * 3_600_000) % 86_400_000) + 12 * 3_600_000 // 12h trưa hôm nay giờ VN
  try {
    db.unwatchCode("tr1", "607211381")
    db.addMessage("w1", "user", "đơn 607188891 tới đâu rồi")
    db.watchCode("w1", "607188891")
    await watchShipments(noon, at("Đang vận chuyển"))
    assert.deepEqual(sent, [])
    await watchShipments(noon + 10 * 3_600_000, at("Đã giao thành công", "Delivered"))
    assert.deepEqual(sent, ["Dạ em báo anh/chị: vận đơn 607188891 đã giao thành công lúc 03-11-2026 13:24 ạ. Cảm ơn anh/chị đã tin tưởng gửi hàng cùng NewPost Global!"])
    assert.ok(!db.watches().some((w) => w.user_id === "w1"))

    // Nhân viên nhập mã vận đơn ở trang hội thoại: nhắn khách mã + hành trình, chưa giao thì theo dõi.
    const staffSent: string[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("track-api")) return new Response('var x = {"track_order_nonce":"abc123"}')
      if (String(url).includes("admin-ajax")) {
        const code = new URLSearchParams(String(init?.body)).get("tracking_id")
        const status = { "607000001": "Đã tạo vận đơn", "607000002": "Đang vận chuyển", "607000003": "Đã giao thành công" }[code ?? ""]
        return new Response(status ? `<li class="timeline-item a"><span class="timeline-date">03-11-2026 09:00</span><div class="title">${status}</div></li>` : "")
      }
      if (String(url).includes("/oa/message/cs")) staffSent.push(JSON.parse(String(init?.body)).message.text)
      return Response.json({ error: 0, data: {} })
    }) as typeof fetch
    await sendTracking("w2", "607 000 001")
    assert.equal(staffSent.at(-1), `Dạ em gửi anh/chị mã vận đơn: 607000001\nHành trình hiện tại: Đã tạo vận đơn (cập nhật 03-11-2026 09:00).\n${WATCH_NOTE}`)
    assert.deepEqual(db.watches().filter((w) => w.user_id === "w2").map((w) => w.code), ["607000001"])
    await assert.rejects(sendTracking("w2", "999999999"), /Không tìm thấy mã 999999999/)

    // Nhiều mã 1 lần: 1 tin gộp; mã đã giao không theo dõi; mã sai báo lại nhân viên.
    assert.deepEqual(await sendTracking("w3", "607000002, 607000003\n999999999"), { missing: ["999999999"] })
    assert.equal(staffSent.at(-1), `Dạ em gửi anh/chị các mã vận đơn và hành trình hiện tại:
- 607000002: Đang vận chuyển (cập nhật 03-11-2026 09:00)
- 607000003: Đã giao thành công (cập nhật 03-11-2026 09:00)
Em đã ghi nhận theo dõi các vận đơn chưa giao xong, khi giao thành công em sẽ tự nhắn báo anh/chị ngay ạ.`)
    assert.deepEqual(db.watches().filter((w) => w.user_id === "w3").map((w) => w.code), ["607000002"])

    // Nhiều mã cùng giao thành công trong 1 lượt: 1 tin gộp.
    db.addMessage("w4", "user", "theo dõi giúp em 2 đơn")
    db.watchCode("w4", "607000004")
    db.watchCode("w4", "607000005")
    const before = staffSent.length
    await watchShipments(noon, at("Đã giao thành công", "Delivered"))
    assert.deepEqual(staffSent.slice(before).filter((t) => t.includes("607000004")), [`Dạ em báo anh/chị: các vận đơn sau đã giao thành công ạ:
- 607000004 lúc 03-11-2026 13:24
- 607000005 lúc 03-11-2026 13:24
Cảm ơn anh/chị đã tin tưởng gửi hàng cùng NewPost Global!`])
    assert.ok(!db.watches().some((w) => w.user_id === "w4"))
  } finally {
    globalThis.fetch = real
    db.setKv("expires_at", "0") // để các test sau không gửi Zalo thật từ lượt chờ của onUserMessage
  }
})

test("chọn vùng / bưu cục: AI thêm [HOI_VUNG] → gửi nút chọn vùng; khách bấm vùng → hỏi tiếp bưu cục; đủ rồi thì không hỏi nữa", async () => {
  const restore = fakeAi(["Dạ em báo giá ngay ạ.\n[HOI_VUNG]", "Dạ em ghi nhận ạ.\n[HOI_VUNG]"])
  try {
    db.addMessage("v1", "user", "gửi 3kg đi Nhật")
    assert.deepEqual(textOf(await answer("v1")), ["Dạ em báo giá ngay ạ.", "nút: Miền Bắc / Miền Trung / Miền Nam"])
    onUserMessage("v1", "Tôi ở Miền Trung")
    assert.equal(db.getUser("v1")?.region, "trung")
    // Bấm chọn vùng: 1 tin ghi nhận + hỏi bưu cục, không gọi AI.
    const out = await answer("v1")
    assert.deepEqual(textOf(out), ["nút: Bưu cục miền Bắc (Hà Nội) / Bưu cục miền Nam (TP.HCM)"])
    assert.ok(out?.[0] && "buttons" in out[0] && out[0].buttons.text.startsWith("Dạ em ghi nhận anh/chị ở Miền Trung ạ."))
    onUserMessage("v1", "Tôi gửi hàng về Bưu cục miền Nam (TP.HCM)")
    assert.equal(db.getUser("v1")?.branch, "nam")
    // Bấm chọn bưu cục: code gửi địa chỉ + SĐT nhân viên bưu cục đó, không gọi AI.
    const [confirm] = textOf(await answer("v1"))!
    assert.match(confirm, /Bưu cục miền Nam \(TP\.HCM\)/)
    assert.match(confirm, /86\/41 Trần Thái Tông/)
    assert.match(confirm, /chị Bình – 0376 891 937/)
    db.addMessage("v1", "user", "ok")
    assert.deepEqual(textOf(await answer("v1")), ["Dạ em ghi nhận ạ."])
  } finally {
    restore()
  }
})

test("AI nhận ra vùng từ tin khách ([VUNG: nam]) thì lưu và ẩn thẻ", async () => {
  const restore = fakeAi(["Dạ Cần Thơ bên em nhận ạ.\n[VUNG: nam]"])
  try {
    db.addMessage("v2", "user", "mình ở Cần Thơ")
    assert.deepEqual(textOf(await answer("v2")), ["Dạ Cần Thơ bên em nhận ạ."])
    assert.equal(db.getUser("v2")?.region, "nam")
  } finally {
    restore()
  }
})

test("khách nói nơi ở thì tự ghi vùng; đã có vùng thì không đổi", () => {
  onUserMessage("loc1", "mình ở Quy Nhơn muốn gửi hàng đi Hàn")
  assert.equal(db.getUser("loc1")?.region, "trung")
  onUserMessage("loc1", "người nhận cũ ở Hà Nội")
  assert.equal(db.getUser("loc1")?.region, "trung")
})

test("chuyển nhân viên → khách chọn bưu cục → gửi SĐT + địa chỉ, chỉ báo Zalo nhân viên đúng chi nhánh", async () => {
  const notify = await import("../src/notify.ts")
  notify.setStaff("staffBac", true, "bac")
  notify.setStaff("staffNam", true, "nam")
  notify.setStaff("staffAll", true, "all")
  db.setKv("access_token", "t")
  db.setKv("expires_at", String(Date.now() + 3_600_000))
  const zaloTo: string[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/oa/message/cs")) zaloTo.push(JSON.parse(String(init?.body)).recipient.user_id)
    return Response.json({ error: 0, data: {} })
  }) as typeof fetch
  try {
    db.addMessage("hb1", "user", "cho mình gặp nhân viên")
    assert.deepEqual(textOf(await answer("hb1")), [HANDOVER_REPLY, "nút: Miền Bắc / Miền Trung / Miền Nam"])
    assert.ok(db.isPaused("hb1"))
    await new Promise((r) => setTimeout(r, 10))
    assert.deepEqual(zaloTo, []) // chưa biết bưu cục: chưa báo Zalo
    onUserMessage("hb1", "Tôi ở Miền Trung")
    assert.match(textOf(await answer("hb1"))![0], /nút: Bưu cục miền Bắc/) // bot đang tạm dừng vẫn trả lời nút
    onUserMessage("hb1", "Tôi gửi hàng về Bưu cục miền Nam (TP.HCM)")
    const [confirm] = textOf(await answer("hb1"))!
    assert.match(confirm, /chị Bình – 0376 891 937/)
    assert.match(confirm, /86\/41 Trần Thái Tông/)
    await new Promise((r) => setTimeout(r, 10))
    assert.deepEqual(zaloTo, []) // chuyển nhân viên không báo riêng (chỉ báo khách nhắn và đơn hàng)
    // Khách đã có bưu cục, lần sau đòi gặp nhân viên: đưa luôn SĐT nhân viên bưu cục đó.
    db.pauseBot("hb1", 0)
    db.addMessage("hb1", "user", "gặp người thật")
    db.setKv("notified_handover:hb1", "")
    const out = textOf(await answer("hb1"))!
    assert.equal(out[0], HANDOVER_REPLY)
    assert.match(out[1], /chị Bình – nhân viên Bưu cục miền Nam/)
  } finally {
    globalThis.fetch = real
    for (const id of ["staffBac", "staffNam", "staffAll"]) notify.setStaff(id, false)
  }
})

test("khách chốt đơn: biết bưu cục thì báo ngay đúng chi nhánh; chưa biết thì hỏi bưu cục rồi báo Zalo nhân viên chi nhánh đó", async () => {
  const notify = await import("../src/notify.ts")
  notify.setStaff("ordBac", true, "bac")
  notify.setStaff("ordNam", true, "nam")
  db.setKv("access_token", "t")
  db.setKv("expires_at", String(Date.now() + 3_600_000))
  db.setKv("tg_token", "tg")
  db.setKv("tg_chat", "-1")
  const sent: string[] = []
  const realFetch = globalThis.fetch
  const ai = ["Dạ em đã ghi nhận đơn ạ.\n[DON_HANG] Nước đến: Nhật | Hàng: quần áo | Cân nặng: 5kg | SĐT: 0912345678",
    "Dạ em đã ghi nhận đơn ạ.\n[DON_HANG] Nước đến: Úc | Hàng: sách | Cân nặng: 2kg | SĐT: 0987654321"]
  db.setKv("ai_provider", "openai"); db.setKv("ai_model", "test"); db.setKv("ai_key_openai", "k")
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes("api.telegram.org")) { sent.push("telegram:" + JSON.parse(String(init?.body)).text.split("\n")[0]); return Response.json({ ok: true, result: {} }) }
    if (u.includes("/oa/message/cs")) { sent.push("zalo:" + JSON.parse(String(init?.body)).recipient.user_id); return Response.json({ error: 0, data: {} }) }
    return Response.json({ choices: [{ message: { content: ai.shift() ?? "" } }] })
  }) as typeof fetch
  const flush = () => new Promise((r) => setTimeout(r, 10))
  try {
    // Đã có bưu cục miền Bắc: báo Telegram + Zalo nhân viên miền Bắc ngay.
    db.addMessage("od1", "user", "ok chốt đơn nhé"); db.setBranch("od1", "bac")
    await answer("od1"); await flush()
    assert.deepEqual(sent.map((x) => x.replace(/#\d+/, "#")).sort(), ["telegram:🛒 ĐƠN MỚI # – CẦN GỌI XÁC NHẬN", "zalo:ordBac"])
    sent.length = 0
    // Chưa có bưu cục: báo Telegram, hỏi vùng; khách chọn bưu cục miền Nam → báo Zalo nhân viên miền Nam, gửi SĐT + địa chỉ.
    db.addMessage("od2", "user", "chốt đơn")
    const out = textOf(await answer("od2"))!
    assert.equal(out.at(-1), "nút: Miền Bắc / Miền Trung / Miền Nam")
    await flush()
    assert.deepEqual(sent.map((x) => x.replace(/#\d+/, "#")), ["telegram:🛒 ĐƠN MỚI # – CẦN GỌI XÁC NHẬN"])
    sent.length = 0
    onUserMessage("od2", "Tôi ở Miền Nam")
    await answer("od2")
    onUserMessage("od2", "Tôi gửi hàng về Bưu cục miền Nam (TP.HCM)")
    const [confirm] = textOf(await answer("od2"))!
    assert.match(confirm, /đã gửi thông tin đơn/)
    assert.match(confirm, /chị Bình – 0376 891 937/)
    await flush()
    assert.deepEqual(sent, ["zalo:ordNam"])
  } finally {
    globalThis.fetch = realFetch
    db.setKv("ai_provider", "gemini")
    db.setKv("tg_token", "")
    for (const id of ["ordBac", "ordNam"]) notify.setStaff(id, false)
  }
})

test("khách sửa đơn đã chốt → cập nhật đúng đơn, báo nhân viên chi nhánh; vài ngày sau chốt đơn mới → đơn mới, không hỏi lại bưu cục", async () => {
  const notify = await import("../src/notify.ts")
  notify.setStaff("edBac", true, "bac")
  db.setKv("access_token", "t")
  db.setKv("expires_at", String(Date.now() + 3_600_000))
  db.setKv("tg_token", "")
  const zaloText: string[] = []
  const systems: string[] = []
  const ai: string[] = []
  db.setKv("ai_provider", "openai"); db.setKv("ai_model", "test"); db.setKv("ai_key_openai", "k")
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"))
    if (String(url).includes("/oa/message/cs")) { zaloText.push(body.message.text.split("\n")[0]); return Response.json({ error: 0, data: {} }) }
    systems.push(body.messages?.[0]?.content ?? "")
    return Response.json({ choices: [{ message: { content: ai.shift() ?? "" } }] })
  }) as typeof fetch
  const flush = () => new Promise((r) => setTimeout(r, 10))
  try {
    db.addMessage("ed1", "user", "x"); db.setBranch("ed1", "bac")
    const id = db.addOrder("ed1", null, "Nước đến: Nhật | Hàng: quần áo | Lấy hàng: Cầu Giấy, Hà Nội")
    // Khách đổi địa chỉ lấy hàng: AI thấy đơn cũ trong THÔNG TIN KHÁCH và viết thẻ sửa đơn.
    ai.push(`Dạ em đã cập nhật địa chỉ lấy hàng mới ạ.\n[DON_HANG_SUA #${id}] Nước đến: Nhật | Hàng: quần áo | Lấy hàng: Long Biên, Hà Nội`)
    db.addMessage("ed1", "user", "đổi giúp mình địa chỉ lấy hàng sang Long Biên nhé")
    assert.deepEqual(textOf(await answer("ed1")), ["Dạ em đã cập nhật địa chỉ lấy hàng mới ạ."])
    assert.ok(systems.at(-1)!.includes("ĐƠN ĐÃ CHỐT") && systems.at(-1)!.includes(`#${id} chốt lúc`))
    const o = db.getOrder(id)!
    assert.match(o.summary, /Long Biên/)
    assert.equal(db.ordersBetween(0, Date.now() + 1000).filter((x) => x.user_id === "ed1").length, 1) // sửa, không tạo đơn mới
    await flush()
    assert.deepEqual(zaloText, [`✏️ KHÁCH SỬA ĐƠN #${id}`])
    zaloText.length = 0
    // Vài ngày sau chốt thêm lô khác: đơn mới, báo thẳng nhân viên bưu cục đã chọn, không hỏi lại bưu cục.
    ai.push("Dạ em đã ghi nhận đơn mới ạ.\n[DON_HANG] Nước đến: Úc | Hàng: sách | Lấy hàng: Long Biên, Hà Nội")
    db.addMessage("ed1", "user", "mình gửi thêm 1 lô sách đi Úc nữa nhé, chốt luôn")
    assert.deepEqual(textOf(await answer("ed1")), ["Dạ em đã ghi nhận đơn mới ạ."])
    assert.equal(db.ordersBetween(0, Date.now() + 1000).filter((x) => x.user_id === "ed1").length, 2)
    await flush()
    assert.match(zaloText[0], /^🛒 ĐƠN MỚI #\d+ – CẦN GỌI XÁC NHẬN$/)
    // Mã đơn không phải của khách này: không sửa đơn người khác, lưu thành đơn mới.
    const other = db.addOrder("someone", null, "Nước đến: Mỹ")
    ai.push(`Dạ vâng ạ.\n[DON_HANG_SUA #${other}] Nước đến: Hàn | Lấy hàng: Hà Nội`)
    db.addMessage("ed1", "user", "sửa đơn")
    await answer("ed1")
    assert.equal(db.getOrder(other)!.summary, "Nước đến: Mỹ")
    assert.equal(db.ordersBetween(0, Date.now() + 1000).filter((x) => x.user_id === "ed1").length, 3)
  } finally {
    globalThis.fetch = realFetch
    db.setKv("ai_provider", "gemini")
    notify.setStaff("edBac", false)
  }
})

test("khách đổi bưu cục (bấm lại nút cũ): báo rõ đã đổi, nhân viên chi nhánh mới nhận đơn gần nhất", async () => {
  const notify = await import("../src/notify.ts")
  notify.setStaff("chBac", true, "bac")
  notify.setStaff("chNam", true, "nam")
  db.setKv("access_token", "t")
  db.setKv("expires_at", String(Date.now() + 3_600_000))
  db.setKv("tg_token", "")
  const zaloTo: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/oa/message/cs")) zaloTo.push(JSON.parse(String(init?.body)).recipient.user_id)
    return Response.json({ error: 0, data: {} })
  }) as typeof fetch
  try {
    onUserMessage("ch1", "Tôi gửi hàng về Bưu cục miền Nam (TP.HCM)")
    db.addOrder("ch1", null, "Nước đến: Hàn | Hàng: mỹ phẩm")
    await answer("ch1")
    zaloTo.length = 0
    // Bấm Nam rồi Bắc liền nhau: trả lời 1 lần theo lựa chọn cuối, nói rõ đã đổi.
    onUserMessage("ch1", "Tôi gửi hàng về Bưu cục miền Nam (TP.HCM)")
    onUserMessage("ch1", "Tôi gửi hàng về Bưu cục miền Bắc (Hà Nội)")
    const [text] = textOf(await answer("ch1"))!
    assert.match(text, /đã đổi từ Bưu cục miền Nam \(TP\.HCM\) sang Bưu cục miền Bắc \(Hà Nội\)/)
    assert.match(text, /chị Huyền – 0978 835 005/)
    assert.equal(db.getUser("ch1")?.branch, "bac")
    await new Promise((r) => setTimeout(r, 10))
    assert.deepEqual(zaloTo, ["chBac"])
  } finally {
    globalThis.fetch = realFetch
    for (const id of ["chBac", "chNam"]) notify.setStaff(id, false)
  }
})
