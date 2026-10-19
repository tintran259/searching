import { describe, expect, it } from 'vitest';
import { classifyRegion, domesticDomainsOutsideVn, hostnameOf, isNonArticleUrl, sourceNameOf } from './region';

describe('classifyRegion', () => {
  it.each([
    'https://vnexpress.net/bai-viet-123.html',
    'https://e.vnexpress.net/news/abc',
    'https://www.baomoi.com/abc/c/123.epi',
    'https://tuoitre.vn/abc.htm',
    'https://dantri.com.vn/abc.htm',
    'https://moit.gov.vn/tin-tuc/abc',
    'https://abc.edu.vn/x',
  ])('Trong nước: %s', (url) => {
    expect(classifyRegion(url)).toBe('domestic');
  });

  it.each([
    'https://www.bbc.com/vietnamese/articles/c123',
    'https://www.bbc.com/news/world-asia-123',
    'https://www.rfa.org/vietnamese/news/abc.html',
    'https://www.voatiengviet.com/a/abc/123.html',
    'https://www.rfi.fr/vi/viet-nam/20190512-abc',
    'https://sputniknews.vn/20190512/abc.html',
    'https://www.nytimes.com/2019/05/12/world/asia/abc.html',
    'https://notvnexpress.net/abc',
    'https://vn.yahoo.com/abc',
  ])('Ngoài nước: %s', (url) => {
    expect(classifyRegion(url)).toBe('foreign');
  });

  it('URL hỏng coi là Ngoài nước', () => {
    expect(classifyRegion('không phải url')).toBe('foreign');
  });
});

describe('sourceNameOf / hostnameOf / isNonArticleUrl', () => {
  it('lấy tên báo theo cấu hình, khớp cả đường dẫn', () => {
    expect(sourceNameOf('https://www.bbc.com/vietnamese/articles/c123')).toBe('BBC News Tiếng Việt');
    expect(sourceNameOf('https://www.bbc.com/news/world')).toBeNull();
    expect(sourceNameOf('https://www.rfi.fr/vietnam/abc')).toBeNull();
    expect(sourceNameOf('https://tuoitre.vn/abc')).toBe('Tuổi Trẻ');
    expect(sourceNameOf('https://e.vnexpress.net/news/abc')).toBe('VnExpress');
  });

  it('hostnameOf bỏ www', () => {
    expect(hostnameOf('https://www.Dantri.com.vn/a')).toBe('dantri.com.vn');
  });

  it('nhận diện mạng xã hội / nền tảng video', () => {
    expect(isNonArticleUrl('https://www.facebook.com/abc/posts/1')).toBe(true);
    expect(isNonArticleUrl('https://m.facebook.com/story.php?id=1')).toBe(true);
    expect(isNonArticleUrl('https://youtu.be/abc')).toBe(true);
    expect(isNonArticleUrl('https://x.com/abc/status/1')).toBe(true);
    expect(isNonArticleUrl('https://box.com/abc')).toBe(false);
    expect(isNonArticleUrl('https://vnexpress.net/abc')).toBe(false);
  });

  it('liệt kê báo VN không đuôi .vn để loại khi tìm Ngoài nước', () => {
    const domains = domesticDomainsOutsideVn();
    expect(domains).toContain('vnexpress.net');
    expect(domains).toContain('baomoi.com');
    expect(domains.every((d) => !d.endsWith('.vn'))).toBe(true);
  });
});
