/**
 * Pipeline tìm bài (SerpApi để khám phá, các module nội bộ để xác minh):
 *   A. đọc tham số → B. lập truy vấn (dịch từ khoá sang các ngôn ngữ đã chọn, mỗi ngôn ngữ 1 truy vấn chính)
 *   → C. tìm qua SerpApi trong ngân sách lượt tìm (lỗi tạm thời thử lại 1 lần), tối đa N trang mỗi nguồn
 *   → D/E. gộp kết quả, khử trùng URL (giữ lại các nguồn đã tìm ra mỗi URL)
 *   → lọc theo URL (domain bị chặn, phạm vi, trang chủ)
 *   → F. tải trang song song có giới hạn → lọc lần 2 theo URL thật (Ngoài nước: không nhận bài viết bằng tiếng Việt,
 *     trừ báo nước ngoài tiếng Việt như BBC, VOA) → xác minh từ khoá trong nội dung (exact / alias), cụm loại trừ
 *     → hồ sơ nguồn (quốc gia, bài gốc / đăng lại) theo chính sách nguồn → trích ngày đăng
 *     Trang không tải được và bài đăng mạng xã hội: chỉ xét tiêu đề + đoạn trích Google → nhóm "Chưa xác minh"
 *   → G. phát kết quả. Ngôn ngữ nào còn thiếu kết quả và còn ngân sách thì chạy thêm truy vấn bổ sung
 *     (cách diễn đạt khác; Trong nước thêm mục Tin tức của Google) ngay khi các bài của ngôn ngữ đó kiểm tra xong,
 *     không chờ cả lượt.
 * Các phụ thuộc có I/O (search, tải trang, Wayback, dịch) được truyền vào để test được.
 */
import pLimit from 'p-limit';
import { SEARCH_LANGUAGES } from '@/config/languages';
import { parseDate, parseSnippetDate } from './date-extractor';
import { FetchError } from './fetcher';
import { DATE_SOURCE_INFO, formatDate } from './labels';
import { isVietnameseText } from './language-detect';
import { PhraseMatcher, type PhraseMatch } from './matcher';
import type { ParsedPage } from './page-parser';
import { domainListed, profilePublisher } from './publisher';
import {
  buildLocalQuery,
  buildQueryPlan,
  buildSearchQuery,
  cleanPhrase,
  hasMeaningfulOptional,
  optionalWords,
  removeDiacritics,
  searchLocaleFor,
  withTranslations,
} from './query-builder';
import { LOOSE_MIN_RATIO, termAlternatives } from './query-syntax';
import { classifyRegion, hostnameOf, isForeignVietnameseSource, isHomePage, socialPlatformOf, sourceNameOf } from './region';
import { SEARCH_LIMITS } from './search-params';
import {
  SearchProviderError,
  type SearchEngine,
  type SearchProvider,
  type SearchResponse,
  type SearchResultItem,
} from './search/types';
import { sourceLabel } from './source-report';
import type { Translator } from './translate/types';
import {
  type ArticleResult,
  type ConditionCheck,
  type EvidenceLocation,
  type ExtractedDate,
  type HighlightRange,
  type PipelineEvent,
  type ProgressState,
  type PublisherProfile,
  type QueryGroup,
  type QueryPlan,
  type Region,
  type RejectReason,
  type SearchParams,
  type SearchVertical,
  type SourceReport,
  type Verification,
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
  /** Thời gian chờ trước khi thử lại lượt tìm lỗi tạm thời, mặc định 1,5 giây */
  retryDelayMs?: number;
}

interface Candidate extends SearchResultItem {
  key: string;
  /** Nguồn đã tìm ra đầu tiên (để đếm vào báo cáo của nguồn đó) */
  source: SourceReport;
  searchedAt: string;
  /** Mọi nguồn đã tìm ra URL này (nhãn hiển thị) */
  foundBy: string[];
}

/** Một truy vấn chạy trên một công cụ tìm kiếm, kèm báo cáo của nó */
interface SearchTarget {
  group: QueryGroup;
  engine: SearchEngine;
  vertical: SearchVertical;
  query: string;
  report: SourceReport;
}

/** Bộ khớp của một nhóm truy vấn: từng từ khoá bắt buộc + các từ phụ */
interface GroupMatcher {
  group: QueryGroup;
  terms: PhraseMatcher[];
  /** Với từng từ khoá: các biến thể tính là "nguyên văn" (đã bỏ dấu, viết thường); còn lại là alias */
  exact: Set<string>[];
  optional: { word: string; matcher: PhraseMatcher }[];
}

interface GroupHit {
  matcher: GroupMatcher;
  /** Lần khớp đầu tiên của từng từ khoá bắt buộc (khi tìm liên quan: của từng từ đã nhập) */
  matches: PhraseMatch[];
  /** Vị trí của từng lần khớp, cùng thứ tự với `matches` */
  where: EvidenceLocation[];
}

