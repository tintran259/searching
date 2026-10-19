import type { Cache } from '../cache';
import type { SearchProvider, SearchResponse } from './types';

/** Bọc bất kỳ provider nào bằng cache để chạy lại cùng truy vấn không tốn quota. Lỗi không được cache. */
export function withCache(provider: SearchProvider, cache: Cache<SearchResponse>): SearchProvider {
  return {
    id: provider.id,
    async search(request) {
      const key = JSON.stringify([
        provider.id,
        request.query,
        request.page,
        request.dateRange ?? null,
        request.locale ?? null,
        // Google giữ khoá cũ để cache đã có vẫn dùng được
        ...(request.engine && request.engine !== 'google' ? [request.engine] : []),
      ]);
      const cached = await cache.get(key);
      if (cached) return { ...cached, fromCache: true };
      const response = await provider.search(request);
      await cache.set(key, { ...response, fromCache: false });
      return response;
    },
  };
}
