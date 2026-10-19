/**
 * Pipeline tìm bài:
 *   (dịch từ khoá sang các ngôn ngữ đã chọn → mỗi ngôn ngữ dò 1 truy vấn trên cả khoảng ngày)
 *   → tìm theo từng năm từ năm xa nhất, tối đa N trang/năm (tiếng Việt luôn quét; ngôn ngữ dịch
 *     chỉ quét khi lượt dò còn trang sau, để tiết kiệm quota)
 *   → lọc lần 1 theo URL trên kết quả tìm kiếm (phạm vi, mạng xã hội)
 *   → tải trang song song có giới hạn → lọc lần 2 theo URL thật sau chuyển hướng
 *   → xác minh nội dung chính (có đủ từ khoá bắt buộc, hoặc đủ tỉ lệ từ khi tìm liên quan)
 *   → trích ngày đăng → gộp trùng → phát sự kiện.
 * Các phụ thuộc có I/O (search, tải trang, Wayback, dịch) được truyền vào để test được.
 */
import pLimit from 'p-limit';
import { SEARCH_LANGUAGES } from '@/config/languages';
import { parseSnippetDate } from './date-extractor';
import { FetchError } from './fetcher';
import { DATE_SOURCE_INFO, engineLabel, formatDate, languageLabel } from './labels';
import { PhraseMatcher, type PhraseMatch } from './matcher';
import type { ParsedPage } from './page-parser';
import { LOOSE_MIN_RATIO, RELATED_MIN_RATIO } from './query-syntax';
import {
  buildLocalQuery,
  buildQueryPlan,
  cleanPhrase,
  optionalWords,
  removeDiacritics,
  searchLocaleFor,
  withTranslations,
} from './query-builder';
import { classifyRegion, hostnameOf, isNonArticleUrl, sourceNameOf } from './region';
import {
  SearchProviderError,
  type SearchEngine,
  type SearchProvider,
  type SearchResponse,
  type SearchResultItem,
} from './search/types';
import type { Translator } from './translate/types';
import {
  type ExtractedDate,
  type HighlightRange,
  type PipelineEvent,
  type ProgressState,
  type QueryGroup,
  type QueryPlan,
  type Region,
  type RejectReason,
  type SearchParams,
  type SourceReport,
  SOURCE_LANGUAGE,
} from './types';
import { cleanUrl, normalizeUrl, siteOf } from './url-normalize';

export interface PipelineDeps {
  provider: SearchProvider;
  /** Tải + phân tích trang; ném FetchError khi lỗi */
  loadPage: (url: string, signal?: AbortSignal) => Promise<ParsedPage>;
  /** Ngày lưu trữ đầu tiên trên Wayback Machine */
  lookupWayback: (url: string, signal?: AbortSignal) => Promise<ExtractedDate | null>;
  /** Bộ dịch từ khoá; null/không truyền thì chỉ tìm bằng tiếng Việt */
  translator?: Translator | null;
  /** Số trang tải song song, mặc định 5 */
  concurrency?: number;
}

interface Candidate extends SearchResultItem {
  key: string;
  /** Nguồn đã tìm ra (để đếm vào báo cáo của nguồn đó) */
  source: SourceReport;
  searchedAt: string;
}

/** Một nhóm truy vấn chạy trên một công cụ tìm kiếm, kèm báo cáo của nó */
interface SearchTarget {
  group: QueryGroup;
  engine: SearchEngine;
  query: string;
  report: SourceReport;
}

/** Bộ khớp của một nhóm truy vấn: từng từ khoá bắt buộc + các từ phụ */
interface GroupMatcher {
  group: QueryGroup;
  terms: PhraseMatcher[];
  optional: { word: string; matcher: PhraseMatcher }[];
}

interface GroupHit {
  matcher: GroupMatcher;
  /** Lần khớp đầu tiên của từng từ khoá bắt buộc */
  matches: PhraseMatch[];
}

interface CheckedPage {
  page: ParsedPage;
  hit: GroupHit;
  region: Region;
}