interface CheckedPage {
  page: ParsedPage;
  hit: GroupHit;
  region: Region;
}

interface EvidenceText {
  text: string;
  where: EvidenceLocation;
}

const REGION_MISMATCH: Record<Region, string> = {
  domestic: 'Trang trong nước (đuôi .vn hoặc có trong danh sách báo VN)',
  foreign: 'Trang nước ngoài (không phải .vn, không có trong danh sách báo VN)',
};

/** Số kết quả mỗi trang của mọi công cụ tìm kiếm đang dùng */
const RESULTS_PER_PAGE = 10;
/** Ngôn ngữ có ít hơn chừng này bài (kể cả chưa xác minh) sau truy vấn chính thì chạy truy vấn bổ sung */
const GAP_TARGET = 3;
/** Số truy vấn bổ sung tối đa cho mỗi ngôn ngữ: mục Tin tức (Trong nước) + cách diễn đạt khác */
const MAX_TIER2_PER_GROUP = 2;
const DEFAULT_RETRY_DELAY_MS = 1_500;
/** Lỗi tải trang vẫn xét được bằng tiêu đề + đoạn trích Google (trang PDF, ảnh… thì không phải bài viết) */
const SNIPPET_FALLBACK_KINDS = new Set(['robots', 'http', 'blocked', 'timeout', 'network']);

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const exactKey = (v: string) => removeDiacritics(v).toLowerCase().replace(/\s+/g, ' ').trim();

const looseThreshold = (total: number) => Math.max(1, Math.ceil(total * LOOSE_MIN_RATIO));

