import { createCache } from '../cache';
import { withCache } from './cached';
import { SerpApiProvider, fetchSerpApiAccount } from './serpapi';
import { SearchProviderError, type SearchProvider, type SearchQuota, type SearchResponse } from './types';

/** Lượt tìm còn lại (null nếu nhà cung cấp không hỗ trợ hoặc chưa có key) */
export async function getSearchQuota(): Promise<SearchQuota | null> {
  if ((process.env.SEARCH_PROVIDER || 'serpapi').toLowerCase() !== 'serpapi') return null;
  const apiKey = process.env.SERPAPI_KEY?.trim();
  if (!apiKey) return null;
  return fetchSerpApiAccount(apiKey).catch(() => null);
}

const SEARCH_CACHE_TTL_MS = 7 * 24 * 3_600_000;

/** Chọn provider theo biến môi trường SEARCH_PROVIDER (mặc định serpapi), luôn có cache. */
export function getSearchProvider(): SearchProvider {
  const name = (process.env.SEARCH_PROVIDER || 'serpapi').toLowerCase();
  let provider: SearchProvider;
  switch (name) {
    case 'serpapi': {
      const apiKey = process.env.SERPAPI_KEY?.trim();
      if (!apiKey) {
        throw new SearchProviderError(
          'Thiếu SERPAPI_KEY: điền key vào .env.local rồi lưu lại (chạy bằng npm run dev thì server tự nạp lại; npm start thì cần khởi động lại).',
          true,
        );
      }
      provider = new SerpApiProvider(apiKey);
      break;
    }
    // Thêm Serper / DataForSEO / Brave… ở đây: một lớp mới implement SearchProvider.
    default:
      throw new SearchProviderError(`SEARCH_PROVIDER "${name}" chưa được hỗ trợ.`, true);
  }
  return withCache(provider, createCache<SearchResponse>('search', { ttlMs: SEARCH_CACHE_TTL_MS }));
}

export * from './types';