const REGION_MISMATCH: Record<Region, string> = {
  domestic: 'Trang trong nước (đuôi .vn hoặc có trong danh sách báo VN)',
  foreign: 'Trang nước ngoài (không phải .vn, không có trong danh sách báo VN)',
};

/** Số kết quả mỗi trang của mọi công cụ tìm kiếm đang dùng */
const RESULTS_PER_PAGE = 10;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const looseThreshold = (total: number) => Math.max(1, Math.ceil(total * LOOSE_MIN_RATIO));
const relatedThreshold = (total: number) => Math.ceil(total * RELATED_MIN_RATIO);

function buildGroupMatchers(plan: QueryPlan, region: Region): GroupMatcher[] {
  return plan.groups.map((group) => {
    // Toàn hư từ (vd "của và") thì vẫn dùng các từ đó để khỏi trống
    const meaningful = optionalWords(group.optional, group.language);
    const words = meaningful.length ? meaningful : cleanPhrase(group.optional.join(' ')).split(' ').filter(Boolean);
    // Tiếng Nga biến cách từ cuối của tên / cụm (То Лам → То Лама, Дания → Дании)
    const inflection = group.language === 'ru' ? ('ru' as const) : undefined;
    return {
      group,
      terms: group.terms.map((t) => new PhraseMatcher(t.variants, { inflection })),
      // Tìm Ngoài nước: từ phụ khớp cả bản không dấu ("Tran" ~ "Trần")
      optional: words.map((word) => ({
        word,
        matcher: new PhraseMatcher(region === 'foreign' ? [word, removeDiacritics(word)] : [word], {
          inflection: inflection && 'ru-stem',
        }),
      })),
    };
  });
}

/**
 * Nhóm đầu tiên khớp trong các văn bản (văn bản đứng trước được ưu tiên lấy đoạn trích):
 *  - có từ khoá bắt buộc → phải có đủ tất cả, và ít nhất RELATED_MIN_RATIO số từ còn lại (nội dung liên quan);
 *  - không có (tìm liên quan) → phải có ít nhất LOOSE_MIN_RATIO số từ.
 */
function matchGroups(matchers: GroupMatcher[], texts: string[]): GroupHit | null {
  const findIn = (m: PhraseMatcher) => texts.reduce<PhraseMatch | null>((acc, text) => acc ?? m.find(text), null);
  for (const matcher of matchers) {
    if (matcher.terms.length) {
      const matches: PhraseMatch[] = [];
      for (const term of matcher.terms) {
        const found = findIn(term);
        if (!found) break;
        matches.push(found);
      }
      if (matches.length < matcher.terms.length) continue;
      const related = matcher.optional.filter((o) => findIn(o.matcher)).length;
      if (related >= relatedThreshold(matcher.optional.length)) return { matcher, matches };
    } else if (matcher.optional.length) {
      const matches = matcher.optional.map((o) => findIn(o.matcher)).filter((m): m is PhraseMatch => m !== null);
      if (matches.length >= looseThreshold(matcher.optional.length)) return { matcher, matches };
    }
  }
  return null;
}

/** Trong các đoạn trích quanh mỗi lần khớp, lấy đoạn chứa nhiều từ khoá nhất (ưu tiên từ khoá bắt buộc) */
function bestSnippet(matches: PhraseMatch[], matcher: GroupMatcher): string {
  const score = (text: string) =>
    matcher.terms.filter((t) => t.find(text)).length * 100 + matcher.optional.filter((o) => o.matcher.find(text)).length;
  let best = matches[0].snippet.text;
  let bestScore = score(best);
  for (const m of matches.slice(1)) {
    const s = score(m.snippet.text);
    if (s > bestScore) [best, bestScore] = [m.snippet.text, s];
  }
  return best;
}

