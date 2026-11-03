// Vùng khách ở và bưu cục (chi nhánh) khách chọn gửi hàng. Công ty có 2 chi nhánh: miền Bắc (Hà Nội) và miền Nam (TP.HCM);
// thống kê và thông báo nhân viên chia theo bưu cục. Bot chỉ hỏi (tin có nút bấm) khi cần chuyển khách cho nhân viên,
// lúc tư vấn bình thường thì không hỏi để tập trung vào câu hỏi của khách.

export const REGIONS = { bac: "Miền Bắc", trung: "Miền Trung", nam: "Miền Nam" } as const
export const BRANCHES = { bac: "Bưu cục miền Bắc (Hà Nội)", nam: "Bưu cục miền Nam (TP.HCM)" } as const
export type Region = keyof typeof REGIONS
export type Branch = keyof typeof BRANCHES

export const REGION_QUESTION = "Dạ để em chuyển đúng nhân viên bưu cục gần anh/chị nhất, anh/chị đang ở khu vực nào ạ?"
export const BRANCH_QUESTION = "Dạ anh/chị muốn làm việc với bưu cục nào của NewPost ạ?"
/** Địa chỉ và nhân viên chăm sóc khách hàng của từng bưu cục (đổi người / địa chỉ thì sửa ở đây). */
export const BRANCH_INFO: Record<Branch, { address: string; staff: string; phone: string }> = {
  bac: { address: "Số 2, ngõ 111, Phố Thiên Hiền, Phường Từ Liêm, Hà Nội", staff: "chị Huyền", phone: "0978 835 005" },
  nam: { address: "86/41 Trần Thái Tông, Phường Tân Sơn, TP. Hồ Chí Minh", staff: "chị Bình", phone: "0376 891 937" },
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** Khách đã chọn bưu cục khi được chuyển nhân viên: báo nhân viên phụ trách, kèm SĐT và địa chỉ bưu cục. */
export const branchConfirm = (b: Branch) =>
  `Dạ em đã chuyển yêu cầu của anh/chị tới nhân viên chăm sóc khách hàng ${BRANCHES[b]} ạ.
- Nhân viên phụ trách: ${BRANCH_INFO[b].staff} – ${BRANCH_INFO[b].phone} (gọi điện hoặc nhắn Zalo)
- Địa chỉ bưu cục: ${BRANCH_INFO[b].address}
${cap(BRANCH_INFO[b].staff)} sẽ liên hệ anh/chị sớm nhất ạ. Anh/chị cần gấp có thể gọi trực tiếp số trên giúp em nhé.`

/** Khách chốt đơn rồi chọn bưu cục: báo đã gửi đơn cho nhân viên bưu cục đó, kèm SĐT và địa chỉ. */
export const orderConfirm = (b: Branch) =>
  `Dạ em đã gửi thông tin đơn của anh/chị tới nhân viên ${BRANCHES[b]} ạ.
- Nhân viên phụ trách: ${BRANCH_INFO[b].staff} – ${BRANCH_INFO[b].phone} (gọi điện hoặc nhắn Zalo)
- Địa chỉ bưu cục: ${BRANCH_INFO[b].address}
${cap(BRANCH_INFO[b].staff)} sẽ gọi xác nhận và hẹn lấy hàng với anh/chị sớm nhất ạ.`

/** Khách chọn bưu cục ngoài lúc chuyển nhân viên / chốt đơn: chỉ ghi nhận, gửi SĐT và địa chỉ. */
export const branchInfo = (b: Branch) =>
  `Dạ em ghi nhận anh/chị làm việc với ${BRANCHES[b]} ạ.
- Nhân viên chăm sóc khách hàng: ${BRANCH_INFO[b].staff} – ${BRANCH_INFO[b].phone} (gọi điện hoặc nhắn Zalo)
- Địa chỉ bưu cục: ${BRANCH_INFO[b].address}`

/** Khách đổi sang bưu cục khác: nói rõ đã đổi, gửi SĐT và địa chỉ bưu cục mới. */
export const branchChanged = (from: Branch, to: Branch) =>
  `Dạ em đã đổi từ ${BRANCHES[from]} sang ${BRANCHES[to]} cho anh/chị ạ.
- Nhân viên phụ trách: ${BRANCH_INFO[to].staff} – ${BRANCH_INFO[to].phone} (gọi điện hoặc nhắn Zalo)
- Địa chỉ bưu cục: ${BRANCH_INFO[to].address}
Thông tin của anh/chị đã được chuyển cho ${BRANCH_INFO[to].staff} ạ.`

/** Khách đã có bưu cục khi được chuyển nhân viên: tin kèm theo câu chuyển nhân viên. */
export const branchContact = (b: Branch) =>
  `Anh/chị cần gấp có thể liên hệ trực tiếp ${BRANCH_INFO[b].staff} – nhân viên ${BRANCHES[b]}: ${BRANCH_INFO[b].phone} (gọi điện hoặc nhắn Zalo) ạ.`

/** Khách vừa bấm chọn vùng: ghi nhận và hỏi luôn bưu cục trong cùng 1 tin. */
export const branchAfterRegion = (r: Region) => `Dạ em ghi nhận anh/chị ở ${REGIONS[r]} ạ. Anh/chị muốn làm việc với bưu cục nào của NewPost ạ?`

// Nút "oa.query.show": khách bấm thì Zalo gửi đúng chữ payload như một tin khách nhắn.
const regionText = (r: Region) => `Tôi ở ${REGIONS[r]}`
const branchText = (b: Branch) => `Tôi gửi hàng về ${BRANCHES[b]}`

export type Button = { title: string; payload: string }
export const regionButtons = (): Button[] => (Object.keys(REGIONS) as Region[]).map((r) => ({ title: REGIONS[r], payload: regionText(r) }))
export const branchButtons = (): Button[] => (Object.keys(BRANCHES) as Branch[]).map((b) => ({ title: BRANCHES[b], payload: branchText(b) }))

/** Tin khách là chữ của nút chọn vùng / bưu cục thì trả về lựa chọn đó. */
export function parseChoice(text: string): { region?: Region; branch?: Branch } {
  const t = text.trim().toLowerCase()
  const region = (Object.keys(REGIONS) as Region[]).find((r) => regionText(r).toLowerCase() === t)
  const branch = (Object.keys(BRANCHES) as Branch[]).find((b) => branchText(b).toLowerCase() === t)
  return { region, branch }
}

// Tỉnh/thành (tên trước và sau sáp nhập 2025, tên thành phố quen gọi) → vùng. Viết không dấu, so theo cả từ.
const PLACES: Record<Region, string[]> = {
  bac: ["mien bac", "ha noi", "hn", "hai phong", "quang ninh", "ha long", "bac ninh", "bac giang", "hai duong", "hung yen", "thai binh", "nam dinh",
    "ninh binh", "ha nam", "vinh phuc", "phu tho", "viet tri", "thai nguyen", "bac kan", "bac can", "cao bang", "lang son", "tuyen quang",
    "ha giang", "lao cai", "sa pa", "sapa", "yen bai", "lai chau", "dien bien", "son la", "hoa binh"],
  trung: ["mien trung", "thanh hoa", "nghe an", "vinh nghe an", "ha tinh", "quang binh", "dong hoi", "quang tri", "hue", "thua thien hue", "da nang",
    "quang nam", "hoi an", "tam ky", "quang ngai", "binh dinh", "quy nhon", "phu yen", "tuy hoa", "khanh hoa", "nha trang", "cam ranh",
    "ninh thuan", "phan rang", "binh thuan", "phan thiet", "kon tum", "gia lai", "pleiku", "dak lak", "dac lac", "buon ma thuot", "dak nong",
    "lam dong", "da lat", "bao loc"],
  nam: ["mien nam", "mien tay", "ho chi minh", "tp hcm", "tphcm", "hcm", "sai gon", "saigon", "thu duc", "binh duong", "thu dau mot", "di an", "dong nai",
    "bien hoa", "ba ria", "vung tau", "binh phuoc", "tay ninh",
    // Đồng bằng sông Cửu Long tính vào miền Nam.
    "can tho", "long an", "tan an", "tien giang", "my tho", "ben tre", "vinh long", "tra vinh", "dong thap", "cao lanh", "sa dec",
    "an giang", "long xuyen", "chau doc", "kien giang", "rach gia", "phu quoc", "hau giang", "vi thanh", "soc trang", "bac lieu", "ca mau"],
}

const plainText = (s: string) =>
  ` ${s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim()} `

/** Khách nhắc tới tỉnh/thành ở Việt Nam ("mình ở Nghệ An", "shop ở Sài Gòn") → vùng. Nhắc nhiều vùng khác nhau thì không đoán. */
export function regionFromText(text: string): Region | null {
  const t = plainText(text)
  const found = (Object.keys(PLACES) as Region[]).filter((r) => PLACES[r].some((p) => t.includes(` ${p} `)))
  return found.length === 1 ? found[0] : null
}

export const isRegion = (r: unknown): r is Region => typeof r === "string" && r in REGIONS
export const isBranch = (b: unknown): b is Branch => typeof b === "string" && b in BRANCHES
