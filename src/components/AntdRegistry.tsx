'use client';

import { StyleProvider, extractStyle } from '@ant-design/cssinjs';
import CacheEntity from '@ant-design/cssinjs/es/Cache';
import { useServerInsertedHTML } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';

/**
 * Thu CSS của antd khi render trên server rồi chèn vào <head> (giống @ant-design/nextjs-registry).
 * Khác bản gốc: tạo cache bằng mã từ useId() thay vì createCache() — hàm đó gọi Math.random() ngay khi render,
 * mà Next.js 16 (cacheComponents) không cho dùng giá trị ngẫu nhiên trong lúc prerender trang tĩnh.
 */
export function AntdRegistry({ children }: { children: ReactNode }) {
  const id = useId();
  const [cache] = useState(() => new CacheEntity(`antd${id}`));
  useServerInsertedHTML(() => {
    const styleText = extractStyle(cache, { plain: true, once: true });
    if (!styleText || styleText.includes('.data-ant-cssinjs-cache-path{content:"";}')) return null;
    return (
      <style
        id="antd-cssinjs"
        // Đặt trước style antd sinh ở trình duyệt để thứ tự ưu tiên giống nhau
        data-rc-order="prepend"
        data-rc-priority="-1000"
        dangerouslySetInnerHTML={{ __html: styleText }}
      />
    );
  });
  return <StyleProvider cache={cache}>{children}</StyleProvider>;
}