/** Vùng tô sáng trong đoạn trích: từ khoá bắt buộc, rồi từ phụ không chồng lên chúng */
function highlightRanges(snippet: string, matcher: GroupMatcher): HighlightRange[] {
  const ranges: HighlightRange[] = [
    ...matcher.terms.flatMap((t) => t.findAll(snippet)).map((r) => ({ ...r, kind: 'required' as const })),
    ...matcher.optional.flatMap((o) => o.matcher.findAll(snippet)).map((r) => ({ ...r, kind: 'optional' as const })),
  ];
  const kept: HighlightRange[] = [];
  for (const r of ranges) {
    if (!kept.some((k) => r.start < k.end && r.end > k.start)) kept.push(r);
  }
  // Các vùng cùng loại chỉ cách nhau khoảng trắng thì gộp lại ("Chủ tịch Quốc hội" là một vùng, không phải bốn)
  const merged: HighlightRange[] = [];
  for (const r of kept.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && last.kind === r.kind && /^\s*$/.test(snippet.slice(last.end, r.start))) last.end = r.end;
    else merged.push({ ...r });
  }
  return merged;
}

/** Ưu tiên URL canonical (gọn, không AMP) nếu cùng trang web với URL thật */
function displayUrl(page: ParsedPage): string {
  const canonical =
    page.canonicalUrl && siteOf(page.canonicalUrl) === siteOf(page.finalUrl) ? page.canonicalUrl : null;
  return cleanUrl(canonical ?? page.finalUrl);
}

