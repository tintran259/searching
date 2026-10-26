/**
 * SerpApi: https://serpapi.com/search-api
 *  - Google: giới hạn ngày bằng tbs=cdr:1,cd_min:M/D/YYYY,cd_max:M/D/YYYY; phân trang bằng `start` (10 kết quả/trang).
 *    Mục Tin tức (tbm=nws, https://serpapi.com/news-results): cùng tbs / start / lr (đã thử thực tế), kết quả ở
 *    `news_results` kèm `source` (tên báo) và `published_at`; KHÔNG dùng được toán tử site: (SerpApi báo lỗi).
 *  - Baidu (https://serpapi.com/baidu-search-api): ngày bằng gpc=stf=<unix>,<unix>|stftype=1; trang bằng `pn`.
 *  - Yandex (https://serpapi.com/yandex-search-api): không lọc được khoảng ngày tuỳ ý; trang bằng `p` (từ 0).
 *  - Naver (https://serpapi.com/naver-search-api): mục Tin tức (where=news), ngày bằng period=fromYYYYMMDDtoYYYYMMDD.
 */
import {
  SearchProviderError,
  type SearchProvider,
  type SearchQuota,
  type SearchRequest,
  type SearchResponse,
  type SearchEngine,
  type SearchResultItem,
} from './types';

const ENDPOINT = 'https://serpapi.com/search.json';
const PAGE_SIZE = 10;
const TIMEOUT_MS = 30_000;
/** Tên miền Google của từng quốc gia (theo https://serpapi.com/google-domains.json); thiếu thì dùng google.com */
const GOOGLE_DOMAINS: Record<string, string> = {
  vn: 'google.com.vn', de: 'google.de', fr: 'google.fr', ru: 'google.ru', cn: 'google.com.hk', tw: 'google.com.tw',
  jp: 'google.co.jp', kr: 'google.co.kr', th: 'google.co.th', la: 'google.la', kh: 'google.com.kh', mm: 'google.com.mm',
  id: 'google.co.id', my: 'google.com.my', ph: 'google.com.ph',
};

/**
 * Giá trị `lr` (chỉ lấy trang viết bằng ngôn ngữ đó) Google hỗ trợ, theo https://serpapi.com/google-lr-languages.json.
 * Lào, Khmer, Myanmar, Mã Lai không có trong danh sách nên không lọc (chữ viết riêng đã đủ phân biệt).
 */
const GOOGLE_LR: Record<string, string> = {
  vi: 'lang_vi', en: 'lang_en', de: 'lang_de', fr: 'lang_fr', ru: 'lang_ru', 'zh-CN': 'lang_zh-CN', 'zh-TW': 'lang_zh-TW',
  ja: 'lang_ja', ko: 'lang_ko', th: 'lang_th', id: 'lang_id', tl: 'lang_tl',
};

interface SerpApiOrganicResult {
  position?: number;
  title?: string;
  /** Thường là URL thật; với một số kết quả (hay gặp ở bài mạng xã hội) chỉ là "/goto?url=…" của Google */
  link?: string;
  /** Link chuyển hướng của Google (google.com/url?…) — dùng để tìm URL thật khi `link` không phải URL */
  redirect_link?: string;
  snippet?: string;
  date?: string;
}

interface SerpApiNaverNewsResult {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
  news_info?: { press_name?: string; news_date?: string; date?: string };
}

interface SerpApiGoogleNewsResult {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
  source?: string | { name?: string };
  published_at?: string;
}

interface SerpApiResponse {
  error?: string;
  organic_results?: SerpApiOrganicResult[];
  /** Naver (where=news) hoặc Google mục Tin tức (tbm=nws) — hai schema khác nhau */
  news_results?: (SerpApiNaverNewsResult & SerpApiGoogleNewsResult)[];
  serpapi_pagination?: { next?: string };
}

/** Khung giờ của Baidu (giờ Bắc Kinh) để đổi ngày thành Unix time */
const unixAt = (isoDate: string, time: string) => Math.floor(Date.parse(`${isoDate}T${time}+08:00`) / 1000);
const compactDate = (isoDate: string) => isoDate.replaceAll('-', '');

/** Link chuyển hướng của Baidu (baidu.com/link?url=…) — đổi ra URL thật để kiểm tra robots.txt và gộp trùng đúng trang */
const BAIDU_REDIRECT = /^https?:\/\/(?:www\.)?baidu\.com\/link\?/;

