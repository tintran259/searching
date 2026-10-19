/**
 * Trích ngày đăng bài theo thứ tự ưu tiên:
 *   1. meta (article:published_time, og:published_time, datePublished, pubdate, …)
 *   2. JSON-LD (@type NewsArticle/Article/BlogPosting → datePublished)
 *   3. thẻ <time datetime>
 *   4. ngày trong URL (/2019/05/12/, -20190512…, mã bài kiểu VCCorp/Thanh Niên)
 *   5. Wayback Machine (lần lưu trữ đầu tiên, ước lượng) — gọi mạng, xem wayback.ts
 *   6. ngày trên snippet của search engine (ước lượng)
 * Bước 1–4 nằm ở `extractDateFromDocument`; pipeline gọi tiếp 5 và 6 khi cần.
 */
import type { DateSource, ExtractedDate } from './types';

const VN_OFFSET_MINUTES = 7 * 60;
const MIN_YEAR = 1990;
const DAY_MS = 86_400_000;

interface DateParts {
  y: number;
  m: number;
  d: number;
  hh?: number;
  mi?: number;
  ss?: number;
  /** Lệch múi giờ so với UTC (phút); không có thì coi là GMT+7 */
  offset?: number;
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function monthFromName(name: string): number | null {
  const n = name.toLowerCase();
  if (n.length < 3) return null;
  const i = MONTH_NAMES.findIndex((full) => full.startsWith(n));
  return i === -1 ? null : i + 1;
}

const pad = (n: number) => String(n).padStart(2, '0');

function partsFromEpoch(ms: number): DateParts {
  const local = new Date(ms + VN_OFFSET_MINUTES * 60_000);
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    hh: local.getUTCHours(),
    mi: local.getUTCMinutes(),
    ss: local.getUTCSeconds(),
    offset: VN_OFFSET_MINUTES,
  };
}

const TIME_RE = /(?:^|[T\s,(-])(\d{1,2})[:h](\d{2})(?::(\d{2}))?(?!\d)/i;
const ISO_OFFSET_RE =
  /\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(Z|[+-]\d{2}:?\d{2}|[+-]\d{2}(?![\d:])|\s[+-]\d{4})(?![\d:/])/i;
const GMT_OFFSET_RE = /(?:GMT|UTC)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i;

function parseTime(s: string): Pick<DateParts, 'hh' | 'mi' | 'ss'> {
  const m = TIME_RE.exec(s);
  if (!m) return {};
  const hh = Number(m[1]);
  const mi = Number(m[2]);
  const ss = Number(m[3] ?? 0);
  return hh <= 23 && mi <= 59 && ss <= 59 ? { hh, mi, ss } : {};
}

function parseOffset(s: string): number | undefined {
  const iso = ISO_OFFSET_RE.exec(s);
  if (iso) {
    const tz = iso[1].trim();
    if (/^z$/i.test(tz)) return 0;
    const m = /^([+-])(\d{2}):?(\d{2})?$/.exec(tz);
    if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  }
  const gmt = GMT_OFFSET_RE.exec(s);
  if (gmt) return (gmt[1] === '-' ? -1 : 1) * (Number(gmt[2]) * 60 + Number(gmt[3] ?? 0));
  return undefined;
}

/** Đọc các thành phần ngày từ chuỗi ở nhiều định dạng (ISO, dd/MM/yyyy, tiếng Việt, tiếng Anh, Unix time). */
function parseDateParts(input: string): DateParts | null {
  const s = input.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 200) return null;

  if (/^\d{10}$|^\d{13}$/.test(s)) return partsFromEpoch(s.length === 10 ? Number(s) * 1000 : Number(s));

  const time = parseTime(s);
  const offset = parseOffset(s);
  const withTime = (y: number, m: number, d: number): DateParts => ({ y, m, d, ...time, offset });
  let m: RegExpExecArray | null;

  // 2019-05-12, 2019/05/12, 2019.05.12, 2019-05-12T10:30:00+07:00
  if ((m = /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(s))) return withTime(+m[1], +m[2], +m[3]);

  // Kiểu VN, ngày trước tháng: 12/05/2019, 12-5-2019, "Chủ nhật, 12/5/2019, 10:30 (GMT+7)"
  if ((m = /(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?!\d)/.exec(s))) {
    let d = +m[1];
    let mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // chỉ có thể là MM/DD/YYYY
    return withTime(+m[3], mo, d);
  }

  // "12 tháng 5, 2019", "12 thg 5, 2019", "ngày 12 tháng 05 năm 2019"
  if ((m = /(?<!\d)(\d{1,2})\s*(?:tháng|thg)\.?\s*(\d{1,2})\s*(?:,|năm)?\s*(\d{4})(?!\d)/iu.exec(s))) {
    return withTime(+m[3], +m[2], +m[1]);
  }
  // "Thg 5 12, 2019"
  if ((m = /(?:tháng|thg)\.?\s*(\d{1,2})\s+(\d{1,2}),?\s*(\d{4})(?!\d)/iu.exec(s))) {
    return withTime(+m[3], +m[1], +m[2]);
  }

  // "12 May 2019", "Sun, 12 May 2019 10:30:00 +0700"
  if ((m = /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})(?!\d)/i.exec(s))) {
    const month = monthFromName(m[2]);
    if (month) return withTime(+m[3], month, +m[1]);
  }
  // "May 12, 2019", "March 3rd, 2021"
  if ((m = /(?<![a-z])([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?!\d)/i.exec(s))) {
    const month = monthFromName(m[1]);
    if (month) return withTime(+m[3], month, +m[2]);
  }
  return null;
}

