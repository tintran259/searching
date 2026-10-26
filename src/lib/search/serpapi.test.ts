import { describe, expect, it } from 'vitest';
import { createCache } from '../cache';
import { withCache } from './cached';
import { SerpApiProvider, toGoogleDate } from './serpapi';
import { SearchProviderError, type SearchProvider, type SearchResponse } from './types';

function stubFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const REQUEST = {
  query: '"Trần Văn A"',
  page: 1,
  dateRange: { start: '2019-01-01', end: '2019-12-31' },
  locale: { country: 'vn', language: 'vi' },
};

describe('SerpApiProvider', () => {
  it('gửi đúng tham số: engine, q, tbs theo năm, start theo trang, gl/hl/google_domain', async () => {
    const { calls, fetchImpl } = stubFetch({ organic_results: [] });
    await new SerpApiProvider('KEY', fetchImpl).search(REQUEST);
    const url = new URL(calls[0]);
    expect(`${url.origin}${url.pathname}`).toBe('https://serpapi.com/search.json');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      engine: 'google',
      q: '"Trần Văn A"',
      start: '10',
      nfpr: '1',
      api_key: 'KEY',
      gl: 'vn',
      google_domain: 'google.com.vn',
      hl: 'vi',
      tbs: 'cdr:1,cd_min:1/1/2019,cd_max:12/31/2019',
    });
  });

  it('trang đầu không gửi start (start=0 làm Google bỏ qua site: và cụm trong ngoặc kép)', async () => {
    const { calls, fetchImpl } = stubFetch({ organic_results: [] });
    await new SerpApiProvider('KEY', fetchImpl).search({ ...REQUEST, page: 0 });
    expect(new URL(calls[0]).searchParams.has('start')).toBe(false);
  });

  it('tên miền Google theo quốc gia; chỉ lọc ngôn ngữ (lr) với ngôn ngữ Google hỗ trợ', async () => {
    const urlFor = async (locale: { country: string; language: string; onlyLanguage?: string }) => {
      const { calls, fetchImpl } = stubFetch({ organic_results: [] });
      await new SerpApiProvider('KEY', fetchImpl).search({ ...REQUEST, locale });
      return new URL(calls[0]).searchParams;
    };
    const ru = await urlFor({ country: 'ru', language: 'ru', onlyLanguage: 'ru' });
    expect([ru.get('google_domain'), ru.get('lr')]).toEqual(['google.ru', 'lang_ru']);
    const th = await urlFor({ country: 'th', language: 'th', onlyLanguage: 'th' });
    expect([th.get('google_domain'), th.get('lr')]).toEqual(['google.co.th', 'lang_th']);
    const lo = await urlFor({ country: 'la', language: 'lo', onlyLanguage: 'lo' });
    expect([lo.get('google_domain'), lo.has('lr')]).toEqual(['google.la', false]);
    const us = await urlFor({ country: 'us', language: 'en' });
    expect([us.get('google_domain'), us.has('lr')]).toEqual(['google.com', false]);
  });

  it('Baidu, Yandex, Naver: tham số riêng của từng engine', async () => {
    const paramsFor = async (engine: 'baidu' | 'yandex' | 'naver', onlyLanguage?: string) => {
      const { calls, fetchImpl } = stubFetch({ organic_results: [] });
      await new SerpApiProvider('KEY', fetchImpl).search({ ...REQUEST, engine, query: '"陈文A"', locale: { onlyLanguage } });
      return Object.fromEntries(new URL(calls[0]).searchParams);
    };
    expect(await paramsFor('baidu', 'zh-CN')).toEqual({
      engine: 'baidu',
      q: '"陈文A"',
      pn: '10',
      ct: '2',
      gpc: 'stf=1546272000,1577807999|stftype=1', // 01/01/2019 00:00 → 31/12/2019 23:59:59 giờ Bắc Kinh
      api_key: 'KEY',
    });
    expect(await paramsFor('yandex')).toEqual({
      engine: 'yandex',
      text: '"陈文A"',
      yandex_domain: 'yandex.ru',
      lang: 'ru',
      p: '1',
      api_key: 'KEY',
    });
    expect(await paramsFor('naver')).toEqual({
      engine: 'naver',
      query: '"陈文A"',
      where: 'news',
      page: '2',
      start: '11',
      period: 'from20190101to20191231',
      api_key: 'KEY',
    });
  });

  it('Naver đọc mục news_results; Baidu đổi link chuyển hướng ra URL thật', async () => {
    const { fetchImpl: naverFetch } = stubFetch({
      news_results: [{ position: 1, title: '기사', link: 'https://www.yna.co.kr/view/1', snippet: '…', news_info: { news_date: '2019.05.12.' } }],
    });
    const naver = await new SerpApiProvider('KEY', naverFetch).search({ ...REQUEST, engine: 'naver' });
    expect(naver.items).toEqual([{ url: 'https://www.yna.co.kr/view/1', title: '기사', snippet: '…', dateText: '2019.05.12.', position: 1 }]);

    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('http://www.baidu.com/link?url=abc')) {
        return new Response(null, { status: 302, headers: { Location: 'https://news.sina.com.cn/a.shtml' } });
      }
      if (url.startsWith('http://www.baidu.com/link?url=js')) {
        return new Response(`<script>window.location.replace("https://www.163.com/b.html")</script>`, { status: 200 });
      }
      return Response.json({
        organic_results: [
          { title: '1', link: 'http://www.baidu.com/link?url=abc' },
          { title: '2', link: 'http://www.baidu.com/link?url=js' },
          { title: '3', link: 'https://www.zaobao.com.sg/c.html' },
        ],
      });
    }) as typeof fetch;
    const baidu = await new SerpApiProvider('KEY', fetchImpl).search({ ...REQUEST, engine: 'baidu' });
    expect(baidu.items.map((i) => i.url)).toEqual([
      'https://news.sina.com.cn/a.shtml',
      'https://www.163.com/b.html',
      'https://www.zaobao.com.sg/c.html',
    ]);
  });

  it('chuyển organic_results thành kết quả, lấy ngày từ trường date hoặc đầu snippet', async () => {
    const { fetchImpl } = stubFetch({
      organic_results: [
        { position: 11, title: 'Bài 1', link: 'https://vnexpress.net/a.html', snippet: 'Ông Trần Văn A…', date: '12 thg 5, 2019' },
        { position: 12, title: 'Bài 2', link: 'https://tuoitre.vn/b.htm', snippet: '3 thg 4, 2019 — Trần Văn A nói…' },
        { position: 13, title: 'Không có link' },
      ],
      serpapi_pagination: { next: 'https://serpapi.com/search.json?start=20' },
    });
    const res = await new SerpApiProvider('KEY', fetchImpl).search(REQUEST);
    expect(res.hasMore).toBe(true);
    expect(res.items).toEqual([
      { url: 'https://vnexpress.net/a.html', title: 'Bài 1', snippet: 'Ông Trần Văn A…', dateText: '12 thg 5, 2019', position: 11 },
      { url: 'https://tuoitre.vn/b.htm', title: 'Bài 2', snippet: '3 thg 4, 2019 — Trần Văn A nói…', dateText: '3 thg 4, 2019', position: 12 },
    ]);
  });

  it('mục Tin tức của Google: tbm=nws, đọc news_results kèm tên báo và thời điểm đăng', async () => {
    const { calls, fetchImpl } = stubFetch({
      news_results: [
        {
          position: 1,
          title: 'Top leader To Lam to visit Denmark, EU, Belgium',
          link: 'https://english.vov.vn/en/politics/post1.vov',
          source: 'VOV.VN',
          date: '4 days ago',
          published_at: '2026-10-15 10:37:00 UTC',
          snippet: 'General Secretary…',
        },
      ],
      serpapi_pagination: { next: 'https://serpapi.com/search.json?start=10' },
    });
    const res = await new SerpApiProvider('KEY', fetchImpl).search({ ...REQUEST, vertical: 'news' });
    const params = new URL(calls[0]).searchParams;
    expect([params.get('tbm'), params.get('tbs'), params.get('start')]).toEqual(['nws', 'cdr:1,cd_min:1/1/2019,cd_max:12/31/2019', '10']);
    expect(res.items).toEqual([
      {
        url: 'https://english.vov.vn/en/politics/post1.vov',
        title: 'Top leader To Lam to visit Denmark, EU, Belgium',
        snippet: 'General Secretary…',
        dateText: '4 days ago',
        position: 1,
        sourceName: 'VOV.VN',
        publishedAt: '2026-10-15 10:37:00 UTC',
      },
    ]);
    expect(res.hasMore).toBe(true);
  });

  it('link "/goto?url=…" (Google ẩn URL thật): lấy URL thật từ link chuyển hướng; không lấy được thì bỏ kết quả', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://serpapi.com/')) {
        return Response.json({
          organic_results: [
            { position: 1, title: 'VNA', link: '/goto?url=CAES1', redirect_link: 'https://www.google.com/url?sa=t&url=CAES1' },
            { position: 2, title: 'Instagram', link: 'https://www.instagram.com/p/DewGQ9Kktw3/' },
            { position: 3, title: 'Không lấy được', link: '/goto?url=CAES3', redirect_link: 'https://www.google.com/url?sa=t&url=CAES3' },
            { position: 4, title: 'Không có link chuyển hướng', link: '/goto?url=CAES4' },
          ],
        });
      }
      // Trang chuyển hướng của Google: URL đích nằm trong nội dung, không có header Location
      if (url.endsWith('CAES1')) {
        return new Response('<meta content="0;url=x"><a href="https://www.facebook.com/VNAEnglish/posts/123?a=1&amp;b=2">', { status: 200 });
      }
      return new Response('<html>Google</html>', { status: 200 });
    }) as typeof fetch;
    const res = await new SerpApiProvider('KEY', fetchImpl).search(REQUEST);
    expect(res.items.map((i) => [i.url, i.title])).toEqual([
      ['https://www.facebook.com/VNAEnglish/posts/123?a=1&b=2', 'VNA'],
      ['https://www.instagram.com/p/DewGQ9Kktw3/', 'Instagram'],
    ]);
  });

  it('không có trang tiếp theo thì hasMore = false', async () => {
    const { fetchImpl } = stubFetch({ organic_results: [{ link: 'https://a.vn/x' }] });
    expect((await new SerpApiProvider('KEY', fetchImpl).search(REQUEST)).hasMore).toBe(false);
  });

  it('"Google hasn\'t returned any results" là kết quả rỗng, không phải lỗi', async () => {
    const { fetchImpl } = stubFetch({ error: "Google hasn't returned any results for this query." });
    const res = await new SerpApiProvider('KEY', fetchImpl).search(REQUEST);
    expect(res).toMatchObject({ items: [], hasMore: false });
  });

  it.each([
    [401, 'Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key', true],
    [429, 'Your account has run out of searches.', true],
    [500, 'Internal error', false],
  ])('HTTP %i → SearchProviderError (fatal = %s)', async (status, error, fatal) => {
    const { fetchImpl } = stubFetch({ error }, status);
    const promise = new SerpApiProvider('KEY', fetchImpl).search(REQUEST);
    await expect(promise).rejects.toBeInstanceOf(SearchProviderError);
    await expect(promise).rejects.toMatchObject({ fatal });
  });

  it('định dạng ngày cho tbs', () => {
    expect(toGoogleDate('2010-01-01')).toBe('1/1/2010');
    expect(toGoogleDate('2010-12-31')).toBe('12/31/2010');
  });
});

