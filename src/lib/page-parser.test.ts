import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { parsePage, textOf } from './page-parser';

const NOW = new Date('2026-10-13T12:00:00+07:00');
const FILLER =
  'Theo báo cáo của sở, dự án đã hoàn thành đúng tiến độ với sự tham gia của nhiều đơn vị trong và ngoài tỉnh. ' +
  'Người dân địa phương cho biết cuộc sống đã thay đổi rõ rệt kể từ khi công trình được đưa vào sử dụng.';

function page(body: string, head = '') {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Tiêu đề - Báo</title>${head}</head><body>${body}</body></html>`;
}

const ARTICLE = `
  <header><nav><a href="/">Trang chủ</a> <a href="/nhan-vat">Trần Văn A</a></nav></header>
  <main><article>
    <h1>Dự án cầu mới hoàn thành</h1>
    <p>${FILLER}</p><p>${FILLER}</p><p>${FILLER}</p><p>${FILLER}</p>
  </article></main>
  <footer>Bản quyền © Báo điện tử. Liên hệ: Trần Văn A</footer>`;

describe('textOf', () => {
  it('xuống dòng giữa các khối để chữ không bị dính', () => {
    const { document } = new JSDOM('<ul><li>Nguyễn Văn B</li><li>Trần Văn A</li></ul><p>a<br>b</p>').window;
    expect(textOf(document.body)).toBe('Nguyễn Văn B\nTrần Văn A\na\nb');
  });

  it('bỏ script/style/noscript, gộp khoảng trắng, giữ chữ trong thẻ inline liền nhau', () => {
    const { document } = new JSDOM(
      '<p>Ông <b>Trần</b>   <i>Văn A</i></p><script>var x = "Trần Văn A";</script><style>p{}</style><noscript>bật JS</noscript>',
    ).window;
    expect(textOf(document.body)).toBe('Ông Trần Văn A');
  });
});

describe('parsePage', () => {
  it('nội dung chính bỏ menu/footer, toàn văn thì giữ', () => {
    const parsed = parsePage(page(ARTICLE), 'https://example.vn/du-an-cau-moi.html', NOW);
    expect(parsed.usedReadability).toBe(true);
    expect(parsed.mainText).toContain('dự án đã hoàn thành');
    expect(parsed.mainText).not.toContain('Trần Văn A');
    expect(parsed.fullText).toContain('Trần Văn A');
  });

  it('Readability không lấy được nội dung thì dùng toàn văn', () => {
    const parsed = parsePage(page('<div>Ngắn: Trần Văn A</div>'), 'https://example.vn/a', NOW);
    expect(parsed.usedReadability).toBe(false);
    expect(parsed.mainText).toBe(parsed.fullText);
    expect(parsed.mainText).toContain('Trần Văn A');
  });

  it('đọc tiêu đề (ưu tiên og:title), mô tả, tên báo và ngày đăng', () => {
    const head = `
      <meta property="og:title" content="Dự án cầu mới hoàn thành">
      <meta name="description" content="Mô tả bài">
      <meta property="og:site_name" content="Báo Mẫu">
      <meta property="article:published_time" content="2019-05-12T10:30:00+07:00">`;
    const parsed = parsePage(page(ARTICLE, head), 'https://example.vn/a', NOW);
    expect(parsed).toMatchObject({ title: 'Dự án cầu mới hoàn thành', description: 'Mô tả bài', siteName: 'Báo Mẫu' });
    expect(parsed.date).toMatchObject({ date: '2019-05-12', source: 'meta' });
  });

  it('canonical tương đối được chuyển thành tuyệt đối; canonical trỏ về trang chủ bị bỏ qua', () => {
    const rel = parsePage(page(ARTICLE, '<link rel="canonical" href="/bai-goc.html">'), 'https://example.vn/a?x=1', NOW);
    expect(rel.canonicalUrl).toBe('https://example.vn/bai-goc.html');
    const home = parsePage(page(ARTICLE, '<link rel="canonical" href="https://example.vn/">'), 'https://example.vn/a', NOW);
    expect(home.canonicalUrl).toBeNull();
  });

  it('ngày lấy từ URL canonical khi trang không ghi ngày', () => {
    const head = '<link rel="canonical" href="https://example.vn/2019/05/12/bai-goc.html">';
    expect(parsePage(page(ARTICLE, head), 'https://example.vn/amp/a', NOW).date).toMatchObject({ date: '2019-05-12', source: 'url' });
  });
});
