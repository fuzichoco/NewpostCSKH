process.env.DB_PATH = ":memory:"
import assert from "node:assert/strict"
import { test } from "node:test"

const db = await import("../src/db.ts")
const { normalizePhone, parseList, allowedNow } = await import("../src/zns.ts")

test("chuẩn hoá số điện thoại Việt Nam về dạng 84xxxxxxxxx", () => {
  assert.equal(normalizePhone("0912 345 678"), "84912345678")
  assert.equal(normalizePhone("+84 912.345.678"), "84912345678")
  assert.equal(normalizePhone("912345678"), "84912345678")
  assert.equal(normalizePhone("0212345678"), null) // đầu số không phải di động
  assert.equal(normalizePhone("12345"), null)
})

test("đọc danh sách: tách tên, bỏ số trùng, báo dòng sai", () => {
  const { valid, invalid } = parseList("0912345678, Nguyễn Văn An\n0912 345 678; trùng\n\nabc, sai\n0987654321")
  assert.deepEqual(valid, [{ phone: "84912345678", name: "Nguyễn Văn An" }, { phone: "84987654321", name: "" }])
  assert.deepEqual(invalid, ["abc, sai"])
})

test("khung giờ gửi: Hậu mãi chỉ 7h–22h giờ Việt Nam, Giao dịch mọi lúc", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 23, h - 7)) // giờ VN = UTC+7
  assert.ok(allowedNow("PROMOTION", at(9)))
  assert.ok(!allowedNow("PROMOTION", at(22)))
  assert.ok(!allowedNow("CUSTOMER_CARE", at(6)))
  assert.ok(allowedNow("TRANSACTION", at(23)))
})

test("hàng chờ: cùng số cùng mẫu chỉ thêm 1 lần; từ chối nhận tin thì huỷ tin đang chờ", () => {
  const job = { phone: "84912345678", name: "An", templateId: "T1", templateName: "Giới thiệu", tag: "PROMOTION", data: { ten: "An" } }
  assert.equal(db.queueZnsJobs([job, { ...job, phone: "84987654321" }]), 2)
  assert.equal(db.queueZnsJobs([job]), 0)
  db.addOptOut(["84912345678"])
  assert.ok(db.isOptedOut("84912345678"))
  assert.deepEqual(db.znsCounts(), { pending: 1, sent: 0, failed: 0, skipped: 1 })
})