describe('withCache', () => {
  it('lần gọi thứ hai cùng truy vấn lấy từ cache, không gọi provider', async () => {
    let calls = 0;
    const provider: SearchProvider = {
      id: 'stub',
      async search() {
        calls++;
        return { items: [], hasMore: false, searchedAt: '2026-01-01T00:00:00.000Z' };
      },
    };
    const cached = withCache(provider, createCache<SearchResponse>(`test-${Date.now()}`, { ttlMs: 60_000, mode: 'memory' }));
    expect((await cached.search(REQUEST)).fromCache).toBeFalsy();
    expect((await cached.search(REQUEST)).fromCache).toBe(true);
    expect(calls).toBe(1);
    await cached.search({ ...REQUEST, page: 2 });
    expect(calls).toBe(2);
  });

  it('không cache lỗi', async () => {
    let calls = 0;
    const provider: SearchProvider = {
      id: 'stub',
      async search() {
        calls++;
        throw new SearchProviderError('lỗi tạm thời', false);
      },
    };
    const cached = withCache(provider, createCache<SearchResponse>(`test-err-${Date.now()}`, { ttlMs: 60_000, mode: 'memory' }));
    await expect(cached.search(REQUEST)).rejects.toThrow();
    await expect(cached.search(REQUEST)).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
