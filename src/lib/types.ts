import type { SearchEngine } from './search/types';

/**
 * Kiểu dữ liệu dùng chung giữa server (pipeline, API) và client (UI, xuất file).
 * File này không được import module Node.
 */

export type Region = 'domestic' | 'foreign';

/** Nguồn của ngày đăng, theo thứ tự ưu tiên giảm dần */
export type DateSource = 'meta' | 'jsonld' | 'time' | 'url' | 'wayback' | 'snippet';

export interface ExtractedDate {
  /** Ngày đăng theo lịch nơi đăng: YYYY-MM-DD */
  date: string;
  /** Mốc thời gian (ms) dùng để sắp xếp. Nguồn không ghi múi giờ thì coi là GMT+7. */
  timestamp: number;
  source: DateSource;
  /** Giá trị gốc đọc được, để đối chiếu */
  raw: string;
  /** true nếu chỉ là ngày ước lượng (Wayback, snippet của search engine) */
  estimated: boolean;
}

export interface SearchParams {
  query: string;
  region: Region;
  /** Khoảng ngày đăng cần tìm, YYYY-MM-DD */
  fromDate: string;
  toDate: string;
  /** Số trang kết quả (10 kết quả/trang) lấy cho MỖI nguồn: tiếng Việt, từng ngôn ngữ dịch, từng công cụ địa phương */
  pagesPerSource: number;
  /** Mã ngôn ngữ cần dịch từ khoá sang để tìm thêm (xem src/config/languages.ts) */
  languages: string[];
  /** Phạm vi Ngoài nước: tìm thêm bản dịch trên công cụ phổ biến ở nước đó (Baidu, Yandex, Naver) */
  localEngines: boolean;
  /** Số lượt SerpApi tối đa cho cả lượt tìm (lượt lấy từ bộ nhớ đệm không tính). Mặc định SEARCH_LIMITS.defaultBudget */
  budget?: number;
  /** Cụm từ loại trừ: bài có cụm này trong nội dung bị loại; truy vấn gửi kèm -"cụm" */
  exclude?: string[];
  /**
   * Phạm vi Ngoài nước: labeled (mặc định) nhận mọi domain có đủ nội dung, ghi quốc gia nếu xác định được;
   * verified chỉ nhận báo có bằng chứng quốc gia (danh sách báo, tên miền quốc gia, domain được cho phép)
   */
  sourcePolicy?: SourcePolicy;
  /** Loại bài đăng lại / dịch lại từ báo Việt Nam khi có bằng chứng (mặc định có) */
  excludeRepublished?: boolean;
  /** Domain luôn coi là nguồn hợp lệ (bỏ qua bước xác minh quốc gia) */
  allowDomains?: string[];
  /** Domain luôn loại */
  denyDomains?: string[];
  /**
   * Cách gọi khác người dùng chọn từ gợi ý cho từng từ khoá chính (vd "Tô Lâm" → "Chủ tịch nước Việt Nam").
   * Bài có cách gọi này thay cho từ khoá vẫn được nhận, ghi rõ "khớp theo gợi ý".
   */
  expansions?: TermExpansion[];
}

export interface TermExpansion {
  /** Từ khoá chính như người dùng nhập */
  term: string;
  alternatives: string[];
}

/** Một gợi ý cách gọi khác cho từ khoá chính */
export interface KeywordSuggestion {
  text: string;
  /** role: chức vụ; alias: tên khác; related: liên quan (vd thủ đô của một nước) */
  kind: 'role' | 'alias' | 'related';
  /** Ghi chú hiển thị, vd "từ 08/2024", "đã thôi giữ từ 05/2024", "Thủ đô" */
  note: string | null;
  /** false: chức vụ không trùng khoảng ngày đang tìm (đã thôi giữ / chưa nhận) — mặc định không nên chọn */
  current: boolean;
}

export interface TermSuggestions {
  term: string;
  /** Thực thể Wikidata đã nhận diện (để người dùng biết gợi ý cho ai / cái gì) */
  entity: { id: string; label: string; description: string | null; url: string } | null;
  suggestions: KeywordSuggestion[];
}

export type SourcePolicy = 'verified' | 'labeled';

/** Kết quả tìm từ khung tìm kiếm web hay mục Tin tức (Google News: tbm=nws) */
export type SearchVertical = 'web' | 'news';

/** Mã ngôn ngữ của nhóm truy vấn gốc */
export const SOURCE_LANGUAGE = 'vi';

/** Một từ khoá bắt buộc: trang phải chứa nguyên văn một trong các biến thể */
export interface QueryTerm {
  /** Như người dùng nhập; nhóm OR viết "Bỉ | Brussels" */
  text: string;
  /** Cụm gốc (mỗi lựa chọn của nhóm OR), kèm bản không dấu / đảo thứ tự khi tìm Ngoài nước */
  variants: string[];
  /** Các biến thể đến từ gợi ý người dùng chọn (chức danh, tên khác) — cũng nằm trong `variants` */
  expansions?: string[];
}

