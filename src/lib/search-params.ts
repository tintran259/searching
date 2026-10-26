/**
 * Đọc và kiểm tra tham số tìm kiếm từ query string (dùng ở API route và client).
 */
import { SEARCH_LANGUAGES } from '@/config/languages';
import { DEFAULT_SOCIAL_PLATFORMS, SOCIAL_SEARCH_PLATFORMS, type SocialPlatformId } from '@/config/sources';
import { isValidIsoDate, shiftDate } from './date-range';
import { formatDate } from './labels';
import { canonicalQuery, parseList, parseQuery, termAlternatives } from './query-syntax';
import type { SearchParams, TermExpansion } from './types';

export const SEARCH_LIMITS = {
  minDate: '1990-01-01',
  /** Mặc định tìm bài mới nhất: từ hôm qua đến hôm nay (giờ trình duyệt) */
  defaultFromDaysAgo: 1,
  /** Mặc định 10 kết quả (1 lượt tìm) cho mỗi nguồn */
  defaultPagesPerSource: 1,
  maxPagesPerSource: 10,
  maxQueryLength: 120,
  /** Số lượt SerpApi tối đa cho một lượt tìm: mặc định thấp vì gói miễn phí chỉ có 250 lượt/tháng */
  defaultBudget: 10,
  maxBudget: 100,
  budgetOptions: [5, 10, 20, 30, 50, 100],
  maxListItems: 30,
  /** Số cách gọi khác tối đa cho mỗi từ khoá chính, độ dài tối đa mỗi cách gọi */
  maxExpansionsPerTerm: 8,
  maxExpansionLength: 80,
} as const;

export type ParsedSearchParams = { ok: true; params: SearchParams } | { ok: false; error: string };

function readInt(value: string | null, fallback: number): number {
  if (value === null || value.trim() === '') return fallback;
  return /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
}

/** YYYY-MM-DD; chỉ có năm (kiểu cũ "2010") thì lấy ngày đầu / cuối năm. Sai định dạng → null */
function readDate(value: string | null, fallback: string, edge: 'start' | 'end'): string | null {
  const v = value?.trim();
  if (!v) return fallback;
  if (/^\d{4}$/.test(v)) return edge === 'start' ? `${v}-01-01` : `${v}-12-31`;
  return isValidIsoDate(v) ? v : null;
}

/** Ngày bắt đầu mặc định: `today` trừ SEARCH_LIMITS.defaultFromDaysAgo ngày */
export function defaultFromDate(today: string): string {
  return shiftDate(today, { days: -SEARCH_LIMITS.defaultFromDaysAgo });
}

