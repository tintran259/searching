/**
 * Cấu hình nguồn báo để phân loại "Trong nước" / "Ngoài nước" (xem src/lib/region.ts).
 *
 * - `match` là domain (khớp luôn cả subdomain) và có thể kèm đường dẫn: "bbc.com/vietnamese".
 * - Domain đuôi .vn luôn là "Trong nước", trừ khi nằm trong FOREIGN_VIETNAMESE_SOURCES.
 * - Domain không đuôi .vn chỉ là "Trong nước" khi có trong DOMESTIC_SOURCES.
 * - `name` dùng để hiển thị cột "Báo".
 */
export interface SourceEntry {
  match: string;
  name: string;
}

/** Báo, trang tin Việt Nam. Các domain không đuôi .vn (vnexpress.net, baomoi.com…) bắt buộc phải có ở đây. */
export const DOMESTIC_SOURCES: SourceEntry[] = [
  { match: 'vnexpress.net', name: 'VnExpress' },
  { match: 'tuoitre.vn', name: 'Tuổi Trẻ' },
  { match: 'thanhnien.vn', name: 'Thanh Niên' },
  { match: 'dantri.com.vn', name: 'Dân trí' },
  { match: 'vietnamnet.vn', name: 'VietNamNet' },
  { match: 'tienphong.vn', name: 'Tiền Phong' },
  { match: 'laodong.vn', name: 'Lao Động' },
  { match: 'nld.com.vn', name: 'Người Lao Động' },
  { match: 'vtv.vn', name: 'VTV' },
  { match: 'baochinhphu.vn', name: 'Báo Chính phủ' },
  { match: 'cafef.vn', name: 'CafeF' },
  { match: 'zingnews.vn', name: 'Znews' },
  { match: 'znews.vn', name: 'Znews' },
  { match: 'vietnamplus.vn', name: 'VietnamPlus' },
  { match: 'nhandan.vn', name: 'Nhân Dân' },
  { match: 'qdnd.vn', name: 'Quân đội Nhân dân' },
  { match: 'cand.com.vn', name: 'Công an Nhân dân' },
  { match: 'vov.vn', name: 'VOV' },
  { match: 'sggp.org.vn', name: 'Sài Gòn Giải Phóng' },
  { match: 'plo.vn', name: 'Pháp Luật TP.HCM' },
  { match: 'hanoimoi.vn', name: 'Hà Nội Mới' },
  { match: 'vneconomy.vn', name: 'VnEconomy' },
  { match: 'thesaigontimes.vn', name: 'The Saigon Times' },
  { match: 'vietnamnews.vn', name: 'Việt Nam News' },
  { match: 'tuoitrenews.vn', name: 'Tuổi Trẻ News' },
  { match: 'kenh14.vn', name: 'Kenh14' },
  { match: 'soha.vn', name: 'Soha' },
  { match: 'genk.vn', name: 'GenK' },
  { match: 'cafebiz.vn', name: 'CafeBiz' },
  { match: '24h.com.vn', name: '24h' },
  // Báo / trang tin Việt Nam KHÔNG dùng đuôi .vn
  { match: 'baomoi.com', name: 'Báo Mới' },
  { match: 'ngoisao.net', name: 'Ngôi Sao' },
  { match: 'doisongphapluat.com', name: 'Đời sống & Pháp luật' },
  { match: 'vietgiaitri.com', name: 'Việt Giải Trí' },
];

/** Báo nước ngoài viết tiếng Việt → luôn xếp "Ngoài nước" (kể cả khi dùng đuôi .vn) */
export const FOREIGN_VIETNAMESE_SOURCES: SourceEntry[] = [
  { match: 'bbc.com/vietnamese', name: 'BBC News Tiếng Việt' },
  { match: 'bbc.co.uk/vietnamese', name: 'BBC News Tiếng Việt' },
  { match: 'voatiengviet.com', name: 'VOA Tiếng Việt' },
  { match: 'rfa.org/vietnamese', name: 'RFA Tiếng Việt' },
  { match: 'rfi.fr/vi', name: 'RFI Tiếng Việt' },
  { match: 'dw.com/vi', name: 'DW Tiếng Việt' },
  { match: 'sbs.com.au/language/vietnamese', name: 'SBS Tiếng Việt' },
  { match: 'nhk.or.jp/nhkworld/vi', name: 'NHK World Tiếng Việt' },
  { match: 'vietnamese.cri.cn', name: 'CRI Tiếng Việt' },
  { match: 'sputniknews.vn', name: 'Sputnik Việt Nam' },
  { match: 'nguoi-viet.com', name: 'Người Việt (Mỹ)' },
  { match: 'vietbao.com', name: 'Việt Báo (Mỹ)' },
  { match: 'saigonnhonews.com', name: 'Saigon Nhỏ (Mỹ)' },
];

/** Mạng xã hội / nền tảng video: không phải bài viết, bị loại ngay từ kết quả tìm kiếm */
export const NON_ARTICLE_DOMAINS: string[] = [
  'facebook.com',
  'fb.com',
  'fb.watch',
  'instagram.com',
  'threads.net',
  'threads.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'pinterest.com',
  'zalo.me',
];
