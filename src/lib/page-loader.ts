import { createCache } from './cache';
import { FetchError, fetchHtml, type FetchErrorKind } from './fetcher';
import { parsePage, type ParsedPage } from './page-parser';

/** Tăng khi đổi cách phân tích trang để bỏ qua cache cũ */
const PARSER_VERSION = 1;
const PAGE_TTL_MS = 30 * 24 * 3_600_000;
const ERROR_TTL_MS = 24 * 3_600_000;
/** Trang gần như không có chữ: thường là trang thử thách chống bot (đặt cookie bằng JS rồi tải lại) */
const MIN_PAGE_TEXT_LENGTH = 30;

type CachedPage = { page: ParsedPage } | { error: { kind: FetchErrorKind; message: string } };

// Cache trang đã phân tích (không lưu HTML gốc để cache gọn)
const pageCache = createCache<CachedPage>('pages', { ttlMs: PAGE_TTL_MS, maxMemoryEntries: 300 });

/** Lỗi ổn định (robots, không phải HTML, 4xx) được cache; timeout, lỗi mạng, 5xx, 429 thì không. */
function isStableError(err: FetchError): boolean {
  if (err.kind === 'robots' || err.kind === 'not_html' || err.kind === 'blocked') return true;
  return err.kind === 'http' && /^HTTP 4\d\d$/.test(err.message) && err.message !== 'HTTP 429';
}

/** Tải + phân tích trang, có cache. Ném FetchError khi không tải được. */
export async function loadPage(url: string, signal?: AbortSignal): Promise<ParsedPage> {
  const key = `v${PARSER_VERSION}|${url}`;
  const cached = await pageCache.get(key);
  if (cached) {
    if ('error' in cached) throw new FetchError(cached.error.kind, cached.error.message);
    return cached.page;
  }
  try {
    const fetched = await fetchHtml(url, { signal });
    const page = parsePage(fetched.html, fetched.finalUrl);
    if (page.fullText.length < MIN_PAGE_TEXT_LENGTH) {
      // Không vượt qua cơ chế chống bot: báo lỗi để người dùng tự mở link kiểm tra
      throw new FetchError('blocked', 'Trang không có nội dung đọc được (chặn bot hoặc cần JavaScript)');
    }
    await pageCache.set(key, { page });
    return page;
  } catch (err) {
    if (err instanceof FetchError && isStableError(err)) {
      await pageCache.set(key, { error: { kind: err.kind, message: err.message } }, ERROR_TTL_MS);
    }
    throw err;
  }
}
