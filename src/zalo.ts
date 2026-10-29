// Gọi API Zalo OA. Công thức chữ ký webhook, danh sách endpoint và cách làm mới token
// được chuyển thể từ ChatbotX (integrations/zalo) – MIT License, xem THIRD_PARTY_NOTICES.md.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { getKv, setKv } from "./db.ts"

const API = "https://openapi.zalo.me"
const OAUTH = "https://oauth.zaloapp.com"
const env = process.env

/** Zalo ký header `X-ZEvent-Signature: mac=sha256(appId + rawBody + timestamp + OA secret key)`.
 *  Phải dùng body THÔ (chuỗi nhận được), không JSON.stringify lại. */
export function verifySignature(rawBody: string, appId: string, timestamp: string, header: string, secret: string): boolean {
  const got = header.split("=")[1] ?? ""
  const expected = createHash("sha256").update(`${appId}${rawBody}${timestamp}${secret}`).digest("hex")
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected))
}

// Zalo báo lỗi bằng HTTP 200 + `error != 0` (API OA) hoặc `error_name` (API OAuth).
export async function zaloFetch(url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok || (data.error && data.error !== 0) || data.error_name) {
    throw new Error(`Zalo API lỗi (${url.split("?")[0]}): ${JSON.stringify(data)}`)
  }
  return data
}

async function requestToken(params: Record<string, string>) {
  const data = await zaloFetch(`${OAUTH}/v4/oa/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", secret_key: env.ZALO_APP_SECRET ?? "" },
    body: new URLSearchParams({ app_id: env.ZALO_APP_ID ?? "", ...params }),
  })
  // Lưu ngay: refresh token chỉ dùng được 1 lần, mất là phải kết nối lại OA.
  if (!(data.access_token && data.refresh_token)) throw new Error(`Không nhận được token: ${JSON.stringify(data)}`)
  setKv("access_token", data.access_token)
  setKv("refresh_token", data.refresh_token)
  setKv("expires_at", String(Date.now() + Number(data.expires_in) * 1000))
}

export function authUrl(): string {
  const state = randomBytes(16).toString("hex")
  setKv("oauth_state", state)
  return `${OAUTH}/v4/oa/permission?${new URLSearchParams({
    app_id: env.ZALO_APP_ID ?? "",
    redirect_uri: `${env.PUBLIC_URL}/admin/zalo/callback`,
    state,
  })}`
}

export async function exchangeCode(code: string, state: string) {
  if (!state || state !== getKv("oauth_state")) throw new Error("state không khớp – hãy bấm lại 'Kết nối Zalo OA'")
  await requestToken({ code, grant_type: "authorization_code" })
}

// ponytail: khóa trong bộ nhớ, đủ cho 1 tiến trình; chạy nhiều tiến trình thì cần khóa trong DB
let refreshing: Promise<void> | undefined

export async function accessToken(): Promise<string> {
  const token = getKv("access_token")
  if (token && Date.now() < Number(getKv("expires_at") ?? 0) - 5 * 60_000) return token
  refreshing ??= (async () => {
    const rt = getKv("refresh_token") ?? env.ZALO_REFRESH_TOKEN
    if (!rt) throw new Error("Chưa kết nối Zalo OA – vào /admin bấm 'Kết nối Zalo OA'")
    await requestToken({ refresh_token: rt, grant_type: "refresh_token" })
  })().finally(() => (refreshing = undefined))
  await refreshing
  return getKv("access_token")!
}

/** Gửi tin tư vấn dạng chữ (tối đa 2000 ký tự). Chỉ gửi được trong 48h sau tin cuối của khách. */
export async function sendText(userId: string, text: string) {
  await zaloFetch(`${API}/v3.0/oa/message/cs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: await accessToken() },
    body: JSON.stringify({ recipient: { user_id: userId }, message: { text: text.slice(0, 2000) } }),
  })
}

/** Gửi ảnh (jpg/png tối đa 1 MB, gif tối đa 5 MB): tải ảnh lên Zalo lấy attachment_id rồi gửi tin tư vấn dạng media.
 *  ponytail: tải lại mỗi lần gửi, khỏi lo attachment_id hết hạn; lưu lại id nếu gửi ảnh nhiều. */
export async function sendImage(userId: string, data: Uint8Array, type: string) {
  const token = await accessToken()
  const media_type = type === "image/gif" ? "gif" : "image"
  const form = new FormData()
  form.append("file", new Blob([new Uint8Array(data)], { type }), `image.${type.split("/")[1]}`)
  const up = await zaloFetch(`${API}/v2.0/oa/upload/${media_type}`, { method: "POST", headers: { access_token: token }, body: form })
  const attachment_id = up.data?.attachment_id
  if (!attachment_id) throw new Error(`Zalo không trả attachment_id: ${JSON.stringify(up)}`)
  await zaloFetch(`${API}/v3.0/oa/message/cs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: token },
    body: JSON.stringify({
      recipient: { user_id: userId },
      message: { attachment: { type: "template", payload: { template_type: "media", elements: [{ media_type, attachment_id }] } } },
    }),
  })
}

/** Tên hiển thị và SĐT của khách. SĐT chỉ có khi khách đã chia sẻ thông tin với OA (Zalo trả 0 nếu chưa). */
export async function userDetail(userId: string): Promise<{ name?: string; phone?: string }> {
  const q = encodeURIComponent(JSON.stringify({ user_id: userId }))
  const data = await zaloFetch(`${API}/v3.0/oa/user/detail?data=${q}`, { headers: { access_token: await accessToken() } })
  const phone = data.data?.shared_info?.phone
  return { name: data.data?.display_name, phone: phone ? String(phone) : undefined }
}

/** Gửi tin "Yêu cầu chia sẻ thông tin": khách bấm "Chia sẻ" là Zalo gửi SĐT về qua webhook user_submit_info. */
export async function requestUserInfo(userId: string) {
  await zaloFetch(`${API}/v3.0/oa/message/cs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: await accessToken() },
    body: JSON.stringify({
      recipient: { user_id: userId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "request_user_info",
            elements: [{
              title: "Chia sẻ số điện thoại với NewPost Global",
              subtitle: "Bấm Chia sẻ để nhân viên gọi lại xác nhận đơn và tư vấn cho anh/chị, không cần gõ số.",
              image_url: `${env.PUBLIC_URL}/chia-se-sdt.png`,
            }],
          },
        },
      },
    }),
  })
}