function toExtractedDate(
  p: DateParts,
  source: DateSource,
  raw: string,
  estimated: boolean,
  now: Date,
): ExtractedDate | null {
  const { y, m, d } = p;
  if (!Number.isInteger(y) || y < MIN_YEAR || m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (new Date(Date.UTC(y, m - 1, d)).getUTCMonth() !== m - 1) return null; // vd 31/02
  const offset = p.offset ?? VN_OFFSET_MINUTES;
  const timestamp = Date.UTC(y, m - 1, d, p.hh ?? 0, p.mi ?? 0, p.ss ?? 0) - offset * 60_000;
  if (timestamp > now.getTime() + DAY_MS) return null; // ngày trong tương lai → dữ liệu sai
  return { date: `${y}-${pad(m)}-${pad(d)}`, timestamp, source, raw: raw.trim().slice(0, 200), estimated };
}

export function parseDate(
  raw: string | null | undefined,
  source: DateSource,
  options: { now?: Date; estimated?: boolean } = {},
): ExtractedDate | null {
  if (!raw) return null;
  const parts = parseDateParts(raw);
  return parts && toExtractedDate(parts, source, raw, options.estimated ?? false, options.now ?? new Date());
}

/** 1. Meta — theo thứ tự ưu tiên (4 khoá đầu theo đặc tả, sau đó là các biến thể thường gặp) */
const META_KEYS = [
  'article:published_time',
  'og:published_time',
  'datepublished',
  'pubdate',
  'og:article:published_time',
  'article:published',
  'publishdate',
  'publish-date',
  'publish_date',
  'published_time',
  'publication_date',
  'dc.date.issued',
  'dcterms.issued',
  'dcterms.created',
  'sailthru.date',
  'parsely-pub-date',
  'cxenseparse:recs:publishtime',
];

export function extractMetaDate(doc: Document, now = new Date()): ExtractedDate | null {
  const values = new Map<string, string[]>();
  for (const el of Array.from(doc.querySelectorAll('meta[content]'))) {
    const content = el.getAttribute('content') ?? '';
    for (const attr of ['property', 'name', 'itemprop']) {
      const key = el.getAttribute(attr)?.trim().toLowerCase();
      if (key) values.set(key, [...(values.get(key) ?? []), content]);
    }
  }
  for (const key of META_KEYS) {
    for (const raw of values.get(key) ?? []) {
      const date = parseDate(raw, 'meta', { now });
      if (date) return date;
    }
  }
  // Microdata trên thẻ khác: <span itemprop="datePublished" content="…">, <time itemprop=… datetime=…>
  for (const el of Array.from(doc.querySelectorAll('[itemprop="datePublished"]:not(meta)'))) {
    const raw = el.getAttribute('content') ?? el.getAttribute('datetime') ?? el.textContent;
    const date = parseDate(raw, 'meta', { now });
    if (date) return date;
  }
  return null;
}

/** 2. JSON-LD */
const ARTICLE_TYPE = /(?:Article|BlogPosting)$/i;
const BROKEN_ARTICLE_TYPE = /"@type"\s*:\s*(?:\[\s*)?(?:"[^"]*"\s*,\s*)*"[^"]*(?:Article|BlogPosting)"/i;

function isArticleNode(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  return (Array.isArray(type) ? type : [type]).some((t) => typeof t === 'string' && ARTICLE_TYPE.test(t));
}

function* walkJsonLd(value: unknown, depth = 0): Generator<Record<string, unknown>> {
  if (depth > 6 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) yield* walkJsonLd(item, depth + 1);
    return;
  }
  const node = value as Record<string, unknown>;
  yield node;
  for (const [key, child] of Object.entries(node)) {
    if (key !== '@context' && child && typeof child === 'object') yield* walkJsonLd(child, depth + 1);
  }
}

/** JSON.parse dễ dãi: báo hay để xuống dòng thô trong chuỗi hoặc dấu phẩy thừa. */
function parseJsonLoose(text: string): unknown {
  const cleaned = text.trim().replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  const repaired = cleaned.replace(/[\u0000-\u001F]+/g, ' ').replace(/,\s*([}\]])/g, '$1');
  for (const candidate of [cleaned, repaired]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // thử cách tiếp theo
    }
  }
  return undefined;
}

