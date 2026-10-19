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
}

/** Mã ngôn ngữ của nhóm truy vấn gốc */
export const SOURCE_LANGUAGE = 'vi';

/** Một từ khoá bắt buộc: trang phải chứa nguyên văn một trong các biến thể */
export interface QueryTerm {
  text: string;
  /** Cụm gốc, kèm bản không dấu / đảo thứ tự khi tìm Ngoài nước */
  variants: string[];
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
}

export type RejectReason =
  | 'region'
  | 'non_article'
  | 'robots'
  | 'fetch_error'
  | 'no_match'
  | 'outside_main'
  | 'out_of_range'
  | 'no_date';

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
  /** `${language}:${engine}` */
  id: string;
  language: string;
  engine: SearchEngine;
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
  status: 'waiting' | 'searching' | 'done' | 'failed' | 'untranslated' | 'stopped';
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
}

export type PipelineEvent =
  | { type: 'start'; plan: QueryPlan; params: SearchParams }
  | { type: 'progress'; progress: ProgressState }
  | { type: 'result'; item: ArticleResult }
  | { type: 'rejected'; item: RejectedItem }
  | { type: 'warning'; message: string }
  | { type: 'done'; progress: ProgressState; durationMs: number; aborted: boolean };
