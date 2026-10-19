/**
 * Đọc và kiểm tra tham số tìm kiếm từ query string (dùng ở API route và client).
 */
import { SEARCH_LANGUAGES } from '@/config/languages';
import { isValidIsoDate, shiftDate } from './date-range';
import { formatDate } from './labels';
import { canonicalQuery, parseQuery } from './query-syntax';
import type { SearchParams } from './types';

export const SEARCH_LIMITS = {
  minDate: '1990-01-01',
  /** Mặc định tìm bài mới nhất: từ hôm qua đến hôm nay (giờ Việt Nam) */
  defaultFromDaysAgo: 1,
  /** Mặc định 10 kết quả (1 lượt tìm) cho mỗi nguồn */
  defaultPagesPerSource: 1,
  maxPagesPerSource: 10,
  maxQueryLength: 120,
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

/** `today` (YYYY-MM-DD, giờ Việt Nam) là giới hạn trên của khoảng ngày */
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

  return { ok: true, params: { query, region, fromDate, toDate, pagesPerSource, languages, localEngines } };
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
  return qs.toString();
}