export interface QueryGroup {
  /** "vi" cho từ khoá gốc, còn lại là ngôn ngữ dịch */
  language: string;
  /** Từ khoá bắt buộc — trang phải chứa đủ tất cả */
  terms: QueryTerm[];
  /** Từ phụ (không bắt buộc) theo ngôn ngữ của nhóm */
  optional: string[];
  /** Chuỗi truy vấn gửi lên search engine */
  searchQuery: string;
  /** Cách diễn đạt khác của phần từ phụ (bản dịch thứ 2, 3…), dùng cho truy vấn bổ sung khi thiếu kết quả */
  altOptional?: string[];
}

export interface QueryPlan {
  /** Chuỗi tìm kiếm đã chuẩn hoá (phần bắt buộc nằm trong ngoặc kép nếu có đánh dấu) */
  phrase: string;
  /** groups[0] luôn là nhóm tiếng Việt; trang hợp lệ khi khớp đủ từ khoá của ít nhất một nhóm */
  groups: QueryGroup[];
}

export interface HighlightRange {
  start: number;
  end: number;
  kind: 'required' | 'optional';
}

/** Thông tin SEO của bài, đọc từ thẻ meta / Open Graph / JSON-LD của trang */
export interface ArticleSeo {
  /** Thẻ <title> */
  title: string;
  ogTitle: string | null;
  /** meta description */
  description: string | null;
  ogDescription: string | null;
  /** Ảnh đại diện (og:image / twitter:image / JSON-LD image), URL tuyệt đối */
  image: string | null;
  author: string | null;
  /** Chuyên mục (article:section / articleSection) */
  section: string | null;
  keywords: string[];
  canonical: string | null;
  /** Ngôn ngữ trang (thuộc tính lang / og:locale) */
  language: string | null;
  publisher: string | null;
  /** Ngày cập nhật, YYYY-MM-DD */
  modified: string | null;
  /** meta robots (vd "noindex") */
  robots: string | null;
  /** Số từ của nội dung chính */
  wordCount: number;
}

/**
 * Trạng thái của một từ khoá bắt buộc:
 *  - matched_exact: có nguyên văn từ khoá / một lựa chọn của nhóm OR (kể cả bản không dấu), hoặc bản dịch chính;
 *  - matched_alias: có cách viết khác (đảo thứ tự tên, bản dịch phụ);
 *  - matched_expansion: không có từ khoá nhưng có cách gọi khác người dùng chọn từ gợi ý (vd chức danh);
 *  - not_matched: không có;
 *  - unverified: chỉ thấy trong tiêu đề / đoạn trích của Google, chưa kiểm tra được nội dung trang.
 */
export type ConditionStatus = 'matched_exact' | 'matched_alias' | 'matched_expansion' | 'not_matched' | 'unverified';

/** Vị trí tìm thấy từ khoá */
export type EvidenceLocation = 'title' | 'description' | 'main' | 'snippet';

export interface ConditionCheck {
  /** Từ khoá như người dùng nhập */
  term: string;
  status: ConditionStatus;
  /** Biến thể đã khớp */
  variant: string | null;
  where: EvidenceLocation | null;
}

/** verified: đã đọc nội dung trang; unverified: chỉ dựa trên tiêu đề + đoạn trích của Google */
export type Verification = 'verified' | 'unverified';

/** Hồ sơ nguồn: dựa trên bằng chứng của chính trang, không dựa trên tham số gl / hl / lr đã gửi cho Google */
export interface PublisherProfile {
  /** Mã quốc gia ISO (vd "vn", "us") nếu xác định được */
  country: string | null;
  /** Có bằng chứng nguồn đúng phạm vi (báo trong danh sách, tên miền quốc gia, domain được cho phép) */
  verified: boolean;
  /** Ngôn ngữ bài (mã ngôn ngữ của thẻ lang / og:locale), null nếu không rõ */
  language: string | null;
  kind: 'news' | 'social';
  /** original: không thấy dấu hiệu đăng lại; republished: có bằng chứng đăng lại / dịch lại từ báo Việt Nam */
  origin: 'original' | 'republished' | 'unknown';
  /** Các tín hiệu đã dùng, để người dùng đối chiếu */
  signals: string[];
}

export interface ArticleResult {
  /** Khoá URL đã chuẩn hoá (dùng để gộp trùng) */
  id: string;
  url: string;
  title: string;
  domain: string;
  sourceName: string | null;
  region: Region;
  date: ExtractedDate | null;
  /** Đoạn trích ~200 ký tự quanh vị trí khớp */
  snippet: string;
  /** Các vùng cần tô sáng trong snippet: từ khoá bắt buộc và từ phụ */
  highlights: HighlightRange[];
  /** Các biến thể đã khớp, nối bằng " + " khi có nhiều từ khoá bắt buộc */
  matchedVariant: string;
  /** Ngôn ngữ của nhóm từ khoá đã khớp ("vi" hoặc mã ngôn ngữ dịch) */
  matchedLanguage: string;
  /** true khi tìm liên quan (không đánh dấu từ khoá bắt buộc): bài chỉ cần có đủ tỉ lệ từ đã nhập */
  loose: boolean;
  /** Từ phụ có trong bài / tổng số từ phụ (null nếu không có từ phụ) */
  optionalMatch: { found: string[]; total: number } | null;
  /** Nguồn đã tìm ra bài: ngôn ngữ của truy vấn và công cụ tìm kiếm */
  foundLanguage: string;
  foundVia: SearchEngine;
  /** Chi tiết SEO của bài (null nếu không đọc được) */
  seo: ArticleSeo | null;
  verification: Verification;
  /** Trạng thái từng từ khoá bắt buộc (rỗng khi tìm liên quan) */
  conditions: ConditionCheck[];
  publisher: PublisherProfile;
  /** Các nguồn tìm kiếm đã tìm ra bài, vd "Tiếng Anh · Google", "Tiếng Anh · Google News" */
  foundBy: string[];
}

