import { describe, expect, it } from 'vitest';
import { FetchError } from './fetcher';
import { parsePage, type ParsedPage } from './page-parser';
import { runPipeline, type PipelineDeps } from './pipeline';
import { SearchProviderError, type SearchProvider, type SearchRequest, type SearchResultItem } from './search/types';
import { TranslationError, type Translator } from './translate/types';
import { sortArticles } from './sort';
import type { ArticleResult, ExtractedDate, PipelineEvent, RejectedItem, SearchParams } from './types';

const NOW = new Date('2026-10-13T12:00:00+07:00');
const SEARCHED_AT = '2026-10-13T05:00:00.000Z';
const FILLER =
  'Theo báo cáo của sở, dự án đã hoàn thành đúng tiến độ với sự tham gia của nhiều đơn vị trong và ngoài tỉnh. ' +
  'Người dân địa phương cho biết cuộc sống đã thay đổi rõ rệt kể từ khi công trình được đưa vào sử dụng.';

function html({ lead, head = '', aside = '', extra = '' }: { lead: string; head?: string; aside?: string; extra?: string }) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Bài viết</title>${head}</head><body>
    <header><nav><a href="/">Trang chủ</a></nav></header>
    <main><article><h1>Bài viết</h1>${extra}<p>${lead}</p><p>${FILLER}</p><p>${FILLER}</p><p>${FILLER}</p></article></main>
    <aside><h3>Tin liên quan</h3><ul><li>${aside || 'Tin khác'}</li></ul></aside>
    <footer>Bản quyền © Báo điện tử</footer></body></html>`;
}

const page = (url: string, h: string, finalUrl = url) => [url, parsePage(h, finalUrl, NOW)] as const;

const PAGES = new Map<string, ParsedPage | FetchError>([
  page('https://dantri.com.vn/xa-hoi/du-an-20100105101010123.htm', html({ lead: 'ÔNG TRẦN VĂN A phát biểu tại buổi lễ.' })),
  page('https://tuoitre.vn/ong-tran-van-anh-2012010110101012.htm', html({ lead: 'Ông Trần Văn Anh, giám đốc sở, cho biết.' })),
  page('https://www.nytimes.com/2010/01/01/world/asia/engineer.html', html({ lead: 'Mr. A Tran Van, an engineer, said the bridge is done.' })),
  page('https://nld.com.vn/thoi-su/bai-khong-ngay.htm', html({ lead: 'Ông Trần Văn A nhận bằng khen.' })),
  ['https://thanhnien.vn/loi-404.htm', new FetchError('http', 'HTTP 404')],
  page(
    'https://vnexpress.net/ong-tran-van-a-nhan-giai-3923456.html',
    html({ lead: 'Ông Trần Văn A nhận giải thưởng.', head: '<meta property="article:published_time" content="2015-03-02T08:00:00+07:00">' }),
  ),
  page('https://kenh14.vn/tin-khac.chn', html({ lead: 'Một tin hoàn toàn khác.', aside: 'Trần Văn A được khen thưởng' })),
  page('https://laodong.vn/bai-viet.ldo', html({ lead: 'Trần Văn A, kỹ sư trưởng.' })),
  page('https://baomoi.com/redirect.epi', html({ lead: 'Trần Văn A nói về dự án.' }), 'https://www.bbc.com/news/world-asia-1'),
  page(
    'https://soha.vn/bai-cu.htm',
    html({ lead: 'Trần Văn A thời trẻ.', head: '<meta property="article:published_time" content="2005-02-02T08:00:00+07:00">' }),
  ),
  ...['https://vtv.vn/bai-canonical.htm', 'https://vtv.vn/bai-goc.htm?ref=home'].map((url) =>
    page(
      url,
      html({
        lead: 'Phóng sự về Trần Văn A.',
        head: '<link rel="canonical" href="https://vtv.vn/bai-goc.htm">',
        extra: '<time datetime="2014-07-07T09:00:00+07:00">7/7/2014</time>',
      }),
    ),
  ),
  ['https://vietnamnet.vn/robots.html', new FetchError('robots', 'robots.txt không cho phép tải trang này')],
  page(
    'https://plo.vn/a-moi.html',
    html({
      lead: 'Luật sư Trần Văn A tư vấn.',
      head: '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2013-02-03T07:00:00+07:00"}</script>',
    }),
  ),
  page('https://e.vnexpress.net/news/tran-van-a-4000000.html', html({ lead: 'Engineer Tran Van A finished the bridge.' })),
  page('https://hanoimoi.vn/khong-ngay.htm', html({ lead: 'Gặp gỡ Trần Văn A.' })),
]);

const item = (url: string, dateText: string | null = null): SearchResultItem => ({ url, title: url, snippet: '', dateText, position: 1 });

/** Kết quả giả lập theo trang (tìm trên cả khoảng ngày); trang 4 lỗi tạm thời */
const SEARCH_PAGES: { items: SearchResultItem[]; hasMore: boolean }[] = [
  {
    hasMore: true,
    items: [
      item('https://dantri.com.vn/xa-hoi/du-an-20100105101010123.htm'),
      item('https://tuoitre.vn/ong-tran-van-anh-2012010110101012.htm'),
      item('https://www.nytimes.com/2010/01/01/world/asia/engineer.html'),
      item('https://www.facebook.com/tranvana/posts/1'),
      item('https://nld.com.vn/thoi-su/bai-khong-ngay.htm', '3 thg 4, 2011'),
      item('https://thanhnien.vn/loi-404.htm'),
      item('https://vnexpress.net/ong-tran-van-a-nhan-giai-3923456.html?utm_source=facebook&fbclid=x'),
    ],
  },
  {
    hasMore: true,
    items: [
      item('https://vnexpress.net/ong-tran-van-a-nhan-giai-3923456.html'),
      item('https://kenh14.vn/tin-khac.chn'),
      item('https://laodong.vn/bai-viet.ldo'),
      item('https://baomoi.com/redirect.epi'),
      item('https://soha.vn/bai-cu.htm'),
      item('https://vtv.vn/bai-canonical.htm'),
      item('https://vtv.vn/bai-goc.htm?ref=home'),
      item('https://vietnamnet.vn/robots.html'),
    ],
  },
  {
    hasMore: true,
    items: [
      item('https://plo.vn/a-moi.html'),
      item('https://e.vnexpress.net/news/tran-van-a-4000000.html'),
      item('https://hanoimoi.vn/khong-ngay.htm'),
    ],
  },
];

function makeProvider(failPage?: number) {
  const calls: SearchRequest[] = [];
  const provider: SearchProvider = {
    id: 'stub',
    async search(request) {
      calls.push(request);
      if (request.page === failPage) throw new SearchProviderError('SerpApi: Internal error', false);
      const page = SEARCH_PAGES[request.page] ?? { items: [], hasMore: false };
      return { ...page, searchedAt: SEARCHED_AT };
    },
  };
  return { provider, calls };
}

const WAYBACK: Record<string, ExtractedDate> = {
  'https://laodong.vn/bai-viet.ldo': {
    date: '2013-06-01',
    timestamp: Date.UTC(2013, 5, 1),
    source: 'wayback',
    raw: '20130601000000',
    estimated: true,
  },
};

function makeDeps(provider: SearchProvider, extra: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    provider,
    async loadPage(url) {
      const p = PAGES.get(url);
      if (!p) throw new FetchError('http', 'HTTP 404');
      if (p instanceof Error) throw p;
      return p;
    },
    async lookupWayback(url) {
      return WAYBACK[url] ?? null;
    },
    ...extra,
  };
}

async function run(params: Partial<SearchParams> = {}, deps?: PipelineDeps, signal?: AbortSignal) {
  const full: SearchParams = { query: '`Trần Văn A`', region: 'domestic', fromDate: '2010-01-01', toDate: '2015-12-31', pagesPerSource: 4, languages: [], localEngines: false, ...params };
  const events: PipelineEvent[] = [];
  const { provider, calls } = makeProvider(3);
  const final = await runPipeline(full, deps ?? makeDeps(provider), (e) => events.push(e), signal);
  const results = events.flatMap((e) => (e.type === 'result' ? [e.item] : []));
  const rejected = events.flatMap((e) => (e.type === 'rejected' ? [e.item] : []));
  return { events, results, rejected, final, calls };
}

const byUrl = <T extends ArticleResult | RejectedItem>(items: T[]): Record<string, T> =>
  Object.fromEntries(items.map((i) => [i.url, i]));

describe('runPipeline — Trong nước', () => {
  it('chỉ nhận trang chứa đúng cụm và xác nhận được ngày đăng, sắp xếp cũ → mới', async () => {
    const { results } = await run();
    const sorted = sortArticles(results);
    expect(sorted.map((r) => [r.url, r.date?.date ?? null, r.date?.source ?? null])).toEqual([
      ['https://dantri.com.vn/xa-hoi/du-an-20100105101010123.htm', '2010-01-05', 'url'],
      ['https://nld.com.vn/thoi-su/bai-khong-ngay.htm', '2011-04-03', 'snippet'],
      ['https://plo.vn/a-moi.html', '2013-02-03', 'jsonld'],
      ['https://laodong.vn/bai-viet.ldo', '2013-06-01', 'wayback'],
      ['https://vtv.vn/bai-goc.htm', '2014-07-07', 'time'],
      ['https://vnexpress.net/ong-tran-van-a-nhan-giai-3923456.html', '2015-03-02', 'meta'],
    ]);
    expect(sortArticles(results, 'desc').map((r) => r.date?.date ?? null)).toEqual([
      '2015-03-02', '2014-07-07', '2013-06-01', '2013-02-03', '2011-04-03', '2010-01-05',
    ]);
  });

  it('không kết quả nào chứa tên dài hơn; đoạn trích highlight đúng cụm', async () => {
    const { results } = await run();
    for (const r of results) {
      expect(r.snippet).not.toMatch(/Trần Văn An/i);
      expect(r.highlights.map((h) => [r.snippet.slice(h.start, h.end).toLowerCase(), h.kind])).toEqual([['trần văn a', 'required']]);
      expect(r).toMatchObject({ region: 'domestic', loose: false, optionalMatch: null });
    }
    expect(byUrl(results)['https://dantri.com.vn/xa-hoi/du-an-20100105101010123.htm']).toMatchObject({
      sourceName: 'Dân trí',
      domain: 'dantri.com.vn',
      foundLanguage: 'vi',
      foundVia: 'google',
    });
  });

  it('liệt kê bài bị loại kèm lý do', async () => {
    const { rejected } = await run();
    const reasons = Object.fromEntries(rejected.map((r) => [r.url, r.reason]));
    expect(reasons).toEqual({
      'https://tuoitre.vn/ong-tran-van-anh-2012010110101012.htm': 'no_match',
      'https://www.nytimes.com/2010/01/01/world/asia/engineer.html': 'region',
      'https://www.facebook.com/tranvana/posts/1': 'non_article',
      'https://thanhnien.vn/loi-404.htm': 'fetch_error',
      'https://kenh14.vn/tin-khac.chn': 'outside_main',
      'https://baomoi.com/redirect.epi': 'region',
      'https://soha.vn/bai-cu.htm': 'out_of_range',
      'https://vietnamnet.vn/robots.html': 'robots',
      'https://e.vnexpress.net/news/tran-van-a-4000000.html': 'no_match',
      'https://hanoimoi.vn/khong-ngay.htm': 'no_date', // không đọc được ngày ở đâu cả
    });
    const details = byUrl(rejected);
    expect(details['https://tuoitre.vn/ong-tran-van-anh-2012010110101012.htm'].detail).toContain('Trần Văn Anh');
    expect(details['https://thanhnien.vn/loi-404.htm'].detail).toBe('HTTP 404');
    expect(details['https://baomoi.com/redirect.epi'].detail).toContain('bbc.com');
    expect(details['https://soha.vn/bai-cu.htm'].detail).toContain('02/02/2005');
  });

  it('gộp trùng theo URL chuẩn hoá và canonical; đếm tiến trình khớp', async () => {
    const { final, events, results } = await run();
    expect(results.filter((r) => r.url === 'https://vtv.vn/bai-goc.htm')).toHaveLength(1);
    expect(final).toMatchObject({
      phase: 'done',
      candidates: 17,
      toVerify: 15,
      verified: 15,
      accepted: 6,
      rejected: 10,
      duplicates: 2,
      searchCalls: 3,
      sourcesDone: 1,
      totalSources: 1,
    });
    expect(events[0].type).toBe('start');
    expect(events.at(-1)).toMatchObject({ type: 'done', aborted: false });
    expect(events.filter((e) => e.type === 'warning')).toEqual([
      { type: 'warning', message: 'Tiếng Việt, trang 4: SerpApi: Internal error' },
    ]);
  });

  it('mỗi nguồn lấy tối đa N trang trên cả khoảng ngày, truy vấn bọc ngoặc kép', async () => {
    const { calls } = await run();
    expect(calls.map((c) => `${c.dateRange!.start}..${c.dateRange!.end}/${c.page}`)).toEqual([
      '2010-01-01..2015-12-31/0',
      '2010-01-01..2015-12-31/1',
      '2010-01-01..2015-12-31/2',
      '2010-01-01..2015-12-31/3',
    ]);
    expect(calls[0]).toMatchObject({ query: '"Trần Văn A"', locale: { country: 'vn', language: 'vi' } });
  });

  it('báo cáo nguồn: yêu cầu, tìm được, hợp lệ / bị loại / trùng, lỗi giữa chừng', async () => {
    const { final } = await run();
    expect(final.sources).toEqual([
      {
        id: 'vi:google',
        language: 'vi',
        engine: 'google',
        query: '"Trần Văn A"',
        requested: 40,
        returned: 18,
        exhausted: false,
        accepted: 6,
        rejected: 10,
        duplicates: 2,
        status: 'failed',
        error: 'SerpApi: Internal error',
      },
    ]);
    // Hết kết quả trước khi đủ số yêu cầu
    const short = await run({ pagesPerSource: 10 }, makeDeps(makeProvider().provider));
    expect(short.final.sources[0]).toMatchObject({ requested: 100, returned: 18, exhausted: true, status: 'done' });
  });
});

describe('runPipeline — Ngoài nước', () => {
  it('chỉ tìm bằng ngôn ngữ đã chọn (không tìm tiếng Việt), kết quả khác Trong nước, khớp biến thể đảo thứ tự', async () => {
    const domestic = await run();
    const { provider, calls } = makeProvider(3);
    const english: Translator = {
      id: 'stub',
      async translate(_phrase, languages) {
        return languages.map((l) => ({ language: l.code, variants: ['Tran Van A'] }));
      },
    };
    const foreign = await run({ region: 'foreign', languages: ['en'] }, makeDeps(provider, { translator: english }));
    // Chỉ một nguồn: tiếng Anh; nhóm tiếng Việt chỉ dùng để xác minh (biến thể "A Tran Van")
    expect(new Set(calls.map((c) => c.locale?.onlyLanguage))).toEqual(new Set(['en']));
    expect(foreign.final.sources.map((r) => r.id)).toEqual(['en:google']);
    expect(foreign.results.map((r) => [r.url, r.matchedVariant, r.region, r.date?.date])).toEqual([
      ['https://www.nytimes.com/2010/01/01/world/asia/engineer.html', 'A Tran Van', 'foreign', '2010-01-01'],
    ]);
    expect(foreign.results[0].foundLanguage).toBe('en');
    const domesticUrls = new Set(domestic.results.map((r) => r.url));
    expect(foreign.results.some((r) => domesticUrls.has(r.url))).toBe(false);
    expect(byUrl(foreign.rejected)['https://vnexpress.net/ong-tran-van-a-nhan-giai-3923456.html?utm_source=facebook&fbclid=x'].reason).toBe('region');
    // Có dịch thì sự kiện đầu là tiến trình "đang dịch", sau đó mới tới "start"
    const start = foreign.events.find((e) => e.type === 'start');
    expect(start?.type === 'start' && start.plan.groups[0].searchQuery).toMatch(/^"Trần Văn A" OR "Tran Van A" OR "A Tran Van" OR "Van A Tran" -site:vn /);
    expect(calls[0].query).toMatch(/^"Tran Van A" -site:vn /);
  });
});

describe('runPipeline — lỗi, dừng và giới hạn song song', () => {
  it('lỗi nghiêm trọng ngay lần gọi đầu (vd sai API key) thì báo lỗi', async () => {
    const provider: SearchProvider = {
      id: 'stub',
      async search() {
        throw new SearchProviderError('SerpApi: Invalid API key.', true);
      },
    };
    await expect(run({}, makeDeps(provider))).rejects.toThrow('Invalid API key');
  });

  it('dừng giữa chừng: không tìm năm tiếp theo, sự kiện done có aborted = true', async () => {
    const controller = new AbortController();
    const { provider, calls } = makeProvider();
    const wrapped: SearchProvider = {
      id: 'stub',
      async search(request) {
        const res = await provider.search(request);
        controller.abort();
        return res;
      },
    };
    const { events } = await run({}, makeDeps(wrapped), controller.signal);
    expect(calls).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'done', aborted: true });
  });

  it('tải trang song song không quá giới hạn', async () => {
    let active = 0;
    let peak = 0;
    const { provider } = makeProvider();
    const base = makeDeps(provider);
    const deps = makeDeps(provider, {
      concurrency: 3,
      async loadPage(url, signal) {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return base.loadPage(url, signal);
      },
    });
    await run({}, deps);
    expect(peak).toBe(3);
  });
});

describe('runPipeline — tìm thêm bằng ngôn ngữ khác', () => {
  const ML_PAGES = new Map<string, ParsedPage>([
    page('https://ria.ru/20190512/chan-van-a.html', html({ lead: 'ЧАН ВАН А заявил журналистам о новом проекте.' })),
    page('https://ria.ru/20200101/chan-van-an.html', html({ lead: 'Чан Ван Ань заявил журналистам.' })),
    page('https://www.zaobao.com.sg/news/world/story20190601-1.html', html({ lead: '记者陈文A表示，项目已经完成。' })),
    page('https://www.zaobao.com.sg/news/world/story20200301-2.html', html({ lead: '另一位记者陈文A说明了情况。' })),
    page('https://news.sina.com.cn/w/2019-08-01/doc-1.shtml', html({ lead: '陈文A出席了会议。' })),
    page('https://lenta.ru/news/2019/09/01/chan/', html({ lead: 'Чан Ван А посетил Москву.' })),
  ]);

  function mlProvider() {
    const calls: SearchRequest[] = [];
    const provider: SearchProvider = {
      id: 'stub-ml',
      async search(request) {
        calls.push(request);
        let items: SearchResultItem[] = [];
        const hasMore = false;
        if (request.engine === 'baidu') {
          // Baidu: trang 1 còn trang sau, trang 2 hết
          items = request.page === 0 ? [item('https://news.sina.com.cn/w/2019-08-01/doc-1.shtml', '2019年8月1日')] : [];
          return { items, hasMore: request.page === 0, searchedAt: SEARCHED_AT };
        }
        if (request.engine === 'yandex') {
          items = request.page === 0 ? [item('https://lenta.ru/news/2019/09/01/chan/', '1 thg 9, 2019')] : [];
          return { items, hasMore: true, searchedAt: SEARCHED_AT };
        }
        if (request.query.includes('Чан Ван А') && request.page === 0) {
          items = [item('https://ria.ru/20190512/chan-van-a.html'), item('https://ria.ru/20200101/chan-van-an.html')];
        }
        if (request.query.includes('陈文A') && request.page === 0) {
          items = [
            item('https://www.zaobao.com.sg/news/world/story20190601-1.html', '2019年6月1日'),
            item('https://www.zaobao.com.sg/news/world/story20200301-2.html', '2020年3月1日'),
          ];
        }
        return { items, hasMore, searchedAt: SEARCHED_AT };
      },
    };
    return { provider, calls };
  }

  function stubTranslator(result: { language: string; variants: string[] }[] | Error) {
    const calls: string[][] = [];
    const translator: Translator = {
      id: 'stub',
      async translate(_phrase, languages) {
        calls.push(languages.map((l) => l.code));
        if (result instanceof Error) throw result;
        return result;
      },
    };
    return { translator, calls };
  }

  const TRANSLATIONS = [
    { language: 'en', variants: ['Tran Van A'] }, // trùng biến thể không dấu của nhóm tiếng Việt nhưng vẫn tìm riêng
    { language: 'ru', variants: ['Чан Ван А'] },
    { language: 'zh-CN', variants: ['陈文A'] },
    { language: 'th', variants: ['ตรัน วัน อา'] },
    { language: 'lo', variants: [] },
  ];

  async function runMl(translator: Translator | null, extra: Partial<SearchParams> = {}) {
    const { provider, calls } = mlProvider();
    const events: PipelineEvent[] = [];
    const params: SearchParams = {
      query: '`Trần Văn A`',
      region: 'foreign',
      fromDate: '2019-01-01',
      toDate: '2020-12-31',
      pagesPerSource: 1,
      languages: ['en', 'ru', 'zh-CN', 'th', 'lo'],
      localEngines: false,
      ...extra,
    };
    const deps: PipelineDeps = {
      provider,
      translator,
      async loadPage(url) {
        const p = ML_PAGES.get(url);
        if (!p) throw new FetchError('http', 'HTTP 404');
        return p;
      },
      async lookupWayback() {
        return null;
      },
    };
    const final = await runPipeline(params, deps, (e) => events.push(e), undefined);
    return {
      final,
      events,
      calls,
      results: events.flatMap((e) => (e.type === 'result' ? [e.item] : [])),
      rejected: events.flatMap((e) => (e.type === 'rejected' ? [e.item] : [])),
      warnings: events.flatMap((e) => (e.type === 'warning' ? [e.message] : [])),
      plan: events.flatMap((e) => (e.type === 'start' ? [e.plan] : []))[0],
    };
  }

  it('dịch rồi tìm riêng từng ngôn ngữ (kể cả khi cách viết trùng), mỗi ngôn ngữ một nguồn', async () => {
    const { translator, calls: translateCalls } = stubTranslator(TRANSLATIONS);
    const { calls, plan, warnings, final } = await runMl(translator);
    expect(translateCalls).toEqual([['en', 'ru', 'zh-CN', 'th', 'lo']]);
    expect(plan.groups.map((g) => g.language)).toEqual(['vi', 'en', 'ru', 'zh-CN', 'th']);
    expect(calls.map((c) => `${c.locale?.country}/${c.locale?.language}/${c.locale?.onlyLanguage ?? '-'}:${c.page}`)).toEqual([
      'us/en/en:0', // Ngoài nước không tìm bằng tiếng Việt
      'ru/ru/ru:0',
      'cn/zh-cn/zh-CN:0',
      'th/th/th:0',
    ]);
    expect(warnings).toEqual(['Không có bản dịch cho: Tiếng Lào.']);
    expect(final.sources.map((r) => [r.id, r.status, r.returned, r.accepted, r.rejected])).toEqual([
      ['en:google', 'done', 0, 0, 0],
      ['ru:google', 'done', 2, 1, 1],
      ['zh-CN:google', 'done', 2, 2, 0],
      ['th:google', 'done', 0, 0, 0],
      ['lo:google', 'untranslated', 0, 0, 0],
    ]);
  });

  it('kết quả ghi ngôn ngữ khớp và nguồn tìm ra; tên dài hơn bằng chữ Kirin vẫn bị loại', async () => {
    const { results, rejected, events } = await runMl(stubTranslator(TRANSLATIONS).translator);
    const rows = results.map((r) => [r.url, r.matchedLanguage, r.matchedVariant, r.foundLanguage, r.date?.date ?? null]);
    expect(rows.sort()).toEqual([
      ['https://ria.ru/20190512/chan-van-a.html', 'ru', 'Чан Ван А', 'ru', '2019-05-12'],
      ['https://www.zaobao.com.sg/news/world/story20190601-1.html', 'zh-CN', '陈文A', 'zh-CN', '2019-06-01'],
      ['https://www.zaobao.com.sg/news/world/story20200301-2.html', 'zh-CN', '陈文A', 'zh-CN', '2020-03-01'],
    ]);
    expect(sortArticles(results)[0].url).toBe('https://ria.ru/20190512/chan-van-a.html');
    expect(rejected.map((r) => [r.url, r.reason, r.detail, r.foundLanguage])).toEqual([
      ['https://ria.ru/20200101/chan-van-an.html', 'no_match', 'Không có cụm chính xác, trang chỉ có “Чан Ван Ань”', 'ru'],
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'done', progress: { duplicates: 0, accepted: 3, rejected: 1 } });
  });

  it('Ngoài nước: tìm thêm trên Baidu (tiếng Trung) và Yandex (tiếng Nga) khi bật, mỗi công cụ là một nguồn', async () => {
    const { calls, results, final } = await runMl(stubTranslator(TRANSLATIONS).translator, { localEngines: true, pagesPerSource: 2 });
    expect(calls.map((c) => `${c.engine}:${c.locale?.onlyLanguage ?? 'vi'}/${c.page}`)).toEqual([
      'google:en/0',
      'google:ru/0',
      'yandex:ru/0',
      'yandex:ru/1',
      'google:zh-CN/0',
      'baidu:zh-CN/0',
      'baidu:zh-CN/1',
      'google:th/0',
    ]);
    expect(calls.find((c) => c.engine === 'baidu')?.query).toBe('"陈文A"');
    const via = Object.fromEntries(results.map((r) => [r.url, r.foundVia]));
    expect(via).toMatchObject({
      'https://news.sina.com.cn/w/2019-08-01/doc-1.shtml': 'baidu',
      'https://lenta.ru/news/2019/09/01/chan/': 'yandex',
      'https://ria.ru/20190512/chan-van-a.html': 'google',
    });
    expect(final.sources.find((r) => r.id === 'ru:yandex')).toMatchObject({
      requested: 20,
      returned: 1,
      exhausted: true,
      accepted: 1,
    });
  });

  it('Trong nước thì không dùng Baidu / Yandex / Naver', async () => {
    const { calls } = await runMl(stubTranslator(TRANSLATIONS).translator, { localEngines: true, region: 'domestic' });
    expect(calls.every((c) => c.engine === 'google')).toBe(true);
  });

  it('Ngoài nước mà không dịch được: cảnh báo, không tìm (không tìm bằng tiếng Việt), báo cáo từng ngôn ngữ', async () => {
    const failed = await runMl(stubTranslator(new TranslationError('Claude API: API key không hợp lệ (ANTHROPIC_API_KEY)')).translator);
    expect(failed.plan.groups.map((g) => g.language)).toEqual(['vi']);
    expect(failed.warnings).toEqual([
      'Không dịch được từ khoá: Claude API: API key không hợp lệ (ANTHROPIC_API_KEY). Không có ngôn ngữ nào để tìm báo nước ngoài.',
    ]);
    expect(failed.calls).toHaveLength(0);
    expect(failed.final.sources.every((r) => r.status === 'untranslated')).toBe(true);

    const off = await runMl(null);
    expect(off.warnings).toEqual(['Chưa bật bộ dịch (TRANSLATOR=off). Không có ngôn ngữ nào để tìm báo nước ngoài.']);
  });

  it('bộ dịch chính lỗi, dùng bản dịch máy dự phòng → cảnh báo người dùng', async () => {
    const backup: Translator = {
      id: 'stub',
      async translate(_phrase, languages) {
        return languages.map((l) => ({
          language: l.code,
          variants: l.code === 'ru' ? ['Чан Ван А'] : [],
          fallbackNote: 'Gemini API: đã hết lượt của gói miễn phí → đã dùng bản dịch máy Microsoft Translator',
        }));
      },
    };
    const { warnings, results } = await runMl(backup);
    expect(warnings).toContain(
      'Gemini API: đã hết lượt của gói miễn phí → đã dùng bản dịch máy Microsoft Translator. Bản dịch máy chỉ có 1 cách viết và có thể chưa phiên âm tên người đúng cách báo chí nước đó viết.',
    );
    expect(results.map((r) => r.url)).toEqual(['https://ria.ru/20190512/chan-van-a.html']);
  });
});

describe('runPipeline — từ khoá bắt buộc, từ phụ và tìm liên quan', () => {
  const VISIT_PAGES = new Map<string, ParsedPage>([
    page('https://vov.vn/chinh-tri/tham-abc-1.vov', html({ lead: 'Thủ tướng có chuyến thăm chính thức ABC vào tuần tới.' })),
    page('https://vov.vn/kinh-te/doan-abc-2.vov', html({ lead: 'Đoàn đại biểu ABC thăm nhà máy điện.' })),
    page('https://vov.vn/chinh-tri/cong-tac-3.vov', html({ lead: 'Chuyến công tác của Thủ tướng tại miền Trung.' })),
  ]);
  const [VISIT, DELEGATION, TRIP] = [...VISIT_PAGES.keys()];

  async function runVisit(query: string, extra: { languages?: string[]; translator?: Translator } = {}) {
    const calls: SearchRequest[] = [];
    const provider: SearchProvider = {
      id: 'stub-visit',
      async search(request) {
        calls.push(request);
        const items =
          request.page === 0 && request.locale?.language === 'vi' ? [VISIT, DELEGATION, TRIP].map((u) => item(u, '2 giờ trước')) : [];
        return { items, hasMore: false, searchedAt: SEARCHED_AT };
      },
    };
    const events: PipelineEvent[] = [];
    const params: SearchParams = {
      query,
      region: 'domestic',
      fromDate: '2026-10-01',
      toDate: '2026-10-13',
      pagesPerSource: 1,
      languages: extra.languages ?? [],
      localEngines: false,
    };
    const deps: PipelineDeps = {
      provider,
      translator: extra.translator,
      async loadPage(url) {
        const p = VISIT_PAGES.get(url);
        if (!p) throw new FetchError('http', 'HTTP 404');
        return p;
      },
      async lookupWayback() {
        return null;
      },
    };
    await runPipeline(params, deps, (e) => events.push(e));
    return {
      calls,
      results: byUrl(events.flatMap((e) => (e.type === 'result' ? [e.item] : []))),
      rejected: Object.fromEntries(events.flatMap((e) => (e.type === 'rejected' ? [[e.item.url, e.item.detail]] : []))),
      plan: events.flatMap((e) => (e.type === 'start' ? [e.plan] : []))[0],
      warnings: events.flatMap((e) => (e.type === 'warning' ? [e.message] : [])),
    };
  }

  it('không đánh dấu: tìm liên quan — nhận bài có ít nhất 60% số từ, không cần đúng thứ tự', async () => {
    const { calls, results, rejected } = await runVisit('Chuyến thăm ABC của thủ tướng');
    expect(calls[0].query).toBe('Chuyến thăm ABC của thủ tướng');
    expect(Object.keys(results)).toEqual(expect.arrayContaining([VISIT, TRIP]));
    expect(results[VISIT]).toMatchObject({
      loose: true,
      optionalMatch: { found: ['Chuyến', 'thăm', 'ABC', 'thủ', 'tướng'], total: 5 },
    });
    expect(results[TRIP].optionalMatch).toEqual({ found: ['Chuyến', 'thủ', 'tướng'], total: 5 });
    expect(rejected).toEqual({ [DELEGATION]: 'Chỉ có 2/5 từ (cần ít nhất 3): thăm, ABC' });
  });

  it('bôi đen "ABC": bắt buộc có ABC và ít nhất một nửa số từ liên quan', async () => {
    const { calls, results, rejected } = await runVisit('Chuyến thăm `ABC` của thủ tướng');
    expect(calls[0].query).toBe('"ABC" Chuyến thăm của thủ tướng');
    expect(results[VISIT]).toMatchObject({
      loose: false,
      matchedVariant: 'ABC',
      optionalMatch: { found: ['Chuyến', 'thăm', 'thủ', 'tướng'], total: 4 },
    });
    expect(rejected).toEqual({
      [TRIP]: 'Không tìm thấy “ABC” trong trang',
      // có ABC nhưng chỉ nhắc tới "thăm": không phải bài về chuyến thăm của thủ tướng
      [DELEGATION]: 'Có “ABC” nhưng không liên quan tới nội dung đã nhập: chỉ có 1/4 từ liên quan (cần ít nhất 2): thăm',
    });
    // Đoạn trích phân biệt từ khoá bắt buộc và từ phụ; từ phụ liền nhau gộp thành một vùng
    const r = results[VISIT];
    expect(r.highlights.map((h) => [r.snippet.slice(h.start, h.end), h.kind])).toEqual([
      ['Thủ tướng', 'optional'],
      ['chuyến thăm', 'optional'],
      ['ABC', 'required'],
    ]);
  });

  it('nhiều phần bắt buộc: bài phải có đủ tất cả', async () => {
    const { results, rejected } = await runVisit('`ABC` `Thủ tướng`');
    expect(Object.keys(results)).toEqual([VISIT]);
    expect(results[VISIT]).toMatchObject({ matchedVariant: 'ABC + Thủ tướng', optionalMatch: null });
    expect(rejected).toEqual({
      [DELEGATION]: 'Thiếu từ khoá bắt buộc: “Thủ tướng”',
      [TRIP]: 'Thiếu từ khoá bắt buộc: “ABC”',
    });
  });

  it('dịch phần từ phụ bị lỗi (vd Gemini treo) → vẫn giữ bản dịch từ khoá chính, cảnh báo rõ', async () => {
    const translator: Translator = {
      id: 'stub',
      async translate(phrase, languages) {
        if (phrase !== 'ABC') throw new TranslationError('Gemini API (gemini-3.8-flash) không phản hồi sau 25s');
        return languages.map((l) => ({ language: l.code, variants: ['ABC'] }));
      },
    };
    const { plan, warnings } = await runVisit('Chuyến thăm `ABC` của thủ tướng', { languages: ['en'], translator });
    expect(plan.groups[1]).toMatchObject({ language: 'en', terms: [{ text: 'ABC' }], optional: [] });
    expect(warnings).toEqual([
      'Không dịch được “Chuyến thăm của thủ tướng”: Gemini API (gemini-3.8-flash) không phản hồi sau 25s. Các ngôn ngữ khác chỉ tìm bằng từ khoá chính.',
    ]);
  });

  it('dịch riêng từng phần bắt buộc và phần từ phụ', async () => {
    const phrases: string[] = [];
    const translator: Translator = {
      id: 'stub',
      async translate(phrase, languages) {
        phrases.push(phrase);
        const english: Record<string, string> = { ABC: 'ABC', 'Chuyến thăm của thủ tướng': "Prime Minister's visit" };
        return languages.map((l) => ({ language: l.code, variants: [english[phrase]] }));
      },
    };
    const { plan, calls } = await runVisit('Chuyến thăm `ABC` của thủ tướng', { languages: ['en'], translator });
    expect(phrases.sort()).toEqual(['ABC', 'Chuyến thăm của thủ tướng']);
    expect(plan.groups[1]).toMatchObject({
      language: 'en',
      terms: [{ text: 'ABC', variants: ['ABC'] }],
      optional: ["Prime Minister's visit"],
    });
    expect(calls[1]).toMatchObject({ query: '"ABC" Prime Minister\'s visit', locale: { country: 'vn', language: 'en' } });
  });

  it('tên không đánh dấu cũng chỉ là tìm liên quan: có thể khớp cả “Trần Văn Anh”', async () => {
    const { calls, results } = await run({ query: 'Trần Văn A' });
    expect(calls[0].query).toBe('Trần Văn A');
    expect(results.map((r) => r.url)).toContain('https://tuoitre.vn/ong-tran-van-anh-2012010110101012.htm');
  });
});

describe('runPipeline — tiếng Nga biến cách tên', () => {
  it('bài viết "То Лама" / "То Ламу" vẫn khớp bản dịch "То Лам"', async () => {
    const pages = new Map<string, ParsedPage>([
      page('https://lenta.ru/news/2026/10/18/to-lam/', html({ lead: 'Визит То Лама в Данию начнётся завтра.' })),
      page('https://tass.ru/politika/1', html({ lead: 'Президент Дании направила То Ламу приглашение к визиту.' })),
    ]);
    const provider: SearchProvider = {
      id: 'stub-ru',
      async search(request) {
        const items = request.locale?.onlyLanguage === 'ru' ? [...pages.keys()].map((u) => item(u, '2 giờ trước')) : [];
        return { items, hasMore: false, searchedAt: SEARCHED_AT };
      },
    };
    const translator: Translator = {
      id: 'stub',
      async translate(phrase, languages) {
        const ru: Record<string, string> = { 'Tô Lâm': 'То Лам', 'thăm Đan Mạch': 'визит в Данию' };
        return languages.map((l) => ({ language: l.code, variants: [ru[phrase]] }));
      },
    };
    const events: PipelineEvent[] = [];
    await runPipeline(
      { query: '`Tô Lâm` thăm Đan Mạch', region: 'foreign', fromDate: '2026-10-01', toDate: '2026-10-13', pagesPerSource: 1, languages: ['ru'], localEngines: false },
      {
        provider,
        translator,
        async loadPage(url) {
          return pages.get(url)!;
        },
        async lookupWayback() {
          return null;
        },
      },
      (e) => events.push(e),
    );
    const results = events.flatMap((e) => (e.type === 'result' ? [e.item] : []));
    expect(results.map((r) => [r.url, r.matchedLanguage, r.optionalMatch]).sort()).toEqual([
      ['https://lenta.ru/news/2026/10/18/to-lam/', 'ru', { found: ['визит', 'Данию'], total: 2 }],
      ['https://tass.ru/politika/1', 'ru', { found: ['визит', 'Данию'], total: 2 }], // "визиту", "Дании"
    ]);
    // Tô sáng đúng cả đuôi biến cách
    const lenta = results.find((r) => r.url.includes('lenta'))!;
    expect(lenta.highlights.filter((h) => h.kind === 'required').map((h) => lenta.snippet.slice(h.start, h.end))).toEqual(['То Лама']);
  });
});

describe('runPipeline — khoảng ngày lẻ', () => {
  it('bài chỉ có ngày ước lượng cũng phải nằm trong khoảng: Wayback lưu trước ngày bắt đầu, hoặc Google ghi ngày ngoài khoảng → loại', async () => {
    const { rejected, results } = await run({ fromDate: '2013-07-01', toDate: '2015-12-31' });
    const detail = (url: string) => rejected.find((r) => r.url === url);
    expect(detail('https://laodong.vn/bai-viet.ldo')).toMatchObject({
      reason: 'out_of_range',
      detail: 'Đã có trên Wayback Machine từ 01/06/2013, tức đăng trước 01/07/2013',
    });
    expect(detail('https://nld.com.vn/thoi-su/bai-khong-ngay.htm')).toMatchObject({
      reason: 'out_of_range',
      detail: 'Google ghi ngày 03/04/2011 (“3 thg 4, 2011”), nằm ngoài 01/07/2013–31/12/2015',
    });
    expect(results.every((r) => r.date && r.date.date >= '2013-07-01' && r.date.date <= '2015-12-31')).toBe(true);
  });

  it('tìm đúng khoảng ngày đã chọn; bài có ngày đăng ngoài khoảng bị loại', async () => {
    const { calls, results, rejected } = await run({ fromDate: '2010-03-01', toDate: '2012-06-30', pagesPerSource: 2 });
    expect(calls.map((c) => `${c.dateRange!.start}..${c.dateRange!.end}`)).toEqual([
      '2010-03-01..2012-06-30',
      '2010-03-01..2012-06-30',
    ]);
    const vnexpress = rejected.find((r) => r.url === 'https://vnexpress.net/ong-tran-van-a-nhan-giai-3923456.html?utm_source=facebook&fbclid=x');
    expect(vnexpress).toMatchObject({ reason: 'out_of_range' });
    expect(vnexpress?.detail).toContain('02/03/2015 (Meta tag) nằm ngoài 01/03/2010–30/06/2012');
    // đăng 05/01/2010, trước ngày bắt đầu 01/03/2010
    const dantri = rejected.find((r) => r.url === 'https://dantri.com.vn/xa-hoi/du-an-20100105101010123.htm');
    expect(dantri?.detail).toContain('05/01/2010 (URL) nằm ngoài');
    // ngày ước lượng (snippet, Wayback) không bị loại theo khoảng ngày
    expect(results.map((r) => r.date?.source)).toEqual(expect.arrayContaining(['snippet', 'wayback']));
  });
});