/** `today` (YYYY-MM-DD) là giới hạn trên của khoảng ngày */
export function parseSearchParams(sp: URLSearchParams, today: string): ParsedSearchParams {
  const fail = (error: string): ParsedSearchParams => ({ ok: false, error });
  // Giữ dấu `: phần trong dấu là từ khoá chính (bắt buộc), phần còn lại là từ phụ
  const parsedQuery = parseQuery(sp.get('q') ?? '');
  if (!parsedQuery.required.length && !parsedQuery.optional.length) return fail('Vui lòng nhập từ khoá cần tìm.');
  const query = canonicalQuery(parsedQuery);
  if (query.length > SEARCH_LIMITS.maxQueryLength) {
    return fail(`Từ khoá dài tối đa ${SEARCH_LIMITS.maxQueryLength} ký tự.`);
  }

  const region = sp.get('region') ?? 'domestic';
  if (region !== 'domestic' && region !== 'foreign') return fail('Phạm vi phải là "domestic" hoặc "foreign".');

  const fromDate = readDate(sp.get('from'), defaultFromDate(today), 'start');
  const rawToDate = readDate(sp.get('to'), today, 'end');
  if (!fromDate || !rawToDate) return fail('Ngày không hợp lệ.');
  const toDate = rawToDate > today ? today : rawToDate; // ngày trong tương lai → tính đến hôm nay
  if (fromDate < SEARCH_LIMITS.minDate || fromDate > toDate) {
    return fail(
      `Khoảng ngày phải nằm trong ${formatDate(SEARCH_LIMITS.minDate)} – ${formatDate(today)} và ngày bắt đầu không sau ngày kết thúc.`,
    );
  }

  // pages=N: N × 10 kết quả cho mỗi nguồn (tiếng Việt, mỗi ngôn ngữ dịch, mỗi công cụ địa phương)
  const pagesPerSource = readInt(sp.get('pages'), SEARCH_LIMITS.defaultPagesPerSource);
  if (!(pagesPerSource >= 1 && pagesPerSource <= SEARCH_LIMITS.maxPagesPerSource)) {
    return fail(`Số kết quả mỗi ngôn ngữ phải từ 10 đến ${SEARCH_LIMITS.maxPagesPerSource * 10}.`);
  }

  // langs=en,ru,zh-CN — không có thì không dịch
  const requested = (sp.get('langs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = requested.filter((code) => !SEARCH_LANGUAGES.some((l) => l.code === code));
  if (unknown.length) return fail(`Ngôn ngữ chưa hỗ trợ: ${unknown.join(', ')}.`);
  const languages = SEARCH_LANGUAGES.filter((l) => requested.includes(l.code)).map((l) => l.code);
  // Ngoài nước chỉ tìm bằng các ngôn ngữ đã chọn (không tìm bằng tiếng Việt)
  if (region === 'foreign' && languages.length === 0) {
    return fail('Tìm báo nước ngoài: hãy chọn ít nhất một ngôn ngữ / nước cần tìm.');
  }

  // local=1: tìm thêm trên Baidu / Yandex / Naver (chỉ có tác dụng khi phạm vi Ngoài nước)
  const localEngines = ['1', 'true'].includes(sp.get('local') ?? '');

  // budget=N: số lượt SerpApi tối đa cho cả lượt tìm
  const budget = readInt(sp.get('budget'), SEARCH_LIMITS.defaultBudget);
  if (!(budget >= 1 && budget <= SEARCH_LIMITS.maxBudget)) {
    return fail(`Số lượt tìm tối đa phải từ 1 đến ${SEARCH_LIMITS.maxBudget}.`);
  }

  // exclude=a,b · allow=x.com,y.org · deny=…: danh sách cách nhau bằng dấu phẩy
  const exclude = parseList(sp.get('exclude'));
  const allowDomains = parseList(sp.get('allow')).map(cleanDomain).filter(Boolean);
  const denyDomains = parseList(sp.get('deny')).map(cleanDomain).filter(Boolean);
  if ([exclude, allowDomains, denyDomains].some((l) => l.length > SEARCH_LIMITS.maxListItems)) {
    return fail(`Mỗi danh sách loại trừ / domain có tối đa ${SEARCH_LIMITS.maxListItems} mục.`);
  }

  // expand=[{"term":"Tô Lâm","alternatives":["Chủ tịch nước Việt Nam"]}]: cách gọi khác chọn từ gợi ý
  const expansions = readExpansions(sp.get('expand'), parsedQuery.required);
  if (!expansions) return fail('Danh sách cách gọi khác (expand) không hợp lệ.');

  // policy=labeled (mặc định): nhận mọi domain có đủ nội dung; verified: chỉ nhận báo có bằng chứng quốc gia
  const policy = sp.get('policy') ?? 'labeled';
  if (policy !== 'verified' && policy !== 'labeled') return fail('Chính sách nguồn phải là "verified" hoặc "labeled".');
  // sources=news (mặc định) | social | both: chỉ báo, chỉ mạng xã hội, hay cả hai
  const sourceTypes = sp.get('sources') ?? 'news';
  if (sourceTypes !== 'news' && sourceTypes !== 'social' && sourceTypes !== 'both') {
    return fail('Loại nguồn phải là "news", "social" hoặc "both".');
  }

  // platforms=facebook,threads: nền tảng cần tìm khi tìm mạng xã hội (mỗi nền tảng một truy vấn)
  const platformParam = sp.get('platforms');
  const requestedPlatforms = platformParam === null ? DEFAULT_SOCIAL_PLATFORMS : parseList(platformParam).map((p) => p.toLowerCase());
  const unknownPlatforms = requestedPlatforms.filter((p) => !SOCIAL_SEARCH_PLATFORMS.some((x) => x.id === p));
  if (unknownPlatforms.length) return fail(`Nền tảng chưa hỗ trợ: ${unknownPlatforms.join(', ')}.`);
  const socialPlatforms = SOCIAL_SEARCH_PLATFORMS.filter((p) => requestedPlatforms.includes(p.id)).map((p) => p.id as SocialPlatformId);
  if (sourceTypes !== 'news' && socialPlatforms.length === 0) {
    return fail('Tìm mạng xã hội: hãy chọn ít nhất một nền tảng.');
  }

  // republished=0: giữ cả bài đăng lại / dịch lại từ báo Việt Nam (mặc định loại)
  const excludeRepublished = !['0', 'false'].includes(sp.get('republished') ?? '');

  return {
    ok: true,
    params: {
      query,
      region,
      fromDate,
      toDate,
      pagesPerSource,
      languages,
      localEngines,
      budget,
      exclude,
      sourcePolicy: policy,
      excludeRepublished,
      allowDomains,
      denyDomains,
      expansions,
      sourceTypes,
      socialPlatforms,
    },
  };
}

const tidyPhrase = (s: string) => s.normalize('NFC').replace(/[`|"“”]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Đọc JSON cách gọi khác; chỉ giữ cho các từ khoá chính đang có trong ô tìm kiếm, bỏ trùng với chính từ khoá.
 * Sai định dạng → null.
 */
function readExpansions(value: string | null, required: string[]): TermExpansion[] | null {
  if (!value?.trim()) return [];
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const result: TermExpansion[] = [];
  for (const item of data) {
    const { term, alternatives } = (item ?? {}) as { term?: unknown; alternatives?: unknown };
    if (typeof term !== 'string' || !Array.isArray(alternatives)) return null;
    const target = required.find((r) => r.toLowerCase() === tidyPhrase(term).toLowerCase());
    if (!target) continue;
    const own = new Set(termAlternatives(target).map((a) => a.toLowerCase()));
    const alts = [
      ...new Set(
        alternatives
          .filter((a): a is string => typeof a === 'string')
          .map(tidyPhrase)
          .filter((a) => a && a.length <= SEARCH_LIMITS.maxExpansionLength && !own.has(a.toLowerCase())),
      ),
    ].slice(0, SEARCH_LIMITS.maxExpansionsPerTerm);
    if (alts.length) result.push({ term: target, alternatives: alts });
  }
  return result;
}

/** "https://www.Example.com/abc" → "example.com" */
function cleanDomain(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .trim();
}

export function toQueryString(params: SearchParams): string {
  const qs = new URLSearchParams({
    q: params.query,
    region: params.region,
    from: params.fromDate,
    to: params.toDate,
    pages: String(params.pagesPerSource),
  });
  if (params.languages.length) qs.set('langs', params.languages.join(','));
  if (params.localEngines) qs.set('local', '1');
  if (params.budget) qs.set('budget', String(params.budget));
  if (params.exclude?.length) qs.set('exclude', params.exclude.join(','));
  if (params.sourcePolicy && params.sourcePolicy !== 'labeled') qs.set('policy', params.sourcePolicy);
  if (params.excludeRepublished === false) qs.set('republished', '0');
  if (params.allowDomains?.length) qs.set('allow', params.allowDomains.join(','));
  if (params.denyDomains?.length) qs.set('deny', params.denyDomains.join(','));
  if (params.expansions?.length) qs.set('expand', JSON.stringify(params.expansions));
  if (params.sourceTypes && params.sourceTypes !== 'news') qs.set('sources', params.sourceTypes);
  if (params.socialPlatforms && params.socialPlatforms.join(',') !== DEFAULT_SOCIAL_PLATFORMS.join(',')) {
    qs.set('platforms', params.socialPlatforms.join(','));
  }
  return qs.toString();
}