export type RejectReason =
  | 'region'
  | 'non_article'
  | 'robots'
  | 'fetch_error'
  | 'no_match'
  | 'outside_main'
  | 'out_of_range'
  | 'no_date'
  | 'excluded'
  | 'denied_domain'
  | 'source_unverified'
  | 'republished';

export interface RejectedItem {
  id: string;
  url: string;
  title: string;
  domain: string;
  reason: RejectReason;
  detail: string;
  /** Nguồn đã tìm ra bài */
  foundLanguage: string;
  foundVia: SearchEngine;
}

/**
 * Báo cáo của một nguồn tìm kiếm (một ngôn ngữ trên một công cụ): yêu cầu bao nhiêu kết quả,
 * công cụ trả về bao nhiêu, bao nhiêu bài hợp lệ / bị loại / trùng.
 */
export interface SourceReport {
  /** `${language}:${engine}`, kèm `:news` / `:alt1`… cho truy vấn bổ sung */
  id: string;
  language: string;
  engine: SearchEngine;
  vertical: SearchVertical;
  /** 1: truy vấn chính; 2: truy vấn bổ sung, chỉ chạy khi ngôn ngữ đó còn thiếu kết quả và còn ngân sách */
  tier: 1 | 2;
  /** Truy vấn đã gửi (rỗng nếu không tìm) */
  query: string;
  /** Số kết quả tối đa cần lấy */
  requested: number;
  /** Số kết quả công cụ trả về */
  returned: number;
  /** true: công cụ báo không còn kết quả nào khác (dừng trước khi đủ số yêu cầu) */
  exhausted: boolean;
  accepted: number;
  rejected: number;
  /** Trùng với bài đã có (từ nguồn khác hoặc cùng nguồn) */
  duplicates: number;
  status: 'waiting' | 'searching' | 'done' | 'failed' | 'untranslated' | 'stopped' | 'skipped';
  error?: string;
}

export interface ProgressState {
  /** translating: đang dịch từ khoá; searching: đang tìm lần lượt từng nguồn; verifying: chỉ còn kiểm tra bài */
  phase: 'translating' | 'searching' | 'verifying' | 'done';
  /** Ngôn ngữ của nguồn đang tìm */
  language: string | null;
  /** Công cụ tìm kiếm đang chạy */
  engine: SearchEngine | null;
  /** Trang kết quả đang tìm, đếm từ 1 */
  page: number | null;
  pagesPerSource: number;
  /** Số nguồn đã tìm xong / tổng số nguồn */
  sourcesDone: number;
  totalSources: number;
  /** Báo cáo từng nguồn, theo thứ tự tìm */
  sources: SourceReport[];
  searchCalls: number;
  cachedCalls: number;
  /** Số URL khác nhau tìm được */
  candidates: number;
  /** Số bài đã xác minh xong / số bài cần xác minh */
  verified: number;
  toVerify: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  metrics: SearchMetrics;
}

/** Số đo của một lượt tìm: chi phí SerpApi, tỉ lệ từng bước, thời gian */
export interface SearchMetrics {
  /** Số lượt SerpApi tối đa đã chọn */
  budget: number;
  /** Số truy vấn đã lập / bỏ vì trùng / chạy thật */
  queriesPlanned: number;
  queriesDeduped: number;
  retries: number;
  searchErrors: number;
  /** Số trang tải được / tải lỗi */
  fetchOk: number;
  fetchFailed: number;
  /** Số bài có đủ từ khoá (kể cả chưa xác minh) */
  keywordPassed: number;
  /** Số bài chưa xác minh (chỉ có tiêu đề + đoạn trích) */
  unverified: number;
  /** Số bài có nguồn đã xác minh */
  sourceVerified: number;
  /** Thời gian từng bước (ms) */
  translateMs: number;
  searchMs: number;
  verifyMs: number;
}

export type PipelineEvent =
  | { type: 'start'; plan: QueryPlan; params: SearchParams }
  | { type: 'progress'; progress: ProgressState }
  | { type: 'result'; item: ArticleResult }
  | { type: 'rejected'; item: RejectedItem }
  | { type: 'warning'; message: string }
  | { type: 'done'; progress: ProgressState; durationMs: number; aborted: boolean };
