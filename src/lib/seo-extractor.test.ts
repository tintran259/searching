import { describe, expect, it } from 'vitest';
import { parsePage } from './page-parser';

const NOW = new Date('2026-10-19T12:00:00+07:00');
const BODY = '<p>' + 'Nội dung bài viết về chuyến thăm. '.repeat(20) + '</p>';

describe('extractSeo (qua parsePage)', () => {
  it('đọc đủ thông tin SEO từ meta, Open Graph và JSON-LD', () => {
    const html = `<!doctype html><html lang="vi"><head>
      <title>Tổng Bí thư lên đường thăm Đan Mạch | Báo Nhân Dân</title>
      <meta name="description" content="  Sáng 19/10, Tổng Bí thư lên đường thăm Đan Mạch. ">
      <meta property="og:title" content="Tổng Bí thư lên đường thăm Đan Mạch">
      <meta property="og:description" content="Mô tả Open Graph">
      <meta property="og:image" content="/uploads/anh-dai-dien.jpg">
      <meta property="og:site_name" content="Báo Nhân Dân">
      <meta property="article:section" content="Chính trị">
      <meta property="article:author" content="https://nhandan.vn/tac-gia/a">
      <meta property="article:modified_time" content="2026-10-19T09:30:00+07:00">
      <meta property="article:tag" content="Tô Lâm">
      <meta name="keywords" content="Tô Lâm, Đan Mạch; ngoại giao, tô lâm">
      <meta name="robots" content="index, follow">
      <link rel="canonical" href="https://nhandan.vn/bai-viet-1.html">
      <script type="application/ld+json">{"@type":"NewsArticle","author":[{"@type":"Person","name":"Nguyễn Văn B"}],
        "publisher":{"@type":"Organization","name":"Nhân Dân"},"keywords":["EU"],"datePublished":"2026-10-19T08:00:00+07:00"}</script>
    </head><body><article><h1>Tổng Bí thư lên đường thăm Đan Mạch</h1>${BODY}</article></body></html>`;
    const { seo } = parsePage(html, 'https://nhandan.vn/bai-viet-1.html?utm_source=x', NOW);
    expect(seo).toMatchObject({
      title: 'Tổng Bí thư lên đường thăm Đan Mạch | Báo Nhân Dân',
      ogTitle: 'Tổng Bí thư lên đường thăm Đan Mạch',
      description: 'Sáng 19/10, Tổng Bí thư lên đường thăm Đan Mạch.',
      ogDescription: 'Mô tả Open Graph',
      image: 'https://nhandan.vn/uploads/anh-dai-dien.jpg',
      author: 'Nguyễn Văn B', // article:author chỉ là link trang tác giả → bỏ
      section: 'Chính trị',
      keywords: ['Tô Lâm', 'Đan Mạch', 'ngoại giao', 'EU'],
      canonical: 'https://nhandan.vn/bai-viet-1.html',
      language: 'vi',
      publisher: 'Báo Nhân Dân',
      modified: '2026-10-19',
      robots: 'index, follow',
    });
    expect(seo.wordCount).toBeGreaterThan(100);
  });

  it('trang thiếu thông tin: các trường để trống, ảnh lạ (data:) bị bỏ, lấy ảnh / tác giả từ JSON-LD', () => {
    const html = `<html><head><title>Bài viết</title><meta property="og:image" content="data:image/png;base64,AAA">
      <script type="application/ld+json">{"@type":"Article","author":"Trần C","image":{"@type":"ImageObject","url":"https://cdn.example.com/a.jpg"}}</script>
      </head><body>${BODY}</body></html>`;
    const { seo } = parsePage(html, 'https://example.com/a', NOW);
    expect(seo).toMatchObject({
      title: 'Bài viết',
      ogTitle: null,
      description: null,
      image: null, // og:image không hợp lệ được ưu tiên trước nên bị loại, không rơi xuống JSON-LD
      author: 'Trần C',
      section: null,
      keywords: [],
      language: null,
      modified: null,
    });
    const jsonLdOnly = parsePage(html.replace(/<meta property="og:image"[^>]*>/, ''), 'https://example.com/a', NOW);
    expect(jsonLdOnly.seo.image).toBe('https://cdn.example.com/a.jpg');
  });
});