export function extractJsonLdDate(doc: Document, now = new Date()): ExtractedDate | null {
  const scripts = Array.from(doc.querySelectorAll('script')).filter(
    (s) => s.getAttribute('type')?.trim().toLowerCase() === 'application/ld+json',
  );
  for (const script of scripts) {
    const text = script.textContent ?? '';
    const data = parseJsonLoose(text);
    if (data === undefined) {
      // JSON hỏng hẳn: dò bằng regex
      const m = BROKEN_ARTICLE_TYPE.test(text) ? /"datePublished"\s*:\s*"([^"]+)"/i.exec(text) : null;
      const date = parseDate(m?.[1], 'jsonld', { now });
      if (date) return date;
      continue;
    }
    for (const node of walkJsonLd(data)) {
      if (!isArticleNode(node)) continue;
      const value = node.datePublished;
      const raw = Array.isArray(value) ? value.find((v) => typeof v === 'string') : value;
      const date = typeof raw === 'string' ? parseDate(raw, 'jsonld', { now }) : null;
      if (date) return date;
    }
  }
  return null;
}

/** 3. <time datetime> — ưu tiên thẻ đánh dấu ngày đăng, rồi thẻ nằm trong <article>/<main> */
export function extractTimeElementDate(doc: Document, now = new Date()): ExtractedDate | null {
  const all = Array.from(doc.querySelectorAll('time[datetime]'));
  const marked = all.filter(
    (t) =>
      t.hasAttribute('pubdate') ||
      /publish|posted|created/i.test(`${t.getAttribute('class') ?? ''} ${t.getAttribute('itemprop') ?? ''}`),
  );
  const inArticle = all.filter((t) => t.closest('article, main, [itemtype*="Article"]'));
  for (const t of new Set([...marked, ...inArticle, ...all])) {
    const date = parseDate(t.getAttribute('datetime'), 'time', { now });
    if (date) return date;
  }
  return null;
}

/** 4. Ngày trong URL */
export function extractUrlDate(url: string, now = new Date()): ExtractedDate | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  const at = (y: number, m: number, d: number, raw: string) =>
    toExtractedDate({ y, m, d }, 'url', raw, false, now);
  let m: RegExpExecArray | null;

  // /2019/05/12/, /2019-05-12-slug, /2019_5_12
  if ((m = /(?:^|\/)((?:19|20)\d{2})[/_-](\d{1,2})[/_-](\d{1,2})(?=[/_.-]|$)/.exec(path))) {
    const date = at(+m[1], +m[2], +m[3], m[0]);
    if (date) return date;
  }
  // /2019/may/12/ (The Guardian…)
  if ((m = /\/((?:19|20)\d{2})\/([a-z]{3,9})\/(\d{1,2})(?=\/|$)/i.exec(path))) {
    const month = monthFromName(m[2]);
    const date = month ? at(+m[1], month, +m[3], m[0]) : null;
    if (date) return date;
  }
  // Chuỗi số dài đứng sau "/", "-" hoặc "_":
  //  - yyyyMMdd[HHmmss…]: Dân trí, Người Lao Động, Tuổi Trẻ (-20190512103045123.htm, /20190512/)
  //  - 3 chữ số + yyMMdd…: VCCorp (CafeF, Kenh14…), Thanh Niên (-188190512103045123.chn)
  // Mã bài ngắn (VnExpress -3923456.html, Dân trí cũ 10 chữ số) không được coi là ngày.
  for (const [, digits] of path.matchAll(/(?<=[/_-])(\d{8,18})(?!\d)/g)) {
    if (digits.length === 8 || (digits.length >= 12 && digits.length <= 17)) {
      const date = at(+digits.slice(0, 4), +digits.slice(4, 6), +digits.slice(6, 8), digits);
      if (date) return date;
    }
    if (digits.length >= 15) {
      const date = at(2000 + +digits.slice(3, 5), +digits.slice(5, 7), +digits.slice(7, 9), digits);
      if (date) return date;
    }
  }
  return null;
}