export async function runPipeline(
  params: SearchParams,
  deps: PipelineDeps,
  emit: (event: PipelineEvent) => void,
  signal?: AbortSignal,
): Promise<ProgressState> {
  const startedAt = Date.now();
  const languages = SEARCH_LANGUAGES.filter((l) => params.languages.includes(l.code));
  const limit = pLimit(deps.concurrency ?? 5);
  const tasks: Promise<void>[] = [];
  const seen = new Set<string>();
  const accepted = new Set<string>();
  let stopSearching = false;
  const progress: ProgressState = {
    phase: languages.length ? 'translating' : 'searching',
    language: null,
    engine: null,
    page: null,
    pagesPerSource: params.pagesPerSource,
    sourcesDone: 0,
    totalSources: 0,
    sources: [],
    searchCalls: 0,
    cachedCalls: 0,
    candidates: 0,
    verified: 0,
    toVerify: 0,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
  };
  /** Ảnh chụp tiến trình (sao chép báo cáo nguồn vì các báo cáo còn tiếp tục thay đổi) */
  const snapshot = (): ProgressState => ({ ...progress, sources: progress.sources.map((r) => ({ ...r })) });
  const report = () => emit({ type: 'progress', progress: snapshot() });

  // 1. Kế hoạch truy vấn, kèm bản dịch nếu có chọn ngôn ngữ
  let plan = buildQueryPlan(params.query, params.region);
  if (languages.length) {
    report();
    plan = await translatePlan(plan);
  }
  const groupMatchers = buildGroupMatchers(plan, params.region);
  emit({ type: 'start', plan, params });

  async function translatePlan(base: QueryPlan): Promise<QueryPlan> {
    const translator = deps.translator;
    // Ngoài nước không tìm bằng tiếng Việt: không dịch được thì không có gì để tìm
    const withoutTranslation =
      params.region === 'foreign' ? 'Không có ngôn ngữ nào để tìm báo nước ngoài.' : 'Chỉ tìm bằng tiếng Việt.';
    if (!translator) {
      emit({ type: 'warning', message: `Chưa bật bộ dịch (TRANSLATOR=off). ${withoutTranslation}` });
      return base;
    }
    const [source] = base.groups;
    const optionalText = source.optional.join(' ');
    // Mỗi từ khoá bắt buộc dịch riêng (giữ nguyên cụm, phiên âm tên); phần từ phụ dịch theo nghĩa
    const texts = [...source.terms.map((t) => t.text), ...(optionalText ? [optionalText] : [])];
    // Mỗi phần dịch riêng: phần nào lỗi thì chỉ mất phần đó (vd từ phụ lỗi → vẫn tìm bằng từ khoá chính đã dịch)
    const settled = await Promise.allSettled(texts.map((text) => translator.translate(text, languages, signal)));
    if (signal?.aborted) return base;
    const failures = settled.flatMap((r, i) =>
      r.status === 'rejected' ? [{ text: texts[i], isTerm: i < source.terms.length, reason: r.reason }] : [],
    );
    const reasonOf = (err: unknown) => errorMessage(err).replace(/[.\s]+$/, '');
    if (failures.length === texts.length) {
      emit({ type: 'warning', message: `Không dịch được từ khoá: ${reasonOf(failures[0].reason)}. ${withoutTranslation}` });
      return base;
    }
    // Bộ dịch chính lỗi, đã dùng bộ dự phòng (dịch máy): báo cho người dùng biết bản dịch kém hơn
    const fallbackNotes = new Set(
      settled.flatMap((r) => (r.status === 'fulfilled' ? r.value.flatMap((t) => (t.fallbackNote ? [t.fallbackNote] : [])) : [])),
    );
    for (const note of fallbackNotes) {
      emit({
        type: 'warning',
        message: `${note}. Bản dịch máy chỉ có 1 cách viết và có thể chưa phiên âm tên người đúng cách báo chí nước đó viết.`,
      });
    }
    for (const f of failures) {
      const effect = f.isTerm ? withoutTranslation : 'Các ngôn ngữ khác chỉ tìm bằng từ khoá chính.';
      emit({ type: 'warning', message: `Không dịch được “${f.text}”: ${reasonOf(f.reason)}. ${effect}` });
    }
    const variantsOf = (index: number, code: string) => {
      const r = settled[index];
      return r.status === 'fulfilled' ? (r.value.find((t) => t.language === code)?.variants ?? []) : [];
    };
    const translations = languages.map((l) => ({
      language: l.code,
      terms: source.terms.map((_, i) => variantsOf(i, l.code)),
      optional: optionalText ? variantsOf(source.terms.length, l.code).slice(0, 1) : [],
    }));
    const translated = withTranslations(base, translations, params.region);
    const missing = languages.filter((l) => !translated.groups.some((g) => g.language === l.code));
    // Chỉ báo các ngôn ngữ thiếu do model không dịch (lỗi gọi API đã báo ở trên)
    if (missing.length && failures.length === 0) {
      emit({ type: 'warning', message: `Không có bản dịch cho: ${missing.map((l) => l.name).join(', ')}.` });
    }
    return translated;
  }

  const reject = (c: Candidate, reason: RejectReason, detail: string, title?: string): null => {
    progress.rejected++;
    c.source.rejected++;
    emit({
      type: 'rejected',
      item: {
        id: c.key,
        url: c.url,
        title: title || c.title,
        domain: hostnameOf(c.url),
        reason,
        detail,
        foundLanguage: c.source.language,
        foundVia: c.source.engine,
      },
    });
    return null;
  };

  /** Tải trang, lọc phạm vi lần 2 và xác minh cụm — chạy trong giới hạn tải song song. */
  async function checkPage(c: Candidate): Promise<CheckedPage | null> {
    if (signal?.aborted) return null;
    let page: ParsedPage;
    try {
      page = await deps.loadPage(cleanUrl(c.url), signal);
    } catch (err) {
      if (signal?.aborted) return null;
      if (err instanceof FetchError && err.kind === 'robots') return reject(c, 'robots', err.message);
      return reject(c, 'fetch_error', errorMessage(err));
    }

    // Lọc lần 2: theo URL thật sau chuyển hướng
    const region = classifyRegion(page.finalUrl);
    if (region !== params.region) {
      return reject(c, 'region', `Chuyển hướng tới ${hostnameOf(page.finalUrl)}: ${REGION_MISMATCH[region]}`, page.title);
    }

    const hit = matchGroups(groupMatchers, [page.mainText, page.description, page.title]);
    if (!hit) {
      if (page.usedReadability && matchGroups(groupMatchers, [page.fullText])) {
        return reject(c, 'outside_main', 'Từ khoá chỉ xuất hiện ngoài nội dung chính (menu, sidebar, footer, tin liên quan…)', page.title);
      }
      return reject(c, 'no_match', describeMiss(page.fullText), page.title);
    }
    return { page, hit, region };
  }

  /** Giải thích vì sao trang không khớp: tên dài hơn, thiếu từ khoá bắt buộc nào, hay không có gì */
  function describeMiss(fullText: string): string {
    for (const matcher of groupMatchers) {
      const longer = matcher.terms.length === 1 ? matcher.terms[0].findLongerName(fullText) : null;
      if (longer) return `Không có cụm chính xác, trang chỉ có “${longer}”`;
    }
    const source = groupMatchers[0];
    const terms = source.group.terms;
    if (terms.length === 0) {
      // Tìm liên quan: báo theo nhóm ngôn ngữ có tỉ lệ từ khớp cao nhất
      const scored = groupMatchers.map((m) => ({
        m,
        found: m.optional.filter((o) => o.matcher.find(fullText)).map((o) => o.word),
      }));
      const ratio = (x: (typeof scored)[number]) => x.found.length / Math.max(1, x.m.optional.length);
      const { m, found } = scored.reduce((a, b) => (ratio(b) > ratio(a) ? b : a));
      const need = looseThreshold(m.optional.length);
      return `Chỉ có ${found.length}/${m.optional.length} từ (cần ít nhất ${need})${found.length ? `: ${found.join(', ')}` : ''}`;
    }
    // Có đủ từ khoá chính nhưng thiếu nội dung liên quan: báo theo nhóm ngôn ngữ có nhiều từ liên quan nhất
    const withTerms = groupMatchers.filter((m) => m.terms.length && m.terms.every((t) => t.find(fullText)));
    if (withTerms.length) {
      const scored = withTerms.map((m) => ({ m, found: m.optional.filter((o) => o.matcher.find(fullText)).map((o) => o.word) }));
      const { m, found } = scored.reduce((a, b) => (b.found.length / b.m.optional.length > a.found.length / a.m.optional.length ? b : a));
      const keywords = m.group.terms.map((t) => `“${t.text}”`).join(', ');
      const need = relatedThreshold(m.optional.length);
      return `Có ${keywords} nhưng không liên quan tới nội dung đã nhập: chỉ có ${found.length}/${m.optional.length} từ liên quan (cần ít nhất ${need})${found.length ? `: ${found.join(', ')}` : ''}`;
    }
    if (terms.length > 1) {
      const missing = terms.filter((_, i) => !source.terms[i].find(fullText));
      const list = (missing.length ? missing : terms).map((t) => `“${t.text}”`).join(', ');
      return missing.length < terms.length ? `Thiếu từ khoá bắt buộc: ${list}` : `Không có từ khoá bắt buộc nào (${list})`;
    }
    const variants = plan.groups.flatMap((g) => g.terms.flatMap((t) => t.variants));
    const shown = variants.slice(0, 4).map((v) => `“${v}”`).join(' / ');
    const more = variants.length > 4 ? ` (và ${variants.length - 4} biến thể khác)` : '';
    return `Không tìm thấy ${shown}${more} trong trang`;
  }

  /** Trích ngày (có thể phải hỏi Wayback, chậm) — chạy ngoài giới hạn tải trang để không giữ chỗ. */
  async function finalize(c: Candidate, { page, hit, region }: CheckedPage): Promise<void> {
    const url = displayUrl(page);
    const range = `${formatDate(params.fromDate)}–${formatDate(params.toDate)}`;
    const outside = (d: ExtractedDate) => d.date < params.fromDate || d.date > params.toDate;
    // Bộ lọc ngày của Google không chặt (lọc theo ngày Google tự ước lượng, vd ngày cập nhật trang),
    // nên mọi bài đều phải xác nhận được ngày đăng nằm trong khoảng đã chọn.
    let date = page.date;
    if (date && outside(date)) {
      const detail = `Ngày đăng ${formatDate(date.date)} (${DATE_SOURCE_INFO[date.source].label}) nằm ngoài ${range}`;
      reject(c, 'out_of_range', detail, page.title);
      return;
    }
    if (!date) {
      const wayback = await deps.lookupWayback(url, signal).catch(() => null);
      const snippet = parseSnippetDate(c.dateText, new Date(c.searchedAt));
      if (signal?.aborted) return;
      // Trang đã được lưu trên Wayback từ trước ngày bắt đầu → chắc chắn đăng trước khoảng ngày đã chọn
      if (wayback && wayback.date < params.fromDate) {
        const detail = `Đã có trên Wayback Machine từ ${formatDate(wayback.date)}, tức đăng trước ${formatDate(params.fromDate)}`;
        reject(c, 'out_of_range', detail, page.title);
        return;
      }
      if (snippet && outside(snippet)) {
        reject(c, 'out_of_range', `Google ghi ngày ${formatDate(snippet.date)} (“${snippet.raw}”), nằm ngoài ${range}`, page.title);
        return;
      }
      // Ưu tiên Wayback (theo thứ tự nguồn ngày); bản lưu sau khoảng ngày chỉ cho biết bài đăng trước đó → dùng ngày Google
      date = wayback && !(snippet && wayback.date > params.toDate) ? wayback : snippet;
    }
    if (!date) {
      const detail = 'Không đọc được ngày đăng từ trang, Wayback Machine hay Google nên không xác nhận được bài nằm trong khoảng ngày';
      reject(c, 'no_date', detail, page.title);
      return;
    }

    // Gộp trùng theo URL hiển thị (canonical) — chạy đồng bộ nên không bị tranh chấp giữa các tác vụ
    const key = normalizeUrl(url);
    if (accepted.has(c.key) || accepted.has(key)) {
      progress.duplicates++;
      c.source.duplicates++;
      return;
    }
    accepted.add(c.key).add(key);
    progress.accepted++;
    c.source.accepted++;

    const { matcher, matches } = hit;
    const snippet = bestSnippet(matches, matcher);
    const mainText = [page.title, page.description, page.mainText].join('\n');
    const optionalFound = matcher.optional.filter((o) => o.matcher.find(mainText)).map((o) => o.word);
    emit({
      type: 'result',
      item: {
        id: key,
        url,
        title: page.title || c.title,
        domain: hostnameOf(url),
        sourceName: sourceNameOf(url) ?? page.siteName,
        region,
        date,
        snippet,
        highlights: highlightRanges(snippet, matcher),
        matchedVariant: matcher.group.terms.length ? matches.map((m) => m.variant).join(' + ') : optionalFound.join(', '),
        matchedLanguage: matcher.group.language,
        loose: matcher.terms.length === 0,
        optionalMatch: matcher.optional.length ? { found: optionalFound, total: matcher.optional.length } : null,
        foundLanguage: c.source.language,
        foundVia: c.source.engine,
        seo: page.seo ?? null,
      },
    });
  }

  async function verify(c: Candidate): Promise<void> {
    try {
      const checked = await limit(() => checkPage(c));
      if (checked && !signal?.aborted) await finalize(c, checked);
    } catch (err) {
      // Lỗi bất ngờ ở một trang không được làm hỏng cả lượt tìm
      reject(c, 'fetch_error', `Lỗi xử lý trang: ${errorMessage(err)}`);
    } finally {
      progress.verified++;
      report();
    }
  }

  /** Gọi search engine cho một trang kết quả trên cả khoảng ngày. Lỗi thì ghi vào báo cáo nguồn và trả null. */
  async function search(target: SearchTarget, page: number): Promise<SearchResponse | null> {
    const { group, engine, report: source } = target;
    try {
      const response = await deps.provider.search({
        engine,
        query: target.query,
        page,
        dateRange: { start: params.fromDate, end: params.toDate },
        locale: searchLocaleFor(params.region, group.language),
        signal,
      });
      progress.searchCalls++;
      if (response.fromCache) progress.cachedCalls++;
      return response;
    } catch (err) {
      if (signal?.aborted) return null;
      if (err instanceof SearchProviderError && err.fatal) {
        if (progress.searchCalls === 0) throw err; // vd sai API key: báo lỗi luôn
        emit({ type: 'warning', message: `Dừng tìm kiếm: ${err.message}` });
        stopSearching = true;
      }
      source.status = 'failed';
      source.error = errorMessage(err);
      const via = engine === 'google' ? '' : ` · ${engineLabel(engine)}`;
      emit({ type: 'warning', message: `${languageLabel(group.language)}${via}, trang ${page + 1}: ${source.error}` });
      return null;
    }
  }

  function collect(response: SearchResponse, source: SourceReport) {
    source.returned += response.items.length;
    for (const item of response.items) {
      const key = normalizeUrl(item.url);
      if (seen.has(key)) {
        progress.duplicates++;
        source.duplicates++;
        continue;
      }
      seen.add(key);
      progress.candidates++;
      const candidate: Candidate = { ...item, key, source, searchedAt: response.searchedAt };

      // Lọc lần 1: theo URL trên kết quả tìm kiếm
      if (isNonArticleUrl(item.url)) {
        reject(candidate, 'non_article', 'Mạng xã hội / nền tảng video');
        continue;
      }
      const region = classifyRegion(item.url);
      if (region !== params.region) {
        reject(candidate, 'region', REGION_MISMATCH[region]);
        continue;
      }
      progress.toVerify++;
      tasks.push(verify(candidate));
    }
    report();
  }

  // 2. Danh sách nguồn: tiếng Việt, rồi từng ngôn ngữ dịch trên Google và (Ngoài nước) công cụ địa phương
  const useLocalEngines = params.localEngines && params.region === 'foreign';
  const requested = params.pagesPerSource * RESULTS_PER_PAGE;
  const newReport = (language: string, engine: SearchEngine, query: string): SourceReport => ({
    id: `${language}:${engine}`,
    language,
    engine,
    query,
    requested,
    returned: 0,
    exhausted: false,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    status: 'waiting',
  });
  // Ngoài nước chỉ tìm bằng các ngôn ngữ đã chọn (nhóm tiếng Việt vẫn dùng để xác minh, không dùng để tìm)
  const searchGroups = plan.groups.filter((g) => !(params.region === 'foreign' && g.language === SOURCE_LANGUAGE));
  const targets: SearchTarget[] = searchGroups.flatMap((group) => {
    const list: SearchTarget[] = [
      { group, engine: 'google', query: group.searchQuery, report: newReport(group.language, 'google', group.searchQuery) },
    ];
    const local = SEARCH_LANGUAGES.find((l) => l.code === group.language)?.localEngine;
    if (useLocalEngines && local) {
      const query = buildLocalQuery(group, local);
      list.push({ group, engine: local, query, report: newReport(group.language, local, query) });
    }
    return list;
  });
  // Ngôn ngữ đã chọn nhưng không có bản dịch: vẫn ghi vào báo cáo để người dùng biết vì sao không có kết quả
  const untranslated = languages
    .filter((l) => !plan.groups.some((g) => g.language === l.code))
    .map((l) => ({ ...newReport(l.code, 'google', ''), status: 'untranslated' as const }));
  progress.sources = [...targets.map((t) => t.report), ...untranslated];
  progress.totalSources = targets.length;

  // 3. Tìm lần lượt từng nguồn: tối đa N trang (10 kết quả/trang) trên cả khoảng ngày đã chọn
  progress.phase = 'searching';
  for (const target of targets) {
    const source = target.report;
    if (signal?.aborted || stopSearching) {
      source.status = 'stopped';
      continue;
    }
    source.status = 'searching';
    progress.language = target.group.language;
    progress.engine = target.engine;
    for (let page = 0; page < params.pagesPerSource; page++) {
      if (signal?.aborted || stopSearching) break;
      progress.page = page + 1;
      report();
      const response = await search(target, page);
      if (!response) break; // lỗi: đã ghi vào báo cáo nguồn
      collect(response, source);
      if (!response.hasMore || response.items.length === 0) {
        source.exhausted = true;
        break;
      }
    }
    if (source.status === 'searching') source.status = signal?.aborted ? 'stopped' : 'done';
    progress.sourcesDone++;
    report();
  }

  progress.phase = 'verifying';
  progress.language = null;
  progress.engine = null;
  progress.page = null;
  report();
  await Promise.all(tasks);

  progress.phase = 'done';
  emit({ type: 'done', progress: snapshot(), durationMs: Date.now() - startedAt, aborted: Boolean(signal?.aborted) });
  return progress;
}
