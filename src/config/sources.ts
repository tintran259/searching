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
  /** Mã quốc gia ISO của nhà xuất bản (chỉ dùng cho FOREIGN_SOURCES) */
  country?: string;
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

/**
 * Báo / hãng tin lớn nước ngoài: bằng chứng chắc chắn nhất rằng nguồn là báo nước ngoài.
 * Tên miền quốc gia (.de, .co.uk, .jp…) cũng là bằng chứng (xem COUNTRY_TLDS); các trang .com / .org / .net
 * không có trong danh sách này thì chưa xác minh được quốc gia → thêm vào đây nếu cần.
 */
export const FOREIGN_SOURCES: SourceEntry[] = [
  // Hãng tin quốc tế
  { match: 'reuters.com', name: 'Reuters', country: 'gb' },
  { match: 'apnews.com', name: 'AP News', country: 'us' },
  { match: 'afp.com', name: 'AFP', country: 'fr' },
  { match: 'bloomberg.com', name: 'Bloomberg', country: 'us' },
  // Mỹ
  { match: 'nytimes.com', name: 'The New York Times', country: 'us' },
  { match: 'washingtonpost.com', name: 'The Washington Post', country: 'us' },
  { match: 'wsj.com', name: 'The Wall Street Journal', country: 'us' },
  { match: 'cnn.com', name: 'CNN', country: 'us' },
  { match: 'cnbc.com', name: 'CNBC', country: 'us' },
  { match: 'foxnews.com', name: 'Fox News', country: 'us' },
  { match: 'nbcnews.com', name: 'NBC News', country: 'us' },
  { match: 'abcnews.go.com', name: 'ABC News', country: 'us' },
  { match: 'cbsnews.com', name: 'CBS News', country: 'us' },
  { match: 'npr.org', name: 'NPR', country: 'us' },
  { match: 'politico.com', name: 'Politico', country: 'us' },
  { match: 'foreignpolicy.com', name: 'Foreign Policy', country: 'us' },
  { match: 'time.com', name: 'TIME', country: 'us' },
  { match: 'forbes.com', name: 'Forbes', country: 'us' },
  { match: 'thediplomat.com', name: 'The Diplomat', country: 'us' },
  { match: 'voanews.com', name: 'VOA', country: 'us' },
  { match: 'rfa.org', name: 'RFA', country: 'us' },
  // Anh
  { match: 'bbc.com', name: 'BBC', country: 'gb' },
  { match: 'bbc.co.uk', name: 'BBC', country: 'gb' },
  { match: 'theguardian.com', name: 'The Guardian', country: 'gb' },
  { match: 'ft.com', name: 'Financial Times', country: 'gb' },
  { match: 'economist.com', name: 'The Economist', country: 'gb' },
  { match: 'independent.co.uk', name: 'The Independent', country: 'gb' },
  // Pháp
  { match: 'lemonde.fr', name: 'Le Monde', country: 'fr' },
  { match: 'lefigaro.fr', name: 'Le Figaro', country: 'fr' },
  { match: 'france24.com', name: 'France 24', country: 'fr' },
  { match: 'rfi.fr', name: 'RFI', country: 'fr' },
  // Đức
  { match: 'dw.com', name: 'DW', country: 'de' },
  { match: 'spiegel.de', name: 'Der Spiegel', country: 'de' },
  { match: 'faz.net', name: 'FAZ', country: 'de' },
  { match: 'zeit.de', name: 'Die Zeit', country: 'de' },
  { match: 'sueddeutsche.de', name: 'Süddeutsche Zeitung', country: 'de' },
  // Châu Âu khác
  { match: 'euronews.com', name: 'Euronews', country: 'fr' },
  { match: 'politico.eu', name: 'Politico Europe', country: 'be' },
  { match: 'euractiv.com', name: 'Euractiv', country: 'be' },
  { match: 'brusselstimes.com', name: 'The Brussels Times', country: 'be' },
  // Nga
  { match: 'tass.ru', name: 'TASS', country: 'ru' },
  { match: 'tass.com', name: 'TASS', country: 'ru' },
  { match: 'ria.ru', name: 'RIA Novosti', country: 'ru' },
  { match: 'interfax.ru', name: 'Interfax', country: 'ru' },
  { match: 'rt.com', name: 'RT', country: 'ru' },
  // Trung Quốc, Hồng Kông, Đài Loan
  { match: 'xinhuanet.com', name: 'Tân Hoa Xã', country: 'cn' },
  { match: 'news.cn', name: 'Tân Hoa Xã', country: 'cn' },
  { match: 'people.com.cn', name: 'Nhân dân Nhật báo', country: 'cn' },
  { match: 'chinadaily.com.cn', name: 'China Daily', country: 'cn' },
  { match: 'globaltimes.cn', name: 'Global Times', country: 'cn' },
  { match: 'cgtn.com', name: 'CGTN', country: 'cn' },
  { match: 'scmp.com', name: 'South China Morning Post', country: 'hk' },
  { match: 'focustaiwan.tw', name: 'Focus Taiwan (CNA)', country: 'tw' },
  { match: 'taipeitimes.com', name: 'Taipei Times', country: 'tw' },
  // Nhật, Hàn
  { match: 'nhk.or.jp', name: 'NHK', country: 'jp' },
  { match: 'asia.nikkei.com', name: 'Nikkei Asia', country: 'jp' },
  { match: 'nikkei.com', name: 'Nikkei', country: 'jp' },
  { match: 'japantimes.co.jp', name: 'The Japan Times', country: 'jp' },
  { match: 'kyodonews.net', name: 'Kyodo News', country: 'jp' },
  { match: 'yna.co.kr', name: 'Yonhap', country: 'kr' },
  { match: 'koreaherald.com', name: 'The Korea Herald', country: 'kr' },
  { match: 'koreatimes.co.kr', name: 'The Korea Times', country: 'kr' },
  // Đông Nam Á, Úc, Ấn Độ, Trung Đông
  { match: 'straitstimes.com', name: 'The Straits Times', country: 'sg' },
  { match: 'channelnewsasia.com', name: 'CNA', country: 'sg' },
  { match: 'bangkokpost.com', name: 'Bangkok Post', country: 'th' },
  { match: 'nationthailand.com', name: 'The Nation Thailand', country: 'th' },
  { match: 'thejakartapost.com', name: 'The Jakarta Post', country: 'id' },
  { match: 'kompas.com', name: 'Kompas', country: 'id' },
  { match: 'antaranews.com', name: 'Antara', country: 'id' },
  { match: 'thestar.com.my', name: 'The Star', country: 'my' },
  { match: 'bernama.com', name: 'Bernama', country: 'my' },
  { match: 'inquirer.net', name: 'Philippine Daily Inquirer', country: 'ph' },
  { match: 'khmertimeskh.com', name: 'Khmer Times', country: 'kh' },
  { match: 'abc.net.au', name: 'ABC Australia', country: 'au' },
  { match: 'sbs.com.au', name: 'SBS', country: 'au' },
  { match: 'thehindu.com', name: 'The Hindu', country: 'in' },
  { match: 'aljazeera.com', name: 'Al Jazeera', country: 'qa' },
];