/** Bước 1–4: từ nội dung trang và URL (URL đầu tiên có ngày sẽ được dùng). */
export function extractDateFromDocument(doc: Document, urls: string[], now = new Date()): ExtractedDate | null {
  const fromPage = extractMetaDate(doc, now) ?? extractJsonLdDate(doc, now) ?? extractTimeElementDate(doc, now);
  if (fromPage) return fromPage;
  for (const url of urls) {
    const date = extractUrlDate(url, now);
    if (date) return date;
  }
  return null;
}

/** Bước 5: timestamp Wayback (yyyyMMddHHmmss, UTC) → ngày ước lượng */
export function fromWaybackTimestamp(timestamp: string, now = new Date()): ExtractedDate | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(timestamp);
  if (!m) return null;
  const parts = { y: +m[1], m: +m[2], d: +m[3], hh: +(m[4] ?? 0), mi: +(m[5] ?? 0), ss: +(m[6] ?? 0), offset: 0 };
  return toExtractedDate(parts, 'wayback', timestamp, true, now);
}

function relativeUnitMs(unit: string): number {
  if (/^(?:phút|min|分|분)/.test(unit)) return 60_000;
  if (/^(?:giờ|tiếng|h|小时|時間|시간)/.test(unit)) return 3_600_000;
  if (/^(?:ngày|day|天|日|일)/.test(unit)) return DAY_MS;
  if (/^(?:tuần|week|周|週|주)/.test(unit)) return 7 * DAY_MS;
  if (/^(?:tháng|month|个月|個月|ヶ月|か月|개월)/.test(unit)) return 30 * DAY_MS;
  return 365 * DAY_MS;
}

/** Ngày kiểu Trung / Nhật / Hàn trên snippet của Baidu, Naver: "2025年3月7日", "2026.09.08.", "6天前", "3일 전" */
function parseCjkSnippetDate(s: string, raw: string, searchedAt: Date): ExtractedDate | null | undefined {
  const abs = /(\d{4})\s*[年.]\s*(\d{1,2})\s*[月.]\s*(\d{1,2})\s*[日.]?/u.exec(s);
  if (abs) return toExtractedDate({ y: Number(abs[1]), m: Number(abs[2]), d: Number(abs[3]) }, 'snippet', raw, true, searchedAt);
  const rel = /(\d+)\s*(分钟|分|小时|時間|天|日|周|週|个月|個月|ヶ月|か月|年|분|시간|일|주|개월|년)\s*(?:前|전)/u.exec(s);
  if (rel) {
    const ms = Number(rel[1]) * relativeUnitMs(rel[2]);
    return toExtractedDate(partsFromEpoch(searchedAt.getTime() - ms), 'snippet', raw, true, searchedAt);
  }
  if (/昨天|어제/u.test(s)) return toExtractedDate(partsFromEpoch(searchedAt.getTime() - DAY_MS), 'snippet', raw, true, searchedAt);
  return undefined;
}

/** Bước 6: ngày trên snippet search engine ("12 thg 5, 2019", "May 12, 2019", "3 ngày trước"…) */
export function parseSnippetDate(raw: string | null | undefined, searchedAt: Date): ExtractedDate | null {
  if (!raw) return null;
  const s = raw.normalize('NFC').toLowerCase();
  const ago = (ms: number) => toExtractedDate(partsFromEpoch(searchedAt.getTime() - ms), 'snippet', raw, true, searchedAt);
  if (/hôm qua|\byesterday\b/.test(s)) return ago(DAY_MS);
  if (/hôm nay|\btoday\b/.test(s)) return ago(0);
  const rel =
    /(\d+)\s*(phút|giờ|tiếng|ngày|tuần|tháng|năm|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s*(?:trước|ago)/u.exec(s);
  if (rel) return ago(Number(rel[1]) * relativeUnitMs(rel[2]));
  const cjk = parseCjkSnippetDate(s, raw, searchedAt);
  if (cjk !== undefined) return cjk;
  return parseDate(raw, 'snippet', { now: searchedAt, estimated: true });
}
