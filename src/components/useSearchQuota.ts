'use client';

import { useEffect, useState } from 'react';
import type { SearchQuota } from '@/lib/search/types';

/** Đọc lượt tìm còn lại; đọc lại mỗi khi `refreshKey` đổi (vd khi một lượt tìm bắt đầu / kết thúc) */
export function useSearchQuota(refreshKey: string): SearchQuota | null {
  const [quota, setQuota] = useState<SearchQuota | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/quota')
      .then((res) => (res.ok ? (res.json() as Promise<SearchQuota | null>) : null))
      .then((value) => {
        if (!cancelled) setQuota(value);
      })
      .catch(() => {
        if (!cancelled) setQuota(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return quota;
}
