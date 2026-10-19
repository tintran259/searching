'use client';

import { ConfigProvider, theme } from 'antd';
import viVN from 'antd/locale/vi_VN';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import { useSyncExternalStore, type ReactNode } from 'react';

dayjs.locale('vi');

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** Giao diện antd theo màu của app (globals.css): một màu nhấn, font Be Vietnam Pro, tự đổi sáng / tối theo hệ thống */
export function AntdProvider({ children }: { children: ReactNode }) {
  // Server luôn render giao diện sáng; trình duyệt đổi sang tối sau khi hydrate nếu hệ thống đang ở chế độ tối
  const dark = useSyncExternalStore(subscribe, () => window.matchMedia(DARK_QUERY).matches, () => false);
  return (
    <ConfigProvider
      locale={viVN}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: dark ? '#7aa5ff' : '#2151b8',
          colorLink: dark ? '#7aa5ff' : '#2151b8',
          colorBgContainer: dark ? '#161920' : '#ffffff',
          colorBgElevated: dark ? '#1d2129' : '#ffffff',
          colorBorder: dark ? '#2a2f3a' : '#e1e4eb',
          colorText: dark ? '#e7e9ee' : '#12151b',
          fontFamily: 'var(--font-be-vietnam), ui-sans-serif, system-ui, sans-serif',
          borderRadius: 8,
          controlHeight: 40,
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
