import { describe, expect, it } from 'vitest';
import { cleanUrl, normalizeUrl, siteOf } from './url-normalize';

describe('normalizeUrl — khoá gộp trùng', () => {
  it('bỏ utm_*, fbclid, gclid', () => {
    expect(normalizeUrl('https://vnexpress.net/bai-viet-123.html?utm_source=fb&utm_medium=social&fbclid=IwAR0x')).toBe(
      'vnexpress.net/bai-viet-123.html',
    );
    expect(normalizeUrl('https://vnexpress.net/bai-viet-123.html?gclid=abc&utm_campaign=z')).toBe(
      'vnexpress.net/bai-viet-123.html',
    );
  });

  it('giữ tham số có nghĩa và sắp xếp lại', () => {
    expect(normalizeUrl('https://example.com/a?b=2&utm_term=x&a=1')).toBe('example.com/a?a=1&b=2');
    expect(normalizeUrl('https://example.com/a?a=1&b=2')).toBe(normalizeUrl('https://example.com/a?b=2&a=1'));
  });

  it('coi http/https và có/không www là một', () => {
    const key = 'tuoitre.vn/bai-viet-2019051210304512.htm';
    expect(normalizeUrl('http://tuoitre.vn/bai-viet-2019051210304512.htm')).toBe(key);
    expect(normalizeUrl('https://www.tuoitre.vn/bai-viet-2019051210304512.htm')).toBe(key);
    expect(normalizeUrl('https://WWW.TUOITRE.VN/bai-viet-2019051210304512.htm')).toBe(key);
  });

  it('bỏ dấu / cuối và #hash', () => {
    expect(normalizeUrl('https://example.com/news/abc/')).toBe('example.com/news/abc');
    expect(normalizeUrl('https://example.com/news/abc#binh-luan')).toBe('example.com/news/abc');
    expect(normalizeUrl('https://example.com/')).toBe('example.com');
  });

  it.each([
    'https://example.com/news/abc/amp',
    'https://example.com/news/abc/amp/',
    'https://example.com/amp/news/abc',
    'https://amp.example.com/news/abc',
    'https://m.example.com/news/abc',
    'https://example.com/news/abc?amp',
    'https://example.com/news/abc?amp=1',
    'https://example.com/news/abc?outputType=amp',
    'https://www-example-com.cdn.ampproject.org/c/s/www.example.com/news/abc',
    'https://www.google.com/amp/s/www.example.com/news/abc/amp',
  ])('gộp bản AMP / mobile: %s', (url) => {
    expect(normalizeUrl(url)).toBe('example.com/news/abc');
  });

  it('gộp dạng .amp.html', () => {
    expect(normalizeUrl('https://example.com/news/abc.amp.html')).toBe(normalizeUrl('https://example.com/news/abc.html'));
  });

  it('chuẩn hoá percent-encoding', () => {
    expect(normalizeUrl('https://vi.wikipedia.org/wiki/Trần_Văn_A')).toBe(
      normalizeUrl('https://vi.wikipedia.org/wiki/Tr%e1%ba%a7n_V%c4%83n_A'),
    );
  });

  it('URL khác nhau thì khoá khác nhau', () => {
    expect(normalizeUrl('https://example.com/a')).not.toBe(normalizeUrl('https://example.com/b'));
    expect(normalizeUrl('https://example.com/a?id=1')).not.toBe(normalizeUrl('https://example.com/a?id=2'));
    expect(normalizeUrl('https://example.com/a')).not.toBe(normalizeUrl('https://example.org/a'));
    expect(normalizeUrl('https://example.com/News')).not.toBe(normalizeUrl('https://example.com/news'));
  });

  it('chuỗi không phải URL http(s)', () => {
    expect(normalizeUrl(' Không Phải URL ')).toBe('không phải url');
    expect(normalizeUrl('ftp://example.com/a')).toBe('ftp://example.com/a');
  });
});

describe('cleanUrl — URL để tải / hiển thị', () => {
  it('bỏ tham số theo dõi và #hash nhưng giữ host, giao thức, tham số khác', () => {
    expect(cleanUrl('http://www.example.com/a?id=5&utm_source=x#top')).toBe('http://www.example.com/a?id=5');
    expect(cleanUrl('https://example.com/a?utm_source=x')).toBe('https://example.com/a');
  });

  it('không đụng tới query khi không có gì cần bỏ', () => {
    expect(cleanUrl('https://example.com/search?q=a+b&x=%20')).toBe('https://example.com/search?q=a+b&x=%20');
  });

  it('bóc URL gốc từ AMP cache', () => {
    expect(cleanUrl('https://www-example-com.cdn.ampproject.org/c/s/www.example.com/news/abc?x=1')).toBe(
      'https://www.example.com/news/abc?x=1',
    );
  });
});

describe('siteOf', () => {
  it('bỏ tiền tố www/m/amp', () => {
    expect(siteOf('https://m.vnexpress.net/a')).toBe('vnexpress.net');
    expect(siteOf('https://www.vnexpress.net/a')).toBe('vnexpress.net');
    expect(siteOf('https://e.vnexpress.net/a')).toBe('e.vnexpress.net');
    expect(siteOf('không phải url')).toBe('');
  });
});