/**
 * Đuôi tên miền quốc gia → mã quốc gia của nhà xuất bản. Không có các đuôi hay được dùng như tên miền
 * chung (.co, .io, .me, .tv, .ai…), vì không cho biết quốc gia.
 */
export const COUNTRY_TLDS: Record<string, string> = {
  uk: 'gb', de: 'de', fr: 'fr', be: 'be', nl: 'nl', it: 'it', es: 'es', pt: 'pt', ch: 'ch', at: 'at', pl: 'pl',
  se: 'se', no: 'no', dk: 'dk', fi: 'fi', cz: 'cz', ru: 'ru', ua: 'ua', cn: 'cn', hk: 'hk', tw: 'tw', jp: 'jp',
  kr: 'kr', sg: 'sg', th: 'th', id: 'id', my: 'my', ph: 'ph', la: 'la', kh: 'kh', mm: 'mm', au: 'au', nz: 'nz',
  in: 'in', ca: 'ca', us: 'us', br: 'br', mx: 'mx', ar: 'ar', za: 'za', il: 'il', tr: 'tr', ae: 'ae', sa: 'sa',
};

/**
 * Mạng xã hội / nền tảng video. Thường không tải được trang (bắt đăng nhập, chặn bot) nên bài đăng được
 * xác minh bằng tiêu đề + đoạn trích Google trả về: phải có đủ mọi từ khoá chính mới được nhận.
 * Phạm vi xét theo ngôn ngữ bài đăng: viết tiếng Việt là "Trong nước", ngôn ngữ khác là "Ngoài nước".
 */
export const SOCIAL_PLATFORMS: SourceEntry[] = [
  { match: 'facebook.com', name: 'Facebook' },
  { match: 'fb.com', name: 'Facebook' },
  { match: 'fb.watch', name: 'Facebook' },
  { match: 'instagram.com', name: 'Instagram' },
  { match: 'threads.net', name: 'Threads' },
  { match: 'threads.com', name: 'Threads' },
  { match: 'tiktok.com', name: 'TikTok' },
  { match: 'youtube.com', name: 'YouTube' },
  { match: 'youtu.be', name: 'YouTube' },
  { match: 'twitter.com', name: 'X (Twitter)' },
  { match: 'x.com', name: 'X (Twitter)' },
  { match: 'linkedin.com', name: 'LinkedIn' },
  { match: 'pinterest.com', name: 'Pinterest' },
  { match: 'zalo.me', name: 'Zalo' },
];