function buildGroupMatchers(plan: QueryPlan, region: Region): GroupMatcher[] {
  const [source] = plan.groups;
  return plan.groups.map((group) => {
    // Toàn hư từ (vd "của và") thì vẫn dùng các từ đó để khỏi trống
    const meaningful = optionalWords(group.optional, group.language);
    const words = meaningful.length ? meaningful : cleanPhrase(group.optional.join(' ')).split(' ').filter(Boolean);
    // Tiếng Nga biến cách từ cuối của tên / cụm (То Лам → То Лама, Дания → Дании)
    const inflection = group.language === 'ru' ? ('ru' as const) : undefined;
    return {
      group,
      // Nhóm dịch khớp cả cách viết gốc của từ khoá: báo nước ngoài hay giữ nguyên tên có dấu ("President Tô Lâm")
      terms: group.terms.map(
        (t, i) => new PhraseMatcher(group === source ? t.variants : [...t.variants, ...source.terms[i].variants], { inflection }),
      ),
      // Nguyên văn: từng lựa chọn người dùng nhập (kể cả bản không dấu) và bản dịch chính của ngôn ngữ đó;
      // đảo thứ tự tên, bản dịch phụ là alias
      exact: group.terms.map((t, i) => {
        const typed = termAlternatives(source.terms[i].text);
        return new Set([...typed, ...(group === source ? [] : t.variants.slice(0, 1))].map(exactKey));
      }),
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
 *  - có từ khoá bắt buộc → phải có đủ tất cả; các từ còn lại không bắt buộc, chỉ dùng để báo mức liên quan
 *    (bản dịch từ phụ hay lệch nghĩa, vd "đi" → "go", nên không dùng để loại bài);
 *  - không có (tìm liên quan) → phải có ít nhất LOOSE_MIN_RATIO số từ.
 */
function matchGroups(matchers: GroupMatcher[], texts: EvidenceText[]): GroupHit | null {
  const findIn = (m: PhraseMatcher): { match: PhraseMatch; where: EvidenceLocation } | null => {
    for (const t of texts) {
      const match = m.find(t.text);
      if (match) return { match, where: t.where };
    }
    return null;
  };
  for (const matcher of matchers) {
    const found = matcher.terms.length
      ? matcher.terms.map(findIn)
      : matcher.optional.map((o) => findIn(o.matcher)).filter((f) => f !== null);
    const complete = matcher.terms.length
      ? found.every((f) => f !== null)
      : matcher.optional.length > 0 && found.length >= looseThreshold(matcher.optional.length);
    if (complete) {
      const hits = found as { match: PhraseMatch; where: EvidenceLocation }[];
      return { matcher, matches: hits.map((h) => h.match), where: hits.map((h) => h.where) };
    }
  }
  return null;
}

/** Trạng thái từng từ khoá bắt buộc: nguyên văn / alias khi đã đọc trang, "chưa xác minh" khi chỉ có đoạn trích */
function conditionsOf(hit: GroupHit, verification: Verification, terms: QueryGroup['terms']): ConditionCheck[] {
  const { matcher } = hit;
  if (!matcher.terms.length) return [];
  return hit.matches.map((m, i) => ({
    term: terms[i].text,
    status:
      verification === 'unverified' ? 'unverified' : matcher.exact[i].has(exactKey(m.variant)) ? 'matched_exact' : 'matched_alias',
    variant: m.variant,
    where: hit.where[i],
  }));
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

/** Ngày Google ghi cho kết quả: thời điểm đăng chính xác của mục Tin tức, hoặc chữ ngày cạnh kết quả */
function googleDate(c: Candidate): ExtractedDate | null {
  if (c.publishedAt) {
    const iso = c.publishedAt.trim().replace(' ', 'T').replace(/\s*UTC$/i, 'Z');
    const date = parseDate(iso, 'snippet', { estimated: true });
    if (date) return { ...date, raw: c.publishedAt };
  }
  return parseSnippetDate(c.dateText, new Date(c.searchedAt));
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

export async function runPipeline(
  params: SearchParams,
  deps: PipelineDeps,
  emit: (event: PipelineEvent) => void,
  signal?: AbortSignal,
): Promise<ProgressState> {
  const startedAt = Date.now();
  const budget = params.budget ?? SEARCH_LIMITS.defaultBudget;
  const exclude = params.exclude ?? [];
  const sourcePolicy = params.sourcePolicy ?? 'labeled';
  const excludeRepublished = params.excludeRepublished ?? true;
  const allowDomains = params.allowDomains ?? [];
  const denyDomains = params.denyDomains ?? [];
  const languages = SEARCH_LANGUAGES.filter((l) => params.languages.includes(l.code));
  const limit = pLimit(deps.concurrency ?? 5);
  const retryDelayMs = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let tasks: Promise<void>[] = [];
  /** Các tác vụ kiểm tra bài theo ngôn ngữ của nguồn tìm ra — để biết ngôn ngữ nào đã kiểm tra xong */
  const tasksByLanguage = new Map<string, Promise<void>[]>();
  const candidates = new Map<string, Candidate>();
  const accepted = new Set<string>();
  /** Số bài được nhận (kể cả chưa xác minh) theo ngôn ngữ của nguồn tìm ra — để biết ngôn ngữ nào còn thiếu */
  const acceptedByLanguage = new Map<string, number>();
  const plannedQueries = new Set<string>();
  let stopSearching = false;
  let budgetWarned = false;
  let verifyStartedAt: number | null = null;
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
    metrics: {
      budget,
      queriesPlanned: 0,
      queriesDeduped: 0,
      retries: 0,
      searchErrors: 0,
      fetchOk: 0,
      fetchFailed: 0,
      keywordPassed: 0,
      unverified: 0,
      sourceVerified: 0,
      translateMs: 0,
      searchMs: 0,
      verifyMs: 0,
    },
  };
  const metrics = progress.metrics;
  /** Ảnh chụp tiến trình (sao chép báo cáo nguồn vì các báo cáo còn tiếp tục thay đổi) */
  const snapshot = (): ProgressState => ({
    ...progress,
    sources: progress.sources.map((r) => ({ ...r })),
    metrics: { ...metrics },
  });
  const report = () => emit({ type: 'progress', progress: snapshot() });
  /** Lượt tìm thật sự tốn quota (không tính lượt lấy từ bộ nhớ đệm) */
  const paidCalls = () => progress.searchCalls - progress.cachedCalls;

  // A/B. Kế hoạch truy vấn, kèm bản dịch nếu có chọn ngôn ngữ
  let plan = buildQueryPlan(params.query, params.region, { exclude });
  if (languages.length) {
    report();
    const translateStart = Date.now();
    plan = await translatePlan(plan);
    metrics.translateMs = Date.now() - translateStart;
  }
  const groupMatchers = buildGroupMatchers(plan, params.region);
  const excludeMatcher = exclude.length
    ? new PhraseMatcher([...exclude, ...exclude.map(removeDiacritics)])
    : null;
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
    // Từ phụ chỉ gồm từ quá chung ("đi", "về") thì không dịch: bản dịch lệch nghĩa kéo kết quả lạc chủ đề
    const optionalText = hasMeaningfulOptional(source.optional) ? source.optional.join(' ') : '';
    // Mỗi từ khoá bắt buộc (mỗi lựa chọn của nhóm OR) dịch riêng (giữ nguyên cụm, phiên âm tên); phần từ phụ dịch theo nghĩa
    const termTexts = source.terms.map((t) => termAlternatives(t.text));
    const texts = [...termTexts.flat(), ...(optionalText ? [optionalText] : [])];
    const termCount = termTexts.flat().length;
    // Mỗi phần dịch riêng: phần nào lỗi thì chỉ mất phần đó (vd từ phụ lỗi → vẫn tìm bằng từ khoá chính đã dịch)
    const settled = await Promise.allSettled(texts.map((text) => translator.translate(text, languages, signal)));
    if (signal?.aborted) return base;
    const failures = settled.flatMap((r, i) =>
      r.status === 'rejected' ? [{ text: texts[i], isTerm: i < termCount, reason: r.reason }] : [],
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
    // Vị trí bắt đầu của từng từ khoá trong `texts` (một từ khoá có thể có nhiều lựa chọn OR)
    const offsets = termTexts.map((_, i) => termTexts.slice(0, i).reduce((n, alts) => n + alts.length, 0));
    const translations = languages.map((l) => {
      const optionalVariants = optionalText ? variantsOf(termCount, l.code) : [];
      return {
        language: l.code,
        terms: termTexts.map((alts, i) => alts.flatMap((_, j) => variantsOf(offsets[i] + j, l.code))),
        optional: optionalVariants.slice(0, 1),
        altOptional: optionalVariants.slice(1),
      };
    });
    const translated = withTranslations(base, translations, params.region, { exclude });
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

  /**
   * Chính sách nguồn (chỉ áp dụng cho Ngoài nước): loại bài đăng lại từ báo Việt Nam khi có bằng chứng.
   * Mặc định nhận mọi domain có đủ nội dung (danh sách báo trong sources.ts chỉ để ghi quốc gia); chỉ khi chọn
   * chế độ chặt mới loại trang chưa xác định được quốc gia. Trả về false nếu đã loại.
   */
  function passesSourcePolicy(c: Candidate, publisher: PublisherProfile, region: Region, title?: string): boolean {
    if (region !== 'foreign') return true;
    if (excludeRepublished && publisher.origin === 'republished') {
      reject(c, 'republished', `Bài đăng lại / dịch lại từ báo Việt Nam: ${publisher.signals.join('; ')}`, title);
      return false;
    }
    if (sourcePolicy === 'verified' && !publisher.verified) {
      const why = publisher.signals.join('; ');
      reject(
        c,
        'source_unverified',
        `Chưa xác định được quốc gia nhà xuất bản: ${why}. Đang chọn “Chỉ nhận báo xác định được quốc gia”; chọn “Nhận mọi trang có nội dung phù hợp” hoặc thêm domain vào “Domain luôn nhận”.`,
        title,
      );
      return false;
    }
    return true;
  }

  /** Bài có cụm loại trừ trong các văn bản đã xét → loại. Trả về false nếu đã loại. */
  function passesExclude(c: Candidate, texts: string[], title?: string): boolean {
    const found = excludeMatcher && texts.map((t) => excludeMatcher.find(t)).find((m) => m !== null);
    if (found) {
      reject(c, 'excluded', `Có cụm loại trừ “${found.matchedText}”`, title);
      return false;
    }
    return true;
  }

  /** Tải trang, lọc phạm vi lần 2 và xác minh cụm — chạy trong giới hạn tải song song. */
  async function checkPage(c: Candidate): Promise<CheckedPage | null> {
    if (signal?.aborted) return null;
    let page: ParsedPage;
    try {
      page = await deps.loadPage(cleanUrl(c.url), signal);
      metrics.fetchOk++;
    } catch (err) {
      if (signal?.aborted) return null;
      metrics.fetchFailed++;
      const message = errorMessage(err);
      // Không đọc được trang: còn tiêu đề + đoạn trích của Google thì xếp vào nhóm "Chưa xác minh"
      const fallback = err instanceof FetchError && SNIPPET_FALLBACK_KINDS.has(err.kind);
      if (fallback && checkSnippet(c, 'news', message)) return null;
      const detail = fallback ? `${message}; tiêu đề / đoạn trích Google cũng không có đủ từ khoá` : message;
      if (err instanceof FetchError && err.kind === 'robots') return reject(c, 'robots', detail);
      return reject(c, 'fetch_error', detail);
    }

    // Lọc lần 2: theo URL thật sau chuyển hướng
    if (domainListed(page.finalUrl, denyDomains)) {
      return reject(c, 'denied_domain', `Chuyển hướng tới ${hostnameOf(page.finalUrl)}, nằm trong danh sách domain bị loại`, page.title);
    }
    const region = classifyRegion(page.finalUrl);
    if (region !== params.region) {
      return reject(c, 'region', `Chuyển hướng tới ${hostnameOf(page.finalUrl)}: ${REGION_MISMATCH[region]}`, page.title);
    }
    // Báo nước ngoài là báo viết bằng tiếng nước ngoài: bài tiếng Việt trên tên miền nước ngoài thường là
    // trang Việt Nam (.com, .net…), chỉ nhận khi là báo nước ngoài tiếng Việt đã biết (BBC, VOA, RFI…)
    if (region === 'foreign' && !isForeignVietnameseSource(page.finalUrl) && isVietnameseText(page.mainText)) {
      return reject(
        c,
        'region',
        'Bài viết bằng tiếng Việt trên trang không thuộc danh sách báo nước ngoài tiếng Việt (src/config/sources.ts)',
        page.title,
      );
    }

    const hit = matchGroups(groupMatchers, [
      { text: page.mainText, where: 'main' },
      { text: page.description, where: 'description' },
      { text: page.title, where: 'title' },
    ]);
    if (!hit) {
      if (page.usedReadability && matchGroups(groupMatchers, [{ text: page.fullText, where: 'main' }])) {
        return reject(c, 'outside_main', 'Từ khoá chỉ xuất hiện ngoài nội dung chính (menu, sidebar, footer, tin liên quan…)', page.title);
      }
      return reject(c, 'no_match', describeMiss(page.fullText), page.title);
    }
    if (!passesExclude(c, [page.title, page.description, page.mainText], page.title)) return null;
    metrics.keywordPassed++;
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
    const publisher = profilePublisher({
      url: page.finalUrl,
      region,
      kind: 'news',
      page,
      text: page.mainText,
      allowDomains,
      googleSourceName: c.sourceName,
    });
    if (!passesSourcePolicy(c, publisher, region, page.title)) return;

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
      const snippet = googleDate(c);
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

    accept(c, {
      url,
      title: page.title || c.title,
      sourceName: sourceNameOf(url) ?? page.siteName ?? c.sourceName ?? null,
      region,
      date,
      hit,
      text: [page.title, page.description, page.mainText].join('\n'),
      seo: page.seo ?? null,
      verification: 'verified',
      publisher,
    });
  }

  /** Gộp trùng theo URL hiển thị (canonical) rồi phát kết quả — chạy đồng bộ nên không bị tranh chấp giữa các tác vụ */
  function accept(
    c: Candidate,
    a: Pick<ArticleResult, 'url' | 'title' | 'sourceName' | 'region' | 'date' | 'seo' | 'verification' | 'publisher'> & {
      hit: GroupHit;
      text: string;
    },
  ): void {
    const key = normalizeUrl(a.url);
    if (accepted.has(c.key) || accepted.has(key)) {
      progress.duplicates++;
      c.source.duplicates++;
      return;
    }
    accepted.add(c.key).add(key);
    progress.accepted++;
    c.source.accepted++;
    acceptedByLanguage.set(c.source.language, (acceptedByLanguage.get(c.source.language) ?? 0) + 1);
    if (a.verification === 'unverified') metrics.unverified++;
    if (a.publisher.verified) metrics.sourceVerified++;

    const { matcher, matches } = a.hit;
    const snippet = bestSnippet(matches, matcher);
    const optionalFound = matcher.optional.filter((o) => o.matcher.find(a.text)).map((o) => o.word);
    emit({
      type: 'result',
      item: {
        id: key,
        url: a.url,
        title: a.title,
        domain: hostnameOf(a.url),
        sourceName: a.sourceName,
        region: a.region,
        date: a.date,
        snippet,
        highlights: highlightRanges(snippet, matcher),
        matchedVariant: matcher.group.terms.length ? matches.map((m) => m.variant).join(' + ') : optionalFound.join(', '),
        matchedLanguage: matcher.group.language,
        loose: matcher.terms.length === 0,
        optionalMatch: matcher.optional.length ? { found: optionalFound, total: matcher.optional.length } : null,
        foundLanguage: c.source.language,
        foundVia: c.source.engine,
        seo: a.seo,
        verification: a.verification,
        conditions: conditionsOf(a.hit, a.verification, plan.groups[0].terms),
        publisher: a.publisher,
        foundBy: [...c.foundBy],
      },
    });
  }

  /**
   * Chỉ có tiêu đề + đoạn trích của Google (bài đăng mạng xã hội, hoặc trang không tải được): bài có đủ từ khoá
   * trong đó thì vào nhóm "Chưa xác minh" — không khẳng định từ khoá có trong nội dung chính.
   * Bài đăng mạng xã hội xét phạm vi theo ngôn ngữ bài đăng. Google thường không ghi ngày cho bài đăng mạng xã hội:
   * khi đó vẫn nhận (Google đã lọc theo khoảng ngày) và để "Không rõ ngày".
   * Trả về false khi đoạn trích không có đủ từ khoá (người gọi tự quyết định lý do loại).
   */
  function checkSnippet(c: Candidate, kind: 'news' | 'social', fetchFailure?: string): boolean {
    const platform = kind === 'social' ? socialPlatformOf(c.url) : null;
    const text = [c.title, c.snippet].join('\n');
    const hit = matchGroups(groupMatchers, [
      { text: c.snippet, where: 'snippet' },
      { text: c.title, where: 'snippet' },
    ]);
    if (!hit) {
      if (platform) reject(c, 'no_match', `Bài đăng ${platform}: ${describeMiss(text)} (chỉ xét tiêu đề và đoạn trích của Google)`);
      return Boolean(platform);
    }
    const why = fetchFailure ? `Không tải được trang (${fetchFailure}); ` : '';
    if (!passesExclude(c, [c.title, c.snippet])) return true;
    const vietnamese = isVietnameseText(text);
    let region: Region;
    if (platform) {
      region = vietnamese ? 'domestic' : 'foreign';
      if (region !== params.region) {
        const written = region === 'domestic' ? 'viết bằng tiếng Việt (Trong nước)' : 'không viết bằng tiếng Việt (Ngoài nước)';
        reject(c, 'region', `Bài đăng ${platform} ${written}`);
        return true;
      }
    } else {
      region = classifyRegion(c.url);
      if (region === 'foreign' && vietnamese && !isForeignVietnameseSource(c.url)) {
        reject(c, 'region', `${why}đoạn trích viết bằng tiếng Việt trên trang không thuộc danh sách báo nước ngoài tiếng Việt`);
        return true;
      }
    }
    metrics.keywordPassed++;
    const publisher = profilePublisher({
      url: c.url,
      region,
      kind,
      page: null,
      text,
      allowDomains,
      googleSourceName: c.sourceName,
    });
    if (!passesSourcePolicy(c, publisher, region)) return true;
    const date = googleDate(c);
    if (date && (date.date < params.fromDate || date.date > params.toDate)) {
      const range = `${formatDate(params.fromDate)}–${formatDate(params.toDate)}`;
      reject(c, 'out_of_range', `${why}Google ghi ngày ${formatDate(date.date)} (“${date.raw}”), nằm ngoài ${range}`);
      return true;
    }
    if (fetchFailure) publisher.signals.unshift(`Không tải được trang: ${fetchFailure}`);
    accept(c, {
      url: cleanUrl(c.url),
      title: c.title,
      sourceName: platform ? `${platform} · Mạng xã hội` : (sourceNameOf(c.url) ?? c.sourceName ?? null),
      region,
      date,
      hit,
      text,
      seo: null,
      verification: 'unverified',
      publisher,
    });
    return true;
  }

  async function verify(c: Candidate): Promise<void> {
    verifyStartedAt ??= Date.now();
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

  /**
   * Gọi search engine cho một trang kết quả trên cả khoảng ngày; lỗi tạm thời thử lại 1 lần.
   * Lỗi thì ghi vào báo cáo nguồn và trả null.
   */
  async function search(target: SearchTarget, page: number): Promise<SearchResponse | null> {
    const { group, engine, vertical, report: source } = target;
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      try {
        const response = await deps.provider.search({
          engine,
          ...(vertical === 'news' ? { vertical } : {}),
          query: target.query,
          page,
          dateRange: { start: params.fromDate, end: params.toDate },
          locale: searchLocaleFor(params.region, group.language),
          signal,
        });
        metrics.searchMs += Date.now() - started;
        progress.searchCalls++;
        if (response.fromCache) progress.cachedCalls++;
        return response;
      } catch (err) {
        metrics.searchMs += Date.now() - started;
        if (signal?.aborted) return null;
        const fatal = err instanceof SearchProviderError && err.fatal;
        if (!fatal && attempt === 0) {
          metrics.retries++;
          await sleep(retryDelayMs, signal);
          if (signal?.aborted) return null;
          continue;
        }
        metrics.searchErrors++;
        if (fatal) {
          if (progress.searchCalls === 0) throw err; // vd sai API key: báo lỗi luôn
          emit({ type: 'warning', message: `Dừng tìm kiếm: ${errorMessage(err)}` });
          stopSearching = true;
        }
        source.status = 'failed';
        source.error = errorMessage(err);
        emit({ type: 'warning', message: `${sourceLabel(group.language, engine, vertical, source.tier)}, trang ${page + 1}: ${source.error}` });
        return null;
      }
    }
  }

  function collect(response: SearchResponse, source: SourceReport) {
    source.returned += response.items.length;
    const label = sourceLabel(source.language, source.engine, source.vertical, source.tier);
    let fresh = 0;
    for (const item of response.items) {
      const key = normalizeUrl(item.url);
      const known = candidates.get(key);
      if (known) {
        // Giữ lại mọi nguồn đã tìm ra URL (để truy vết), không xử lý lại
        if (!known.foundBy.includes(label)) known.foundBy.push(label);
        progress.duplicates++;
        source.duplicates++;
        continue;
      }
      fresh++;
      progress.candidates++;
      const candidate: Candidate = { ...item, key, source, searchedAt: response.searchedAt, foundBy: [label] };
      candidates.set(key, candidate);

      // Lọc lần 1: theo URL trên kết quả tìm kiếm
      if (domainListed(item.url, denyDomains)) {
        reject(candidate, 'denied_domain', 'Domain nằm trong danh sách bị loại');
        continue;
      }
      if (socialPlatformOf(item.url)) {
        progress.toVerify++;
        progress.verified++;
        checkSnippet(candidate, 'social');
        continue;
      }
      if (isHomePage(item.url)) {
        reject(candidate, 'non_article', 'Trang chủ của trang web, không phải bài viết');
        continue;
      }
      const region = classifyRegion(item.url);
      if (region !== params.region) {
        reject(candidate, 'region', REGION_MISMATCH[region]);
        continue;
      }
      progress.toVerify++;
      const task = verify(candidate);
      tasks.push(task);
      const byLanguage = tasksByLanguage.get(source.language) ?? [];
      byLanguage.push(task);
      tasksByLanguage.set(source.language, byLanguage);
    }
    report();
    return fresh;
  }

  // C. Danh sách nguồn: tiếng Việt, rồi từng ngôn ngữ dịch trên Google và (Ngoài nước) công cụ địa phương
  const useLocalEngines = params.localEngines && params.region === 'foreign';
  const newReport = (
    language: string,
    engine: SearchEngine,
    query: string,
    { vertical = 'web', tier = 1, suffix = '', pages = params.pagesPerSource }: { vertical?: SearchVertical; tier?: 1 | 2; suffix?: string; pages?: number } = {},
  ): SourceReport => ({
    id: `${language}:${engine}${suffix}`,
    language,
    engine,
    vertical,
    tier,
    query,
    requested: pages * RESULTS_PER_PAGE,
    returned: 0,
    exhausted: false,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    status: 'waiting',
  });

  /** Thêm truy vấn vào kế hoạch nếu chưa có truy vấn y hệt (cùng engine, mục, ngôn ngữ / quốc gia) */
  function addToPlan(target: SearchTarget): SearchTarget | null {
    const locale = searchLocaleFor(params.region, target.group.language);
    const key = JSON.stringify([target.engine, target.vertical, target.query, locale]);
    metrics.queriesPlanned++;
    if (plannedQueries.has(key)) {
      metrics.queriesDeduped++;
      return null;
    }
    plannedQueries.add(key);
    return target;
  }

  // Ngoài nước chỉ tìm bằng các ngôn ngữ đã chọn (nhóm tiếng Việt vẫn dùng để xác minh, không dùng để tìm)
  const searchGroups = plan.groups.filter((g) => !(params.region === 'foreign' && g.language === SOURCE_LANGUAGE));
  const tier1: SearchTarget[] = searchGroups.flatMap((group) => {
    const list: (SearchTarget | null)[] = [
      addToPlan({ group, engine: 'google', vertical: 'web', query: group.searchQuery, report: newReport(group.language, 'google', group.searchQuery) }),
    ];
    const local = SEARCH_LANGUAGES.find((l) => l.code === group.language)?.localEngine;
    if (useLocalEngines && local) {
      const query = buildLocalQuery(group, local);
      list.push(addToPlan({ group, engine: local, vertical: 'web', query, report: newReport(group.language, local, query) }));
    }
    return list.filter((t): t is SearchTarget => t !== null);
  });
  // Ngôn ngữ đã chọn nhưng không có bản dịch: vẫn ghi vào báo cáo để người dùng biết vì sao không có kết quả
  const untranslated = languages
    .filter((l) => !plan.groups.some((g) => g.language === l.code))
    .map((l) => ({ ...newReport(l.code, 'google', ''), status: 'untranslated' as const }));
  progress.sources = [...tier1.map((t) => t.report), ...untranslated];
  progress.totalSources = tier1.length;
  const mainCalls = tier1.length * params.pagesPerSource;
  if (budget < mainCalls) {
    emit({
      type: 'warning',
      message: `Số lượt tìm tối đa (${budget}) ít hơn số lượt cần cho ${params.pagesPerSource * RESULTS_PER_PAGE} kết quả mỗi nguồn (${mainCalls} lượt): các nguồn sau sẽ lấy ít kết quả hơn hoặc không được tìm.`,
    });
  }

  /** Tìm lần lượt từng nguồn: tối đa N trang (10 kết quả/trang), dừng khi hết ngân sách lượt tìm */
  async function runTargets(targets: SearchTarget[], pages: number) {
    progress.phase = 'searching';
    for (const target of targets) {
      const source = target.report;
      if (signal?.aborted || stopSearching || paidCalls() >= budget) {
        source.status = signal?.aborted || stopSearching ? 'stopped' : 'skipped';
        if (source.status === 'skipped') warnBudget();
        progress.sourcesDone++;
        continue;
      }
      source.status = 'searching';
      progress.language = target.group.language;
      progress.engine = target.engine;
      for (let page = 0; page < pages; page++) {
        if (signal?.aborted || stopSearching) break;
        if (paidCalls() >= budget) {
          warnBudget();
          break;
        }
        progress.page = page + 1;
        report();
        const response = await search(target, page);
        if (!response) break; // lỗi: đã ghi vào báo cáo nguồn
        const fresh = collect(response, source);
        if (!response.hasMore || response.items.length === 0) {
          source.exhausted = true;
          break;
        }
        // Trang không có URL mới nào: trang sau gần như chắc chắn cũng vậy → không tốn thêm lượt
        if (fresh === 0) break;
      }
      if (source.status === 'searching') source.status = signal?.aborted ? 'stopped' : 'done';
      progress.sourcesDone++;
      report();
    }
  }

  function warnBudget() {
    if (budgetWarned) return;
    budgetWarned = true;
    emit({
      type: 'warning',
      message: `Đã dùng hết ngân sách ${budget} lượt tìm SerpApi cho lượt này; các nguồn còn lại không tìm. Tăng "Số lượt tìm tối đa" nếu cần tìm thêm.`,
    });
  }

  function markVerifying() {
    progress.phase = 'verifying';
    progress.language = null;
    progress.engine = null;
    progress.page = null;
    report();
  }

  /** Chờ mọi bài đang kiểm tra, kể cả bài của truy vấn bổ sung được thêm trong lúc chờ */
  async function waitForVerification() {
    markVerifying();
    while (tasks.length) {
      const pending = tasks;
      tasks = [];
      await Promise.all(pending);
    }
  }

  /**
   * Truy vấn bổ sung cho một ngôn ngữ: cách diễn đạt khác của từ phụ (hoặc chỉ từ khoá chính); Trong nước thêm mục
   * Tin tức của Google. Ngoài nước không dùng mục Tin tức: Google News không cho dùng -site: nên kết quả chủ yếu là
   * bản tiếng nước ngoài của báo Việt Nam (đã thử thực tế: 9/10 kết quả), tốn lượt mà không có bài dùng được.
   */
  function tier2For(group: QueryGroup): SearchTarget[] {
    const list: SearchTarget[] = [];
    if (params.region === 'domestic') {
      const newsQuery = buildSearchQuery(group.terms, group.optional, params.region, { exclude, vertical: 'news' });
      list.push({
        group,
        engine: 'google',
        vertical: 'news',
        query: newsQuery,
        report: newReport(group.language, 'google', newsQuery, { vertical: 'news', tier: 2, suffix: ':news', pages: 1 }),
      });
    }
    // Cách diễn đạt khác của phần từ phụ; không có thì bỏ từ phụ (Google tìm theo từ khoá chính)
    const alternatives = group.altOptional?.length ? group.altOptional.map((o) => [o]) : group.terms.length && group.optional.length ? [[]] : [];
    alternatives.forEach((optional, i) => {
      const query = buildSearchQuery(group.terms, optional, params.region, { exclude });
      list.push({
        group,
        engine: 'google',
        vertical: 'web',
        query,
        report: newReport(group.language, 'google', query, { tier: 2, suffix: `:alt${i + 1}`, pages: 1 }),
      });
    });
    return list
      .slice(0, MAX_TIER2_PER_GROUP)
      .map(addToPlan)
      .filter((t): t is SearchTarget => t !== null);
  }

  await runTargets(tier1, params.pagesPerSource);
  markVerifying();

  // G. Mỗi ngôn ngữ: kiểm tra xong các bài của nó thì quyết định ngay có cần truy vấn bổ sung không (không chờ ngôn
  // ngữ khác). Các lượt tìm bổ sung vẫn chạy lần lượt (hàng đợi) để không vượt số lượt tìm tối đa.
  let searchQueue: Promise<void> = Promise.resolve();
  await Promise.all(
    searchGroups.map(async (group) => {
      await Promise.all(tasksByLanguage.get(group.language) ?? []);
      if (signal?.aborted || stopSearching) return;
      if ((acceptedByLanguage.get(group.language) ?? 0) >= GAP_TARGET) return;
      const targets = tier2For(group);
      if (!targets.length) return;
      const run = searchQueue.then(async () => {
        if (signal?.aborted || stopSearching) return;
        if (paidCalls() >= budget) {
          warnBudget();
          return;
        }
        progress.sources = [...progress.sources, ...targets.map((t) => t.report)];
        progress.totalSources += targets.length;
        await runTargets(targets, 1);
        markVerifying();
      });
      searchQueue = run;
      await run;
    }),
  );
  await waitForVerification();
  if (verifyStartedAt !== null) metrics.verifyMs = Date.now() - verifyStartedAt;

  progress.phase = 'done';
  emit({ type: 'done', progress: snapshot(), durationMs: Date.now() - startedAt, aborted: Boolean(signal?.aborted) });
  return progress;
}

