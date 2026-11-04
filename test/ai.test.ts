process.env.DB_PATH = ":memory:"
import assert from "node:assert/strict"
import { test } from "node:test"

const db = await import("../src/db.ts")
const { backupConfig, fallbackConfig } = await import("../src/ai.ts")

test("AI dự phòng: Gemini quá tải thì chuyển sang ChatGPT nếu đã bật, chưa bật thì đổi flash/flash-lite", () => {
  const gemini = { provider: "gemini" as const, model: "gemini-flash-lite-latest", key: "g" }
  assert.equal(fallbackConfig(gemini).model, "gemini-flash-latest")
  db.setKv("ai_backup_provider", "openai")
  assert.equal(backupConfig(), null) // chưa có key thì chưa dùng được
  db.setKv("ai_key_openai", "sk-test")
  assert.deepEqual(fallbackConfig(gemini), { provider: "openai", model: "gpt-4.1-mini", key: "sk-test" })
  // Đang dùng chính model dự phòng mà vẫn lỗi: giữ nguyên.
  assert.equal(fallbackConfig({ provider: "openai", model: "gpt-4.1-mini", key: "sk-test" }).model, "gpt-4.1-mini")
})

test("AI dự phòng: Gemini key thứ 2 cùng model vẫn chuyển sang (khác key)", () => {
  db.setKv("ai_backup_provider", "gemini")
  db.setKv("ai_backup_model", "gemini-flash-lite-latest")
  db.setKv("ai_backup_key", "g2")
  const main = { provider: "gemini" as const, model: "gemini-flash-lite-latest", key: "g1" }
  assert.deepEqual(fallbackConfig(main), { provider: "gemini", model: "gemini-flash-lite-latest", key: "g2" })
  // Đang dùng key 2 mà vẫn lỗi: đổi model flash/flash-lite.
  assert.equal(fallbackConfig({ ...main, key: "g2" }).model, "gemini-flash-latest")
})
