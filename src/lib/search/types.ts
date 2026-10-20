/**
 * Giao diện nhà cung cấp kết quả tìm kiếm. Muốn đổi sang Serper/DataForSEO/Brave…
 * chỉ cần viết một lớp mới implement `SearchProvider` và đăng ký trong ./index.ts.
 */

export interface SearchLocale {
  /** Mã quốc gia ISO 3166-1 alpha-2, vd "vn" */
  country?: string;
  /** Mã ngôn ngữ giao diện, vd "vi" */
  language?: string;
  /** Chỉ lấy trang viết bằng ngôn ngữ này (mã trong src/config/languages.ts), nếu search engine hỗ trợ */
  onlyLanguage?: string;
}

/** Khoảng ngày đăng, dạng YYYY-MM-DD */
export interface DateRange {
  start: string;
  end: string;
}

/** Công cụ tìm kiếm: Google, hoặc công cụ phổ biến ở một số nước (xem src/config/languages.ts) */
export type SearchEngine = 'google' | 'baidu' | 'yandex' | 'naver';

export interface SearchRequest {
  /** Mặc định google */
  engine?: SearchEngine;
  /** Google: khung tìm kiếm web (mặc định) hay mục Tin tức (tbm=nws — không dùng được toán tử site:) */
  vertical?: 'web' | 'news';
  /** Truy vấn đầy đủ (đã có ngoặc kép, OR, -site:…) */
  query: string;
  /** Trang kết quả, đếm từ 0 */
  page: number;
  dateRange?: DateRange;
  locale?: SearchLocale;
  signal?: AbortSignal;
}

export interface SearchResultItem {
  url: string;
  title: string;
  snippet: string;
  /** Ngày search engine hiển thị cạnh kết quả (vd "12 thg 5, 2019"), nếu có */
  dateText: string | null;
  position: number;
  /** Mục Tin tức: tên báo do Google ghi (vd "VnExpress International") */
  sourceName?: string;
  /** Mục Tin tức: thời điểm đăng (ISO, UTC) do Google ghi */
  publishedAt?: string;
}

export interface SearchResponse {
  items: SearchResultItem[];
  hasMore: boolean;
  /** Thời điểm thực hiện tìm kiếm (ISO), dùng để hiểu ngày tương đối "3 ngày trước" */
  searchedAt: string;
  fromCache?: boolean;
}

export interface SearchProvider {
  readonly id: string;
  search(request: SearchRequest): Promise<SearchResponse>;
}

/** Lượt tìm còn lại của tài khoản (để giao diện cảnh báo trước khi hết quota) */
export interface SearchQuota {
  provider: string;
  plan: string | null;
  searchesLeft: number | null;
  searchesPerMonth: number | null;
}

export class SearchProviderError extends Error {
  /** fatal = lỗi không thể tiếp tục (sai API key, hết quota) */
  readonly fatal: boolean;

  constructor(message: string, fatal: boolean) {
    super(message);
    this.name = 'SearchProviderError';
    this.fatal = fatal;
  }
}