const isAbsoluteUrl = (s: string) => /^https?:\/\//i.test(s);
/** URL đích trong trang chuyển hướng của Google (không có header Location) */
const GOOGLE_REDIRECT_TARGET = /(?:URL=|href=")(https?:\/\/[^"'>\s]+)/i;

/** "2019-01-01" → "1/1/2019" (định dạng cd_min/cd_max của Google) */
export function toGoogleDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${m}/${d}/${y}`;
}

/** Ngày đứng đầu snippet dạng "12 thg 5, 2019 — Nội dung…" khi SerpApi không tách sẵn trường `date` */
function leadingDate(snippet: string | undefined): string | null {
  const m = snippet ? /^(.{4,30}?)\s[—–]\s/.exec(snippet) : null;
  return m && /\d/.test(m[1]) ? m[1] : null;
}

export class SerpApiProvider implements SearchProvider {
  readonly id = 'serpapi';
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  buildUrl(request: SearchRequest): string {
    const engine: SearchEngine = request.engine ?? 'google';
    const params = new URLSearchParams({ engine });
    const { start, end } = request.dateRange ?? {};
    switch (engine) {
      case 'baidu':
        params.set('q', request.query);
        params.set('pn', String(request.page * PAGE_SIZE));
        // Chỉ lấy trang tiếng Trung giản thể / phồn thể
        if (request.locale?.onlyLanguage === 'zh-CN') params.set('ct', '2');
        if (request.locale?.onlyLanguage === 'zh-TW') params.set('ct', '3');
        if (start && end) params.set('gpc', `stf=${unixAt(start, '00:00:00')},${unixAt(end, '23:59:59')}|stftype=1`);
        break;
      case 'yandex':
        params.set('text', request.query);
        params.set('yandex_domain', 'yandex.ru');
        params.set('lang', 'ru');
        params.set('p', String(request.page));
        break;
      case 'naver':
        params.set('query', request.query);
        params.set('where', 'news');
        params.set('page', String(request.page + 1));
        params.set('start', String(request.page * PAGE_SIZE + 1));
        if (start && end) params.set('period', `from${compactDate(start)}to${compactDate(end)}`);
        break;
      default: {
        params.set('q', request.query);
        if (request.vertical === 'news') params.set('tbm', 'nws');
        // Chỉ gửi start từ trang 2: thử thực tế, start=0 làm Google nới lỏng truy vấn, bỏ qua site: và cụm trong
        // ngoặc kép (trả cả trang không liên quan), trong khi không gửi start thì Google làm đúng truy vấn
        if (request.page > 0) params.set('start', String(request.page * PAGE_SIZE));
        params.set('nfpr', '1'); // không để Google tự sửa chính tả từ khoá
        const { country, language } = request.locale ?? {};
        if (country) {
          params.set('gl', country);
          params.set('google_domain', GOOGLE_DOMAINS[country] ?? 'google.com');
        }
        if (language) params.set('hl', language);
        const lr = request.locale?.onlyLanguage && GOOGLE_LR[request.locale.onlyLanguage];
        if (lr) params.set('lr', lr);
        if (start && end) params.set('tbs', `cdr:1,cd_min:${toGoogleDate(start)},cd_max:${toGoogleDate(end)}`);
      }
    }
    params.set('api_key', this.apiKey);
    return `${ENDPOINT}?${params}`;
  }

  /** Đổi link chuyển hướng của Baidu ra URL thật (đọc header Location, không tải trang đích); lỗi thì giữ nguyên */
  private async resolveBaiduLink(url: string, signal: AbortSignal): Promise<string> {
    if (!BAIDU_REDIRECT.test(url)) return url;
    try {
      const res = await this.fetchImpl(url, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) });
      const location = res.headers.get('location');
      if (location) return new URL(location, url).toString();
      const html = await res.text();
      const m = /URL='([^']+)'/.exec(html) ?? /location\.replace\("([^"]+)"\)/.exec(html);
      return m ? m[1] : url;
    } catch {
      return url;
    }
  }

  /**
   * Kết quả chỉ có link "/goto?url=…" (Google ẩn URL thật, hay gặp ở bài Facebook / Instagram / Threads):
   * mở link chuyển hướng của Google để lấy URL thật. Không lấy được → null (không biết bài nằm ở đâu thì bỏ).
   */
  private async resolveGoogleLink(r: SerpApiOrganicResult & { link: string }, signal: AbortSignal): Promise<string | null> {
    if (isAbsoluteUrl(r.link)) return r.link;
    if (!r.redirect_link || !isAbsoluteUrl(r.redirect_link)) return null;
    try {
      const res = await this.fetchImpl(r.redirect_link, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
      });
      const location = res.headers.get('location');
      const target = location ? new URL(location, r.redirect_link).toString() : GOOGLE_REDIRECT_TARGET.exec(await res.text())?.[1];
      if (!target) return null;
      const url = target.replace(/&amp;/g, '&');
      // Vẫn là trang của Google (vd trang cảnh báo) thì coi như không lấy được
      return isAbsoluteUrl(url) && !/^https?:\/\/(?:www\.)?google\.[a-z.]+\//i.test(url) ? url : null;
    } catch {
      return null;
    }
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(this.buildUrl(request), { signal, headers: { Accept: 'application/json' } });
    } catch (err) {
      if (request.signal?.aborted) throw err;
      const reason = timeout.aborted ? `không phản hồi sau ${TIMEOUT_MS / 1000}s` : 'không kết nối được';
      throw new SearchProviderError(`SerpApi ${reason}`, false);
    }

    const data = (await res.json().catch(() => ({}))) as SerpApiResponse;
    if (!res.ok || data.error) {
      const message = data.error ?? `HTTP ${res.status}`;
      if (/hasn't returned any results|returned no results|no results/i.test(message)) {
        return { items: [], hasMore: false, searchedAt: new Date().toISOString() };
      }
      const fatal =
        [401, 403, 429].includes(res.status) || /api key|run out of searches|account/i.test(message);
      throw new SearchProviderError(`SerpApi: ${message}`, fatal);
    }

    type Raw = SerpApiOrganicResult & { sourceName?: string; publishedAt?: string };
    let raw: Raw[];
    if (request.engine === 'naver') {
      raw = (data.news_results ?? []).map((r) => ({
        ...r,
        date: r.news_info?.news_date ?? r.news_info?.date,
        sourceName: r.news_info?.press_name,
      }));
    } else if (request.vertical === 'news') {
      raw = (data.news_results ?? []).map((r) => ({
        ...r,
        sourceName: typeof r.source === 'string' ? r.source : r.source?.name,
        publishedAt: r.published_at,
      }));
    } else {
      raw = data.organic_results ?? [];
    }
    const withLinks = raw.filter((r): r is Raw & { link: string } => typeof r.link === 'string');
    const resolved = await Promise.all(
      withLinks.map(async (r, i): Promise<SearchResultItem | null> => {
        const url = request.engine === 'baidu' ? await this.resolveBaiduLink(r.link, signal) : await this.resolveGoogleLink(r, signal);
        if (!url) return null;
        return {
          url,
          title: r.title ?? '',
          snippet: r.snippet ?? '',
          dateText: r.date ?? leadingDate(r.snippet),
          position: r.position ?? request.page * PAGE_SIZE + i + 1,
          ...(r.sourceName ? { sourceName: r.sourceName } : {}),
          ...(r.publishedAt ? { publishedAt: r.publishedAt } : {}),
        };
      }),
    );
    const items = resolved.filter((item): item is SearchResultItem => item !== null);
    return {
      items,
      hasMore: Boolean(data.serpapi_pagination?.next) && items.length > 0,
      searchedAt: new Date().toISOString(),
    };
  }
}

interface SerpApiAccount {
  error?: string;
  plan_name?: string;
  searches_per_month?: number;
  plan_searches_left?: number;
  total_searches_left?: number;
}

/** Account API của SerpApi — miễn phí, không tính vào lượt tìm */
export async function fetchSerpApiAccount(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<SearchQuota> {
  const res = await fetchImpl(`https://serpapi.com/account.json?api_key=${encodeURIComponent(apiKey)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as SerpApiAccount;
  if (!res.ok || data.error) throw new SearchProviderError(`SerpApi: ${data.error ?? `HTTP ${res.status}`}`, false);
  return {
    provider: 'serpapi',
    plan: data.plan_name ?? null,
    searchesLeft: data.plan_searches_left ?? data.total_searches_left ?? null,
    searchesPerMonth: data.searches_per_month ?? null,
  };
}
