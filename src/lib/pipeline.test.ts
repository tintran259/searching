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

const FILLER_EN =
  'According to the provincial report, the project was completed on schedule with the participation of many partners. ' +
  'Local residents said their lives had changed noticeably since the bridge was opened to traffic last month.';

function html({
  lead,
  head = '',
  aside = '',
  extra = '',
  filler = FILLER,
}: {
  lead: string;
  head?: string;
  aside?: string;
  extra?: string;
  filler?: string;
}) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Bài viết</title>${head}</head><body>
    <header><nav><a href="/">Trang chủ</a></nav></header>
    <main><article><h1>Bài viết</h1>${extra}<p>${lead}</p><p>${filler}</p><p>${filler}</p><p>${filler}</p></article></main>
    <aside><h3>Tin liên quan</h3><ul><li>${aside || 'Tin khác'}</li></ul></aside>
    <footer>Bản quyền © Báo điện tử</footer></body></html>`;
}

const page = (url: string, h: string, finalUrl = url) => [url, parsePage(h, finalUrl, NOW)] as const;

const PAGES = new Map<string, ParsedPage | FetchError>([
  page('https://dantri.com.vn/xa-hoi/du-an-20100105101010123.htm', html({ lead: 'ÔNG TRẦN VĂN A phát biểu tại buổi lễ.' })),
  page('https://tuoitre.vn/ong-tran-van-anh-2012010110101012.htm', html({ lead: 'Ông Trần Văn Anh, giám đốc sở, cho biết.' })),
  page(
    'https://www.nytimes.com/2010/01/01/world/asia/engineer.html',
    html({ lead: 'Mr. A Tran Van, an engineer, said the bridge is done.', filler: FILLER_EN }),
  ),
  // Trang Việt Nam trên tên miền nước ngoài, viết tiếng Việt: không phải báo nước ngoài
  page('https://tintuc-viet.com/2010/01/02/tran-van-a.html', html({ lead: 'Kỹ sư Tran Van A hoàn thành cây cầu.' })),
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

const item = (url: string, dateText: string | null = null, title = url, snippet = ''): SearchResultItem => ({
  url,
  title,
  snippet,
  dateText,
  position: 1,
});

/** Kết quả giả lập theo trang (tìm trên cả khoảng ngày); trang 4 lỗi tạm thời */
const SEARCH_PAGES: { items: SearchResultItem[]; hasMore: boolean }[] = [
  {
    hasMore: true,
    items: [
      item('https://dantri.com.vn/xa-hoi/du-an-20100105101010123.htm'),
      item('https://tuoitre.vn/ong-tran-van-anh-2012010110101012.htm'),
      item('https://www.nytimes.com/2010/01/01/world/asia/engineer.html'),
      item('https://www.facebook.com/tranvana/posts/1'),
      item('https://www.facebook.com/baoxyz/posts/2', '3 thg 3, 2012', 'Báo XYZ', 'Kỹ sư Trần Văn A được tặng bằng khen vì đóng góp cho tỉnh nhà.'),
      item('https://www.youtube.com/watch?v=abc', null, 'Trần Văn A: hành trình xây cầu', 'Phóng sự về kỹ sư trẻ ở miền Tây.'),
      item('https://www.facebook.com/abcnews/posts/3', null, 'ABC News', 'Engineer Tran Van A finished the bridge in the Mekong Delta.'),
      item('https://www.tintuc-viet.com/'),
      item('https://tintuc-viet.com/2010/01/02/tran-van-a.html'),
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
      if (request.vertical === 'news') return { items: [], hasMore: false, searchedAt: SEARCHED_AT };
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
    retryDelayMs: 0,
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
      // Bài đăng mạng xã hội: xác minh bằng đoạn trích Google, ngày theo Google
      ['https://www.facebook.com/baoxyz/posts/2', '2012-03-03', 'snippet'],
      ['https://plo.vn/a-moi.html', '2013-02-03', 'jsonld'],
      ['https://laodong.vn/bai-viet.ldo', '2013-06-01', 'wayback'],
      ['https://vtv.vn/bai-goc.htm', '2014-07-07', 'time'],
      ['https://vnexpress.net/ong-tran-van-a-nhan-giai-3923456.html', '2015-03-02', 'meta'],
      // Google không ghi ngày → "Không rõ ngày", xếp cuối
      ['https://www.youtube.com/watch?v=abc', null, null],
    ]);
    expect(sortArticles(results, 'desc').map((r) => r.date?.date ?? null)).toEqual([
      '2015-03-02', '2014-07-07', '2013-06-01', '2013-02-03', '2012-03-03', '2011-04-03', '2010-01-05', null,
    ]);
    expect(byUrl(results)['https://www.youtube.com/watch?v=abc']).toMatchObject({
      sourceName: 'YouTube · Mạng xã hội',
      region: 'domestic',
      title: 'Trần Văn A: hành trình xây cầu',
    });
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
      'https://www.facebook.com/tranvana/posts/1': 'no_match', // mạng xã hội: tiêu đề + đoạn trích Google không có tên
      'https://www.facebook.com/abcnews/posts/3': 'no_match', // tên không dấu chỉ khớp khi tìm Ngoài nước
      'https://www.tintuc-viet.com/': 'non_article', // trang chủ
      'https://tintuc-viet.com/2010/01/02/tran-van-a.html': 'region',
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
    expect(details['https://thanhnien.vn/loi-404.htm'].detail).toBe('HTTP 404; tiêu đề / đoạn trích Google cũng không có đủ từ khoá');
    expect(details['https://baomoi.com/redirect.epi'].detail).toContain('bbc.com');
    expect(details['https://soha.vn/bai-cu.htm'].detail).toContain('02/02/2005');
  });

  it('gộp trùng theo URL chuẩn hoá và canonical; đếm tiến trình khớp', async () => {
    const { final, events, results } = await run();
    expect(results.filter((r) => r.url === 'https://vtv.vn/bai-goc.htm')).toHaveLength(1);
    expect(final).toMatchObject({
      phase: 'done',
      candidates: 22,
      toVerify: 19,
      verified: 19,
      accepted: 8,
      rejected: 13,
      duplicates: 2,
      searchCalls: 3,
      sourcesDone: 1,
      totalSources: 1,
    });
    expect(events[0].type).toBe('start');
    expect(events.at(-1)).toMatchObject({ type: 'done', aborted: false });
    expect(events.filter((e) => e.type === 'warning')).toEqual([
      { type: 'warning', message: 'Tiếng Việt · Google, trang 4: SerpApi: Internal error' },
    ]);
  });

  it('mỗi nguồn lấy tối đa N trang trên cả khoảng ngày, truy vấn bọc ngoặc kép', async () => {
    const { calls } = await run();
    expect(calls.map((c) => `${c.dateRange!.start}..${c.dateRange!.end}/${c.page}`)).toEqual([
      '2010-01-01..2015-12-31/0',
      '2010-01-01..2015-12-31/1',
      '2010-01-01..2015-12-31/2',
      '2010-01-01..2015-12-31/3',
      '2010-01-01..2015-12-31/3', // lỗi tạm thời → thử lại 1 lần
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
        vertical: 'web',
        tier: 1,
        query: '"Trần Văn A"',
        requested: 40,
        returned: 23,
        exhausted: false,
        accepted: 8,
        rejected: 13,
        duplicates: 2,
        status: 'failed',
        error: 'SerpApi: Internal error',
      },
    ]);
    // Hết kết quả trước khi đủ số yêu cầu
    const short = await run({ pagesPerSource: 10 }, makeDeps(makeProvider().provider));
    expect(short.final.sources[0]).toMatchObject({ requested: 100, returned: 23, exhausted: true, status: 'done' });
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
    // Ngoài nước không dùng mục Tin tức; từ khoá không có từ phụ nên không có truy vấn bổ sung
    expect(foreign.final.sources.map((r) => r.id)).toEqual(['en:google']);
    expect(foreign.results.map((r) => [r.url, r.matchedVariant, r.region, r.date?.date])).toEqual([
      ['https://www.facebook.com/abcnews/posts/3', 'Tran Van A', 'foreign', undefined],
      ['https://www.nytimes.com/2010/01/01/world/asia/engineer.html', 'A Tran Van', 'foreign', '2010-01-01'],
    ]);
    // Bài đăng tiếng Anh trên Facebook: Ngoài nước, vào tab "Chưa xác minh" (chỉ có đoạn trích Google)
    expect(byUrl(foreign.results)['https://www.facebook.com/abcnews/posts/3']).toMatchObject({
      verification: 'unverified',
      publisher: { kind: 'social', verified: false },
    });
    // Chế độ chặt: không xác định được tài khoản đăng ở nước nào → loại
    const strict = await run(
      { region: 'foreign', languages: ['en'], sourcePolicy: 'verified' },
      makeDeps(makeProvider(3).provider, { translator: english }),
    );
    expect(byUrl(strict.rejected)['https://www.facebook.com/abcnews/posts/3']).toMatchObject({ reason: 'source_unverified' });
    // Fanpage tiếng Anh của hãng tin Việt Nam (facebook.com/VNAEnglish) là bài đăng lại từ báo Việt Nam
    const vna = item('https://www.facebook.com/VNAEnglish/posts/9', null, 'VNA English', 'Engineer Tran Van A finished the bridge.');
    const vnaProvider: SearchProvider = {
      id: 'stub-vna',
      async search(request) {
        return { items: request.vertical === 'news' ? [] : [vna], hasMore: false, searchedAt: SEARCHED_AT };
      },
    };
    const vnaRun = await run(
      { region: 'foreign', languages: ['en'] },
      makeDeps(vnaProvider, { translator: english }),
    );
    expect(byUrl(vnaRun.rejected)[vna.url]).toMatchObject({ reason: 'republished', detail: expect.stringContaining('VNAEnglish') });
    expect(foreign.results.every((r) => r.foundLanguage === 'en')).toBe(true);
    // Trang tên miền nước ngoài nhưng viết tiếng Việt, bài đăng tiếng Việt trên Facebook: không phải báo nước ngoài
    expect(byUrl(foreign.rejected)['https://tintuc-viet.com/2010/01/02/tran-van-a.html']).toMatchObject({
      reason: 'region',
      detail: expect.stringContaining('Bài viết bằng tiếng Việt'),
    });
    expect(byUrl(foreign.rejected)['https://www.facebook.com/baoxyz/posts/2']).toMatchObject({
      reason: 'region',
      detail: 'Bài đăng Facebook viết bằng tiếng Việt (Trong nước)',
    });
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
    page('https://ria.ru/20190512/chan-van-a.html', html({ lead: 'ЧАН ВАН А заявил журналистам о новом проекте.', filler: FILLER_EN })),
    page('https://ria.ru/20200101/chan-van-an.html', html({ lead: 'Чан Ван Ань заявил журналистам.', filler: FILLER_EN })),
    page('https://www.zaobao.com.sg/news/world/story20190601-1.html', html({ lead: '记者陈文A表示，项目已经完成。', filler: FILLER_EN })),
    page('https://www.zaobao.com.sg/news/world/story20200301-2.html', html({ lead: '另一位记者陈文A说明了情况。', filler: FILLER_EN })),
    page('https://news.sina.com.cn/w/2019-08-01/doc-1.shtml', html({ lead: '陈文A出席了会议。', filler: FILLER_EN })),
    page('https://lenta.ru/news/2019/09/01/chan/', html({ lead: 'Чан Ван А посетил Москву.', filler: FILLER_EN })),
  ]);

  function mlProvider() {
    const calls: SearchRequest[] = [];
    const provider: SearchProvider = {
      id: 'stub-ml',
      async search(request) {
        calls.push(request);
        let items: SearchResultItem[] = [];
        const hasMore = false;
        if (request.vertical === 'news') return { items, hasMore, searchedAt: SEARCHED_AT };
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
      retryDelayMs: 0,
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
    const main = calls.filter((c) => c.vertical !== 'news');
    expect(main.map((c) => `${c.locale?.country}/${c.locale?.language}/${c.locale?.onlyLanguage ?? '-'}:${c.page}`)).toEqual([
      'us/en/en:0', // Ngoài nước không tìm bằng tiếng Việt
      'ru/ru/ru:0',
      'cn/zh-cn/zh-CN:0',
      'th/th/th:0',
    ]);
    expect(warnings).toEqual(['Không có bản dịch cho: Tiếng Lào.']);
    expect(final.sources.filter((r) => r.tier === 1).map((r) => [r.id, r.status, r.returned, r.accepted, r.rejected])).toEqual([
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
    const main = calls.filter((c) => c.vertical !== 'news');
    expect(main.map((c) => `${c.engine}:${c.locale?.onlyLanguage ?? 'vi'}/${c.page}`)).toEqual([
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
      retryDelayMs: 0,
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

  it('bôi đen "ABC": bắt buộc có ABC (ở tiêu đề hay nội dung), từ còn lại chỉ để báo mức liên quan', async () => {
    const { calls, results, rejected } = await runVisit('Chuyến thăm `ABC` của thủ tướng');
    expect(calls[0].query).toBe('"ABC" Chuyến thăm của thủ tướng');
    expect(results[VISIT]).toMatchObject({
      loose: false,
      matchedVariant: 'ABC',
      optionalMatch: { found: ['Chuyến', 'thăm', 'thủ', 'tướng'], total: 4 },
    });
    // Có ABC nhưng chỉ nhắc tới "thăm": vẫn nhận, ghi rõ chỉ có 1/4 từ liên quan
    expect(results[DELEGATION].optionalMatch).toEqual({ found: ['thăm'], total: 4 });
    expect(rejected).toEqual({ [TRIP]: 'Không tìm thấy “ABC” trong trang' });
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

describe('runPipeline — Ngoài nước: xác minh nội dung, nguồn và chi phí', () => {
  const EN: Record<string, string[]> = {
    'Tô Lâm': ['To Lam'],
    Bỉ: ['Belgium', 'Belgique'],
    'đi': ['go'],
    'thăm chính thức': ['state visit', 'official visit'],
  };
  const translator: Translator = {
    id: 'stub',
    async translate(phrase, languages) {
      return languages.map((l) => ({ language: l.code, variants: EN[phrase] ?? [phrase] }));
    },
  };

  /** Mỗi truy vấn trả một danh sách riêng (theo mục web / tin tức và truy vấn) */
  function runForeign(
    pages: Map<string, ParsedPage | FetchError>,
    results: (req: SearchRequest) => SearchResultItem[],
    extra: Partial<SearchParams> = {},
  ) {
    const calls: SearchRequest[] = [];
    const provider: SearchProvider = {
      id: 'stub-foreign',
      async search(request) {
        calls.push(request);
        return { items: results(request), hasMore: false, searchedAt: SEARCHED_AT };
      },
    };
    const events: PipelineEvent[] = [];
    const params: SearchParams = {
      query: '`Tô Lâm` đi `Bỉ`',
      region: 'foreign',
      fromDate: '2026-10-12',
      toDate: '2026-10-13',
      pagesPerSource: 1,
      languages: ['en'],
      localEngines: false,
      ...extra,
    };
    const deps: PipelineDeps = {
      provider,
      translator,
      async loadPage(url) {
        const p = pages.get(url);
        if (!p) throw new FetchError('http', 'HTTP 404');
        if (p instanceof Error) throw p;
        return p;
      },
      lookupWayback: async () => null,
      retryDelayMs: 0,
    };
    return runPipeline(params, deps, (e) => events.push(e)).then((final) => ({
      final,
      calls,
      results: byUrl(events.flatMap((e) => (e.type === 'result' ? [e.item] : []))),
      rejected: byUrl(events.flatMap((e) => (e.type === 'rejected' ? [e.item] : []))),
      warnings: events.flatMap((e) => (e.type === 'warning' ? [e.message] : [])),
      plan: events.flatMap((e) => (e.type === 'start' ? [e.plan] : []))[0],
    }));
  }

  const FP = 'https://foreignpolicy.com/2026/10/19/france/';
  const TV = 'https://thevietnamese.org/2026/10/robertson/';
  const pagesTv = new Map<string, ParsedPage | FetchError>([
    page(TV, html({ lead: 'General Secretary Tô Lâm left Hanoi for Denmark and Belgium on Sunday.', filler: FILLER_EN })),
    page(FP, html({ lead: 'Protests in France, while To Lam visits Belgium.', filler: FILLER_EN })),
  ]);
  const both = (req: SearchRequest) => (req.vertical === 'news' ? [] : [FP, TV].map((u) => item(u, '20 hours ago', 'France Reckons With Protests')));

  it('tiêu đề không nhắc tên, tên giữ dấu “Tô Lâm”, không dịch từ quá chung “đi”: nhận mọi domain có đủ nội dung', async () => {
    const { results, plan } = await runForeign(pagesTv, both);
    // "đi" không được dịch → không có từ phụ "go" kéo Google lạc chủ đề
    expect(plan.groups[1]).toMatchObject({ language: 'en', optional: [] });
    expect(Object.keys(results).sort()).toEqual([FP, TV]);
    expect(results[FP]).toMatchObject({
      verification: 'verified',
      conditions: [
        { term: 'Tô Lâm', status: 'matched_exact', variant: 'To Lam', where: 'main' },
        { term: 'Bỉ', status: 'matched_exact', variant: 'Belgium', where: 'main' },
      ],
      publisher: { country: 'us', verified: true, origin: 'original' },
    });
    // .org không có trong danh sách vẫn được nhận, chỉ ghi là chưa rõ quốc gia
    expect(results[TV]).toMatchObject({ publisher: { verified: false, country: null } });
    expect(results[TV].conditions[0]).toMatchObject({ status: 'matched_exact', variant: 'Tô Lâm' });
  });

  it('chế độ chặt “Chỉ nhận báo xác định được quốc gia”: loại trang chưa rõ quốc gia, trừ domain được cho phép', async () => {
    const strict = await runForeign(pagesTv, both, { sourcePolicy: 'verified' });
    expect(Object.keys(strict.results)).toEqual([FP]);
    expect(strict.rejected[TV]).toMatchObject({ reason: 'source_unverified' });
    expect(strict.rejected[TV].detail).toContain('Chưa xác định được quốc gia nhà xuất bản');
    const allowed = await runForeign(pagesTv, both, { sourcePolicy: 'verified', allowDomains: ['thevietnamese.org'] });
    expect(allowed.results[TV]).toMatchObject({ publisher: { verified: true } });
  });

  it('bài đăng lại từ báo Việt Nam (ghi nguồn VNA, canonical về báo VN, đơn vị xuất bản VN) bị loại khi có bằng chứng', async () => {
    const credit = 'https://www.miragenews.com/vietnam-leader-1/';
    const canonical = 'https://newsaggregator.co.uk/to-lam-belgium/';
    const site = 'https://www.example-news.de/to-lam/';
    const pages = new Map<string, ParsedPage | FetchError>([
      page(credit, html({ lead: 'Hanoi (VNA) – To Lam arrived in Belgium for a state visit.', filler: FILLER_EN })),
      page(
        canonical,
        html({
          lead: 'To Lam arrived in Belgium.',
          filler: FILLER_EN,
          head: '<link rel="canonical" href="https://en.vietnamplus.vn/to-lam-belgium-post1.vnp">',
        }),
      ),
      page(site, html({ lead: 'To Lam arrived in Belgium.', filler: FILLER_EN, head: '<meta property="og:site_name" content="VietnamPlus">' })),
    ]);
    const items = (req: SearchRequest) => (req.vertical === 'news' ? [] : [credit, canonical, site].map((u) => item(u, '1 day ago')));
    const { results, rejected } = await runForeign(pages, items);
    expect(Object.keys(results)).toEqual([]);
    expect(rejected[credit]).toMatchObject({ reason: 'republished', detail: expect.stringContaining('(VNA)') });
    expect(rejected[canonical]).toMatchObject({ reason: 'republished', detail: expect.stringContaining('en.vietnamplus.vn') });
    expect(rejected[site]).toMatchObject({ reason: 'republished', detail: expect.stringContaining('VietnamPlus') });
    // Tắt tuỳ chọn: vẫn nhận nhưng ghi rõ là bài đăng lại
    const kept = await runForeign(pages, items, { excludeRepublished: false });
    expect(kept.results[credit].publisher).toMatchObject({ origin: 'republished' });
  });

  it('trang chặn bot / không tải được: đủ từ khoá trong đoạn trích Google → “Chưa xác minh”; không đủ → bị loại', async () => {
    const blocked = 'https://www.reuters.com/world/to-lam-belgium/';
    const missing = 'https://www.reuters.com/world/other/';
    const pages = new Map<string, ParsedPage | FetchError>([
      [blocked, new FetchError('http', 'HTTP 403')],
      [missing, new FetchError('http', 'HTTP 403')],
    ]);
    const items = (req: SearchRequest) =>
      req.vertical === 'news'
        ? []
        : [
            item(blocked, '1 day ago', 'President To Lam departs for visits to Denmark and Belgium', 'Vietnam leader To Lam…'),
            item(missing, '1 day ago', 'Belgium news today', 'Brussels…'),
          ];
    const { results, rejected, final } = await runForeign(pages, items);
    expect(results[blocked]).toMatchObject({
      verification: 'unverified',
      conditions: [
        { term: 'Tô Lâm', status: 'unverified', where: 'snippet' },
        { term: 'Bỉ', status: 'unverified', where: 'snippet' },
      ],
      publisher: { verified: true, country: 'gb' },
    });
    expect(results[blocked].publisher.signals[0]).toBe('Không tải được trang: HTTP 403');
    expect(rejected[missing]).toMatchObject({
      reason: 'fetch_error',
      detail: 'HTTP 403; tiêu đề / đoạn trích Google cũng không có đủ từ khoá',
    });
    expect(final.metrics).toMatchObject({ fetchOk: 0, fetchFailed: 2, unverified: 1 });
  });

  it('Ngoài nước, ngôn ngữ thiếu kết quả: chạy thêm cách diễn đạt khác (không dùng Google News), trong giới hạn số lượt', async () => {
    const alt = 'https://www.dw.com/en/to-lam-belgium/a-1';
    const pages = new Map<string, ParsedPage | FetchError>([
      page(alt, html({ lead: 'To Lam in Belgium for an official visit.', filler: FILLER_EN })),
    ]);
    const items = (req: SearchRequest) => (req.query.includes('official visit') ? [item(alt, '1 day ago')] : []);
    const run1 = await runForeign(pages, items, { query: '`Tô Lâm` thăm chính thức `Bỉ`' });
    // Truy vấn chính → không có bài → cách diễn đạt khác của từ phụ (bản dịch thứ 2); Google News chỉ dùng khi Trong nước
    expect(run1.calls.map((c) => c.vertical ?? 'web')).toEqual(['web', 'web']);
    expect(run1.calls[0].query).toMatch(/state visit -site:vn /);
    expect(run1.calls[1].query).toMatch(/official visit -site:vn /);
    expect(run1.results[alt]).toMatchObject({ foundBy: ['Tiếng Anh · Google (truy vấn bổ sung)'], publisher: { country: 'de', verified: true } });
    expect(run1.final.sources.map((r) => [r.id, r.tier])).toEqual([
      ['en:google', 1],
      ['en:google:alt1', 2],
    ]);
    expect(run1.final.metrics).toMatchObject({ budget: 10, queriesPlanned: 2, queriesDeduped: 0 });
    expect(run1.final.sourcesDone).toBe(run1.final.totalSources);

    // Số lượt tìm tối đa = 1: chỉ chạy truy vấn chính, báo rõ đã hết lượt
    const run2 = await runForeign(pages, items, { query: '`Tô Lâm` thăm chính thức `Bỉ`', budget: 1 });
    expect(run2.calls).toHaveLength(1);
    expect(run2.warnings.some((w) => w.includes('hết ngân sách 1 lượt'))).toBe(true);
  });

  it('cụm loại trừ: gửi kèm -"cụm" và loại bài có cụm đó; nhóm OR: chỉ cần một lựa chọn', async () => {
    const sport = 'https://www.dw.com/en/football/a-2';
    const pages = new Map<string, ParsedPage | FetchError>([
      page(FP, html({ lead: 'To Lam visits Brussels.', filler: FILLER_EN })),
      page(sport, html({ lead: 'To Lam watched football in Brussels.', filler: FILLER_EN })),
    ]);
    const items = (req: SearchRequest) => (req.vertical === 'news' ? [] : [FP, sport].map((u) => item(u, '1 day ago')));
    const { calls, results, rejected } = await runForeign(pages, items, { query: '`Tô Lâm` `Bỉ | Brussels`', exclude: ['football'] });
    expect(calls[0].query).toContain(' -"football"');
    expect(Object.keys(results)).toEqual([FP]);
    expect(results[FP].conditions[1]).toMatchObject({ term: 'Bỉ | Brussels', status: 'matched_exact', variant: 'Brussels' });
    expect(rejected[sport]).toMatchObject({ reason: 'excluded', detail: 'Có cụm loại trừ “football”' });
  });
});

describe('runPipeline — truy vấn bổ sung Trong nước', () => {
  it('thiếu kết quả: tìm thêm mục Tin tức của Google (có tên báo, giờ đăng) và chỉ từ khoá chính', async () => {
    const news = 'https://vnexpress.net/tran-van-a-tham-cau-4000001.html';
    const pages = new Map<string, ParsedPage>([
      page(news, html({ lead: 'Ông Trần Văn A thăm công trình cầu.' })),
    ]);
    const calls: SearchRequest[] = [];
    const provider: SearchProvider = {
      id: 'stub-news',
      async search(request) {
        calls.push(request);
        const items =
          request.vertical === 'news'
            ? [{ ...item(news, null), sourceName: 'VnExpress', publishedAt: '2026-10-12 03:00:00 UTC' }]
            : [];
        return { items, hasMore: false, searchedAt: SEARCHED_AT };
      },
    };
    const events: PipelineEvent[] = [];
    await runPipeline(
      { query: '`Trần Văn A` thăm cầu', region: 'domestic', fromDate: '2026-10-01', toDate: '2026-10-13', pagesPerSource: 1, languages: [], localEngines: false },
      { provider, loadPage: async (url) => pages.get(url)!, lookupWayback: async () => null, retryDelayMs: 0 },
      (e) => events.push(e),
    );
    expect(calls.map((c) => [c.vertical ?? 'web', c.query])).toEqual([
      ['web', '"Trần Văn A" thăm cầu'],
      ['news', '"Trần Văn A" thăm cầu'],
      ['web', '"Trần Văn A"'],
    ]);
    const results = events.flatMap((e) => (e.type === 'result' ? [e.item] : []));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ url: news, foundBy: ['Tiếng Việt · Google News'], date: { date: '2026-10-12', source: 'snippet' } });
  });

  it('ngôn ngữ kiểm tra xong trước thì tìm bổ sung trước, không chờ ngôn ngữ khác', async () => {
    const slow = 'https://www.lemonde.fr/a/1';
    const order: string[] = [];
    let releaseSlow: () => void = () => {};
    const slowLoaded = new Promise<void>((r) => (releaseSlow = r));
    const translator: Translator = {
      id: 'stub',
      async translate(_p, languages) {
        return languages.map((l) => ({ language: l.code, variants: ['Tran Van A'] }));
      },
    };
    const provider: SearchProvider = {
      id: 'stub-order',
      async search(request) {
        order.push(`${request.locale?.onlyLanguage}:${request.query.includes('visite') || request.query.includes('visit') ? 'main' : 'alt'}`);
        const items = request.locale?.onlyLanguage === 'fr' && request.page === 0 && !order.includes('fr:alt') ? [item(slow)] : [];
        return { items, hasMore: false, searchedAt: SEARCHED_AT };
      },
    };
    const optionalTranslator: Translator = {
      id: 'stub',
      async translate(phrase, languages) {
        if (phrase === 'Trần Văn A') return translator.translate(phrase, languages);
        return languages.map((l) => ({ language: l.code, variants: l.code === 'fr' ? ['visite'] : ['visit'] }));
      },
    };
    const run = runPipeline(
      { query: '`Trần Văn A` chuyến thăm', region: 'foreign', fromDate: '2026-10-01', toDate: '2026-10-13', pagesPerSource: 1, languages: ['en', 'fr'], localEngines: false },
      {
        provider,
        translator: optionalTranslator,
        async loadPage() {
          await slowLoaded; // trang tiếng Pháp tải rất lâu
          throw new FetchError('timeout', 'Quá thời gian 10s');
        },
        lookupWayback: async () => null,
        retryDelayMs: 0,
      },
      () => {},
    );
    // Tiếng Anh không có bài nào để kiểm tra → tìm bổ sung ngay, trong khi tiếng Pháp vẫn đang tải trang
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['en:main', 'fr:main', 'en:alt']);
    releaseSlow();
    await run;
    expect(order).toEqual(['en:main', 'fr:main', 'en:alt', 'fr:alt']);
  });
});

describe('runPipeline — tiếng Nga biến cách tên', () => {
  it('bài viết "То Лама" / "То Ламу" vẫn khớp bản dịch "То Лам"', async () => {
    const pages = new Map<string, ParsedPage>([
      page('https://lenta.ru/news/2026/10/18/to-lam/', html({ lead: 'Визит То Лама в Данию начнётся завтра.', filler: FILLER_EN })),
      page('https://tass.ru/politika/1', html({ lead: 'Президент Дании направила То Ламу приглашение к визиту.', filler: FILLER_EN })),
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
        retryDelayMs: 0,
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
    // Bài đăng mạng xã hội Google không ghi ngày thì để "Không rõ ngày"; còn lại đều nằm trong khoảng
    expect(results.every((r) => (r.date ? r.date.date >= '2013-07-01' && r.date.date <= '2015-12-31' : r.sourceName?.includes('Mạng xã hội')))).toBe(true);
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
