'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

const noopSubscribe = () => () => {};

/**
 * Chỉ dựng `children` trên trình duyệt; khi prerender trên server thì hiện `fallback` (cùng kích thước).
 * Dùng cho component antd (DatePicker, Select) đọc giờ hiện tại (Date.now) ngay lúc render — Next.js 16
 * (cacheComponents) không cho dùng giá trị đó khi prerender trang tĩnh.
 */
export function ClientOnly({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return mounted ? children : fallback;
}
