process.env.DB_PATH = ":memory:"
import assert from "node:assert/strict"
import { test } from "node:test"

const db = await import("../src/db.ts")

test("tài khoản: lưu mật khẩu đã băm, đổi mật khẩu, đếm admin", () => {
  db.addAccount("lan", "Lan", "matkhau1", "staff")
  db.addAccount("sep", "Sếp", "matkhau2", "admin")
  const lan = db.getAccount("lan")!
  assert.notEqual(lan.pass, "matkhau1")
  assert.ok(db.checkPassword("matkhau1", lan.pass))
  assert.ok(!db.checkPassword("sai", lan.pass))
  db.updateAccount("lan", "Lan Nguyễn", "admin", "moi123")
  const after = db.getAccount("lan")!
  assert.equal(after.role, "admin")
  assert.ok(db.checkPassword("moi123", after.pass) && !db.checkPassword("matkhau1", after.pass))
  assert.equal(db.countAdmins(), 2)
  assert.ok(!db.checkPassword("x", "abc:12")) // hash lưu sai độ dài: báo sai mật khẩu, không lỗi
  db.deleteAccount("lan")
  assert.equal(db.getAccount("lan"), undefined)
})
