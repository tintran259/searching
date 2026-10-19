/**
 * Ngôn ngữ dùng để tìm thêm: từ khoá tiếng Việt được dịch / phiên âm sang từng ngôn ngữ rồi tìm riêng.
 * - `country` / `hl`: tham số quốc gia (gl) và ngôn ngữ giao diện (hl) của Google khi tìm "Ngoài nước".
 *   Khi tìm "Trong nước" vẫn dùng gl=vn để ưu tiên bản tiếng nước ngoài của báo Việt Nam.
 * - `englishName`: tên gửi cho bộ dịch.
 */
/** Công cụ tìm kiếm phổ biến ở nước đó, tìm thêm qua SerpApi khi phạm vi là "Ngoài nước" */
export type LocalEngine = 'baidu' | 'yandex' | 'naver';

export const LOCAL_ENGINES: Record<LocalEngine, { name: string; dateFilter: boolean }> = {
  // Baidu lọc được theo khoảng thời gian (gpc); Naver lọc được theo khoảng ngày (period), tìm mục Tin tức
  baidu: { name: 'Baidu', dateFilter: true },
  naver: { name: 'Naver', dateFilter: true },
  // Yandex chỉ lọc được ngày/2 tuần/tháng gần nhất → tìm trên cả khoảng ngày, bài ngoài khoảng bị loại theo ngày đăng
  yandex: { name: 'Yandex', dateFilter: false },
};

export interface SearchLanguage {
  code: string;
  name: string;
  englishName: string;
  country: string;
  hl: string;
  region: 'sea' | 'asia' | 'europe';
  localEngine?: LocalEngine;
}

/**
 * Thứ tự cũng là thứ tự ưu tiên: khi nhiều ngôn ngữ cho cùng một cách viết (vd tên không dấu
 * "Tran Van A" ở tiếng Anh, Đức, Indonesia…), truy vấn chỉ chạy một lần với ngôn ngữ đứng trước.
 */
export const SEARCH_LANGUAGES: SearchLanguage[] = [
  { code: 'en', name: 'Tiếng Anh', englishName: 'English', country: 'us', hl: 'en', region: 'europe' },
  { code: 'de', name: 'Tiếng Đức', englishName: 'German', country: 'de', hl: 'de', region: 'europe' },
  { code: 'fr', name: 'Tiếng Pháp', englishName: 'French', country: 'fr', hl: 'fr', region: 'europe' },
  { code: 'ru', name: 'Tiếng Nga', englishName: 'Russian', country: 'ru', hl: 'ru', region: 'europe', localEngine: 'yandex' },
  { code: 'zh-CN', name: 'Tiếng Trung (giản thể)', englishName: 'Chinese (Simplified)', country: 'cn', hl: 'zh-cn', region: 'asia', localEngine: 'baidu' },
  { code: 'zh-TW', name: 'Tiếng Trung (phồn thể)', englishName: 'Chinese (Traditional)', country: 'tw', hl: 'zh-tw', region: 'asia' },
  { code: 'ja', name: 'Tiếng Nhật', englishName: 'Japanese', country: 'jp', hl: 'ja', region: 'asia' },
  { code: 'ko', name: 'Tiếng Hàn', englishName: 'Korean', country: 'kr', hl: 'ko', region: 'asia', localEngine: 'naver' },
  { code: 'th', name: 'Tiếng Thái', englishName: 'Thai', country: 'th', hl: 'th', region: 'sea' },
  { code: 'lo', name: 'Tiếng Lào', englishName: 'Lao', country: 'la', hl: 'lo', region: 'sea' },
  { code: 'km', name: 'Tiếng Khmer', englishName: 'Khmer', country: 'kh', hl: 'km', region: 'sea' },
  { code: 'my', name: 'Tiếng Myanmar', englishName: 'Burmese', country: 'mm', hl: 'my', region: 'sea' },
  { code: 'id', name: 'Tiếng Indonesia', englishName: 'Indonesian', country: 'id', hl: 'id', region: 'sea' },
  { code: 'ms', name: 'Tiếng Mã Lai', englishName: 'Malay', country: 'my', hl: 'ms', region: 'sea' },
  { code: 'tl', name: 'Tiếng Philippines', englishName: 'Filipino (Tagalog)', country: 'ph', hl: 'tl', region: 'sea' },
];

/** Chọn sẵn trên giao diện: Anh, Đức, Nga, Trung Quốc và các nước Đông Nam Á */
export const DEFAULT_LANGUAGE_CODES = ['en', 'de', 'ru', 'zh-CN', 'th', 'lo', 'km', 'my', 'id', 'ms', 'tl'];

export const LANGUAGE_REGIONS: { id: SearchLanguage['region']; label: string }[] = [
  { id: 'sea', label: 'Đông Nam Á' },
  { id: 'asia', label: 'Châu Á' },
  { id: 'europe', label: 'Âu – Mỹ' },
];
