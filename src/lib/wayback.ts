/**
 * Bước 5 trích ngày: lần lưu trữ đầu tiên trên Wayback Machine (CDX API) → ngày "ước lượng".
 * Lần lưu đầu tiên luôn ở sau (hoặc bằng) ngày đăng thật.
 */
import pLimit from 'p-limit';
import { createCache } from './cache';
import { fromWaybackTimestamp } from './date-extractor';
import { USER_AGENT } from './fetcher';
import type { ExtractedDate } from './types';

const CDX_ENDPOINT = 'https://web.archive.org/cdx/search/cdx';
/** CDX API thường mất 5–15s, nên dùng timeout riêng dài hơn timeout tải trang */
const TIMEOUT_MS = 20_000;
// Wayback giới hạn tần suất truy vấn nên chỉ gọi tối đa 2 yêu cầu cùng lúc
const limit = pLimit(2);
const cache = createCache<{ timestamp: string | null }>('wayback', { ttlMs: 30 * 24 * 3_600_000 });

/** Chọn bản lưu thành công (200) sớm nhất; không có thì bản chuyển hướng (3xx) sớm nhất. */
function pickTimestamp(rows: unknown): string | null {
  if (!Array.isArray(rows)) return null;
  // Dòng 0 là tiêu đề cột: [["timestamp","statuscode"], ["20190512103000","200"], …]
  const captures = rows.slice(1).filter((r): r is string[] => Array.isArray(r) && typeof r[0] === 'string');
  return (captures.find((r) => r[1] === '200') ?? captures.find((r) => /^3/.test(r[1] ?? '')))?.[0] ?? null;
}

export async function lookupWaybackDate(url: string, signal?: AbortSignal): Promise<ExtractedDate | null> {
  const target = url.replace(/#.*$/, '');
  const cached = await cache.get(target);
  if (cached) return cached.timestamp ? fromWaybackTimestamp(cached.timestamp) : null;

  return limit(async () => {
    if (signal?.aborted) return null;
    // url + limit + output=json theo đặc tả; lấy 5 bản đầu kèm mã trạng thái để bỏ qua bản lưu lỗi.
    // (Không dùng filter=statuscode:200 của CDX vì chậm hơn hẳn.)
    const query = new URLSearchParams({ url: target, limit: '5', output: 'json', fl: 'timestamp,statuscode' });
    try {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const res = await fetch(`${CDX_ENDPOINT}?${query}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!res.ok) return null; // 429/5xx: không cache, lần sau thử lại
      const text = await res.text();
      const timestamp = pickTimestamp(text.trim() ? JSON.parse(text) : []);
      await cache.set(target, { timestamp });
      return timestamp ? fromWaybackTimestamp(timestamp) : null;
    } catch {
      return null;
    }
  });
}
