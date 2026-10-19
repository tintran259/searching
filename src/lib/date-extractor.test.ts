import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  extractDateFromDocument,
  extractJsonLdDate,
  extractMetaDate,
  extractTimeElementDate,
  extractUrlDate,
  fromWaybackTimestamp,
  parseDate,
  parseSnippetDate,
} from './date-extractor';

const NOW = new Date('2026-10-13T12:00:00+07:00');
const doc = (head: string, body = '') =>
  new JSDOM(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`).window.document;

describe('parseDate — các định dạng ngày thường gặp ở báo VN', () => {
  it.each([
    ['2019-05-12T10:30:00+07:00', '2019-05-12'],
    ['2019-05-12T03:30:00.000Z', '2019-05-12'],
    ['2019-05-12 10:30:00', '2019-05-12'],
    ['2019/05/12', '2019-05-12'],
    ['12/05/2019 10:30', '2019-05-12'],
    ['12/5/2019', '2019-05-12'],
    ['12-05-2019', '2019-05-12'],
    ['12.05.2019', '2019-05-12'],
    ['Chủ nhật, 12/5/2019, 10:30 (GMT+7)', '2019-05-12'],
    ['Thứ Hai, 13/05/2019 - 08:15', '2019-05-13'],
    ['13/05/2019 08:15 GMT+7', '2019-05-13'],
    ['10h30 ngày 12/5/2019', '2019-05-12'],
    ['12 tháng 5, 2019', '2019-05-12'],
    ['12 thg 5, 2019', '2019-05-12'],
    ['Ngày 12 tháng 05 năm 2019', '2019-05-12'],
    ['Thg 5 12, 2019', '2019-05-12'],
    ['May 12, 2019', '2019-05-12'],
    ['12 May 2019', '2019-05-12'],
    ['March 3rd, 2021', '2021-03-03'],
    ['Sun, 12 May 2019 10:30:00 +0700', '2019-05-12'],
    ['1557631800', '2019-05-12'],
    ['1557631800000', '2019-05-12'],
  ])('%s → %s', (raw, expected) => {
    expect(parseDate(raw, 'meta', { now: NOW })?.date).toBe(expected);
  });

  it('không ghi múi giờ thì coi là GMT+7', () => {
    expect(parseDate('2019-05-12 10:30', 'meta', { now: NOW })?.timestamp).toBe(Date.UTC(2019, 4, 12, 3, 30));
    expect(parseDate('12/05/2019 10:30', 'meta', { now: NOW })?.timestamp).toBe(Date.UTC(2019, 4, 12, 3, 30));
  });

  it('dùng múi giờ khi có: Z, +07:00, +0700, GMT+7', () => {
    expect(parseDate('2019-05-12T03:30:00Z', 'meta', { now: NOW })?.timestamp).toBe(Date.UTC(2019, 4, 12, 3, 30));
    expect(parseDate('2019-05-12T10:30:00+07:00', 'meta', { now: NOW })?.timestamp).toBe(Date.UTC(2019, 4, 12, 3, 30));
    expect(parseDate('Sun, 12 May 2019 10:30:00 +0700', 'meta', { now: NOW })?.timestamp).toBe(Date.UTC(2019, 4, 12, 3, 30));
    expect(parseDate('12/5/2019, 10:30 (GMT+7)', 'meta', { now: NOW })?.timestamp).toBe(Date.UTC(2019, 4, 12, 3, 30));
    expect(parseDate('2019-05-12T10:30:00-05:00', 'meta', { now: NOW })?.timestamp).toBe(Date.UTC(2019, 4, 12, 15, 30));
  });

  it('giữ ngày theo lịch nơi đăng dù giờ UTC đã sang ngày trước', () => {
    const d = parseDate('2019-05-13T01:00:00+07:00', 'meta', { now: NOW })!;
    expect(d.date).toBe('2019-05-13');
    expect(d.timestamp).toBe(Date.UTC(2019, 4, 12, 18, 0));
  });

  it('dạng MM/DD/YYYY chỉ khi phần tháng > 12', () => {
    expect(parseDate('05/13/2019', 'meta', { now: NOW })?.date).toBe('2019-05-13');
    expect(parseDate('05/12/2019', 'meta', { now: NOW })?.date).toBe('2019-12-05');
  });

  it.each(['', '   ', 'không có ngày', '31/02/2019', '2019-13-01', '1970-01-01T00:00:00Z', '2030-01-01', '99/99/2019'])(
    'trả null với giá trị không hợp lệ: "%s"',
    (raw) => {
      expect(parseDate(raw, 'meta', { now: NOW })).toBeNull();
    },
  );

  it('ghi lại nguồn và chuỗi gốc', () => {
    expect(parseDate('12/5/2019', 'time', { now: NOW })).toMatchObject({ source: 'time', raw: '12/5/2019', estimated: false });
  });
});

describe('1. meta', () => {
  it('article:published_time', () => {
    const d = extractMetaDate(doc('<meta property="article:published_time" content="2019-05-12T10:30:00+07:00">'), NOW);
    expect(d).toMatchObject({ date: '2019-05-12', source: 'meta' });
  });

  it('pubdate + itemprop datePublished (kiểu VnExpress)', () => {
    const head = '<meta name="pubdate" itemprop="datePublished" content="2019-05-12T10:30:00+07:00"/>';
    expect(extractMetaDate(doc(head), NOW)?.date).toBe('2019-05-12');
  });

  it('nội dung meta dạng dd/MM/yyyy', () => {
    expect(extractMetaDate(doc('<meta name="pubdate" content="12/05/2019 10:30">'), NOW)?.date).toBe('2019-05-12');
  });

  it('không phân biệt hoa thường tên meta, bỏ qua meta hỏng để dùng meta sau', () => {
    const head = `
      <meta property="article:published_time" content="không rõ">
      <meta name="PubDate" content="2019-05-12">`;
    expect(extractMetaDate(doc(head), NOW)?.date).toBe('2019-05-12');
  });

  it('theo đúng thứ tự ưu tiên khoá meta', () => {
    const head = `
      <meta name="pubdate" content="2018-01-01">
      <meta property="article:published_time" content="2019-05-12">`;
    expect(extractMetaDate(doc(head), NOW)?.date).toBe('2019-05-12');
  });

  it('không dùng article:modified_time', () => {
    expect(extractMetaDate(doc('<meta property="article:modified_time" content="2020-01-01">'), NOW)).toBeNull();
  });

  it('microdata trên thẻ không phải meta', () => {
    const body = '<span itemprop="datePublished" content="2019-05-12">12/5/2019</span>';
    expect(extractMetaDate(doc('', body), NOW)).toMatchObject({ date: '2019-05-12', source: 'meta' });
  });
});

describe('2. JSON-LD', () => {
  const ld = (json: string) => `<script type="application/ld+json">${json}</script>`;

  it('NewsArticle', () => {
    const d = extractJsonLdDate(
      doc(ld('{"@context":"https://schema.org","@type":"NewsArticle","headline":"x","datePublished":"2019-05-12T10:30:00+07:00"}')),
      NOW,
    );
    expect(d).toMatchObject({ date: '2019-05-12', source: 'jsonld' });
  });

  it('trong @graph, bỏ qua WebPage/Organization', () => {
    const json = `{"@context":"https://schema.org","@graph":[
      {"@type":"WebPage","datePublished":"2010-01-01"},
      {"@type":"Organization","name":"Báo"},
      {"@type":"Article","datePublished":"2019-05-12"}]}`;
    expect(extractJsonLdDate(doc(ld(json)), NOW)?.date).toBe('2019-05-12');
  });

  it('mảng ở gốc và @type dạng mảng (BlogPosting)', () => {
    const json = '[{"@type":"Organization"},{"@type":["BlogPosting"],"datePublished":"2019-05-12"}]';
    expect(extractJsonLdDate(doc(ld(json)), NOW)?.date).toBe('2019-05-12');
  });

  it('JSON có xuống dòng thô trong chuỗi và dấu phẩy thừa', () => {
    const json = '{"@type":"NewsArticle","headline":"Dòng 1\nDòng 2","datePublished":"2019-05-12T10:30:00+07:00",}';
    expect(extractJsonLdDate(doc(ld(json)), NOW)?.date).toBe('2019-05-12');
  });

  it('JSON hỏng hẳn vẫn dò được datePublished', () => {
    const json = '{"@type": "NewsArticle", "datePublished": "2019-05-12", "author": {';
    expect(extractJsonLdDate(doc(ld(json)), NOW)?.date).toBe('2019-05-12');
  });

  it('không có bài viết thì trả null', () => {
    expect(extractJsonLdDate(doc(ld('{"@type":"WebSite","datePublished":"2019-05-12"}')), NOW)).toBeNull();
  });
});

describe('3. <time datetime>', () => {
  it('ưu tiên thẻ trong <article> hơn thẻ ở sidebar', () => {
    const body = `
      <aside><time datetime="2020-01-01">1/1/2020</time></aside>
      <article><time datetime="2019-05-12T10:30">12/5/2019</time></article>`;
    expect(extractTimeElementDate(doc('', body), NOW)).toMatchObject({ date: '2019-05-12', source: 'time' });
  });

  it('ưu tiên thẻ có pubdate', () => {
    const body = '<time datetime="2020-02-02"></time><time pubdate datetime="2019-05-12"></time>';
    expect(extractTimeElementDate(doc('', body), NOW)?.date).toBe('2019-05-12');
  });
});

describe('4. ngày trong URL', () => {
  it.each([
    ['https://example.com/2019/05/12/bai-viet/', '2019-05-12'],
    ['https://example.com/news/2019-05-12/slug', '2019-05-12'],
    ['https://www.theguardian.com/world/2019/may/12/slug', '2019-05-12'],
    ['https://dantri.com.vn/xa-hoi/ten-bai-20190512103045123.htm', '2019-05-12'],
    ['https://nld.com.vn/thoi-su/ten-bai-20190512103045123.htm', '2019-05-12'],
    ['https://tuoitre.vn/ten-bai-2019051210304512.htm', '2019-05-12'],
    ['https://tuoitre.vn/tin/chinh-tri-xa-hoi/20190512/ten-bai/1234567.html', '2019-05-12'],
    ['https://thanhnien.vn/ten-bai-185190512103045123.htm', '2019-05-12'],
    ['https://cafef.vn/ten-bai-188190512103045123.chn', '2019-05-12'],
  ])('%s → %s', (url, expected) => {
    expect(extractUrlDate(url, NOW)).toMatchObject({ date: expected, source: 'url', estimated: false });
  });

  it.each([
    'https://vnexpress.net/ten-bai-3923456.html',
    'https://vietnamnet.vn/ten-bai-2045678.html',
    'https://tienphong.vn/ten-bai-post1234567.tpo',
    'https://laodong.vn/thoi-su/ten-bai-1234567.ldo',
    'https://dantri.com.vn/xa-hoi/ten-bai-1234567890.htm',
    'https://example.com/san-pham/99999999',
  ])('không đoán ngày từ mã bài: %s', (url) => {
    expect(extractUrlDate(url, NOW)).toBeNull();
  });
});

describe('extractDateFromDocument — thứ tự ưu tiên', () => {
  const META = '<meta property="article:published_time" content="2019-05-12">';
  const LD = '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2018-01-01"}</script>';
  const TIME = '<article><time datetime="2017-01-01"></time></article>';
  const URL_WITH_DATE = 'https://example.com/2016/01/01/bai-viet';

  it('meta > JSON-LD > <time> > URL', () => {
    expect(extractDateFromDocument(doc(META + LD, TIME), [URL_WITH_DATE], NOW)).toMatchObject({ date: '2019-05-12', source: 'meta' });
    expect(extractDateFromDocument(doc(LD, TIME), [URL_WITH_DATE], NOW)).toMatchObject({ date: '2018-01-01', source: 'jsonld' });
    expect(extractDateFromDocument(doc('', TIME), [URL_WITH_DATE], NOW)).toMatchObject({ date: '2017-01-01', source: 'time' });
    expect(extractDateFromDocument(doc(''), [URL_WITH_DATE], NOW)).toMatchObject({ date: '2016-01-01', source: 'url' });
  });

  it('thử lần lượt các URL (URL thật rồi canonical)', () => {
    const urls = ['https://example.com/bai-viet', 'https://example.com/2016/01/01/bai-viet'];
    expect(extractDateFromDocument(doc(''), urls, NOW)?.date).toBe('2016-01-01');
  });

  it('không có thông tin ngày thì trả null', () => {
    expect(extractDateFromDocument(doc('<title>x</title>', '<p>Nội dung</p>'), ['https://example.com/a'], NOW)).toBeNull();
  });
});

describe('5–6. Wayback và snippet (ước lượng)', () => {
  it('timestamp Wayback yyyyMMddHHmmss (UTC)', () => {
    expect(fromWaybackTimestamp('20190512103000', NOW)).toMatchObject({
      date: '2019-05-12',
      timestamp: Date.UTC(2019, 4, 12, 10, 30),
      source: 'wayback',
      estimated: true,
    });
    expect(fromWaybackTimestamp('abc', NOW)).toBeNull();
  });

  it.each([
    ['12 thg 5, 2019', '2019-05-12'],
    ['May 12, 2019', '2019-05-12'],
    ['3 ngày trước', '2026-10-10'],
    ['2 hours ago', '2026-10-13'],
    ['1 tuần trước', '2026-10-06'],
    ['Hôm qua', '2026-10-12'],
    ['2025年3月7日', '2025-03-07'],
    ['6天前', '2026-10-07'],
    ['2026.09.08.', '2026-09-08'],
    ['3일 전', '2026-10-10'],
    ['昨天', '2026-10-12'],
  ])('snippet "%s" → %s', (raw, expected) => {
    expect(parseSnippetDate(raw, NOW)).toMatchObject({ date: expected, source: 'snippet', estimated: true });
  });

  it('snippet rỗng hoặc không có ngày', () => {
    expect(parseSnippetDate(null, NOW)).toBeNull();
    expect(parseSnippetDate('Không có ngày', NOW)).toBeNull();
  });
});
