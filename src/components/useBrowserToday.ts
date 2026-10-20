'use client';

import { useSyncExternalStore } from 'react';
import { todayInTimeZone } from '@/lib/date-range';

/** Kiểm tra lại mỗi phút (và khi quay lại tab) để sang ngày mới thì "hôm nay" tự đổi theo */
const CHECK_INTERVAL_MS = 60_000;

function subscribe(onChange: () => void) {
  const timer = window.setInterval(onChange, CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('focus', onChange);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener('focus', onChange);
  };
}

/**
 * Hôm nay theo giờ trình duyệt, YYYY-MM-DD. Khi prerender trên server (chưa có trình duyệt)
 * thì dùng `fallback`; trang tĩnh có thể được build từ hôm trước nên không dùng giá trị đó lâu dài.
 */
export function useBrowserToday(fallback: string): string {
  return useSyncExternalStore(subscribe, () => todayInTimeZone(), () => fallback);
}
