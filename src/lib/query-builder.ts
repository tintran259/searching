/**
 * Sinh truy vấn tìm kiếm, biến thể tên và nhóm truy vấn theo ngôn ngữ.
 */
import { SEARCH_LANGUAGES, type LocalEngine } from '@/config/languages';
import { normalizeText } from './matcher';
import { canonicalQuery, parseQuery, termAlternatives } from './query-syntax';
import { domesticDomainsOutsideVn } from './region';
import type { SearchLocale } from './search/types';
import { SOURCE_LANGUAGE, type QueryGroup, type QueryPlan, type QueryTerm, type Region, type TermExpansion } from './types';

/** Google bỏ qua phần truy vấn vượt quá 32 từ */
const MAX_QUERY_WORDS = 32;

/** Chuẩn hoá một cụm từ: NFC, bỏ dấu ` và ngoặc kép, gộp khoảng trắng */
export function cleanPhrase(input: string): string {
  return normalizeText(input).replace(/[`"“”„«»]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function removeDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFC');
}

const uniqueIgnoringCase = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase();
    if (!v || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Biến thể cho phạm vi "Ngoài nước": cụm gốc có dấu, bản bỏ dấu và — với cụm 2–5 từ (coi là tên người) —
 * hai kiểu đảo thứ tự hay gặp ở báo nước ngoài: "A Tran Van" (tên lên đầu), "Van A Tran" (họ xuống cuối).
 */
export function buildNameVariants(input: string): string[] {
  const phrase = cleanPhrase(input);
  const plain = removeDiacritics(phrase);
  const words = plain.split(' ').filter(Boolean);
  const variants = [phrase, plain];
  if (words.length >= 2 && words.length <= 5) {
    variants.push([words[words.length - 1], ...words.slice(0, -1)].join(' '));
    variants.push([...words.slice(1), words[0]].join(' '));
  }
  return uniqueIgnoringCase(variants);
}

/**
 * Hư từ không dùng để tính mức liên quan, theo ngôn ngữ của nhóm truy vấn (không dùng chung:
 * "an", "to", "di", "sa" là hư từ tiếng Anh / Indonesia nhưng là từ có nghĩa trong tiếng Việt).
 */
const STOP_WORDS: Record<string, string[]> = {
  vi: [
    'của', 'và', 'với', 'cho', 'các', 'những', 'là', 'thì', 'mà', 'ở', 'tại', 'trong', 'về', 'đã', 'đang', 'sẽ',
    'được', 'bị', 'này', 'đó', 'một', 'có', 'không', 'theo', 'từ', 'đến', 'khi', 'như', 'nhưng', 'hay', 'hoặc',
    'vì', 'do', 'nên', 'rằng', 'để',
  ],
  en: [
    'the', 'of', 'a', 'an', 'and', 'to', 'in', 'on', 'for', 'by', 'with', 'at', 'from', 'is', 'are', 'was', 'were',
    'be', 'his', 'her', 'its', 'their',
  ],
  de: ['der', 'die', 'das', 'und', 'von', 'zu', 'mit', 'im', 'in', 'den', 'dem', 'des', 'ein', 'eine', 'auf', 'für'],
  fr: ['le', 'la', 'les', 'de', 'des', 'du', 'et', 'à', 'au', 'aux', 'en', 'un', 'une', 'pour', 'par', 'sur'],
  ru: ['и', 'в', 'во', 'на', 'с', 'со', 'по', 'к', 'о', 'об', 'из', 'у', 'за', 'для', 'от', 'до'],
  id: ['dan', 'di', 'ke', 'dari', 'yang', 'untuk', 'dengan', 'pada', 'oleh'],
  ms: ['dan', 'di', 'ke', 'dari', 'yang', 'untuk', 'dengan', 'pada', 'oleh'],
  tl: ['ang', 'ng', 'sa', 'mga', 'at', 'na', 'si', 'ni'],
  'zh-CN': ['的', '了', '在', '是', '和', '与', '对', '将', '及', '之', '于'],
  'zh-TW': ['的', '了', '在', '是', '和', '與', '對', '將', '及', '之', '於'],
  ja: ['の', 'は', 'が', 'を', 'に', 'で', 'と', 'へ', 'も'],
  th: ['การ', 'ของ', 'และ', 'ที่', 'ใน', 'กับ', 'เป็น', 'ได้', 'จาก', 'โดย'],
  lo: ['ການ', 'ຂອງ', 'ແລະ', 'ທີ່', 'ໃນ', 'ກັບ', 'ເປັນ', 'ໄດ້', 'ຈາກ', 'ໂດຍ'],
  km: ['របស់', 'និង', 'នៅ', 'ក្នុង', 'ពី'],
};
const stopWordSets = new Map(Object.entries(STOP_WORDS).map(([lang, words]) => [lang, new Set(words)]));

/** Hệ chữ viết liền không dấu cách giữa các từ: tách từ bằng Intl.Segmenter (từ điển ICU) */
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const wordSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;

function splitToken(token: string): string[] {
  if (!wordSegmenter || !NO_SPACE_SCRIPT.test(token)) return [token];
  return [...wordSegmenter.segment(token)].filter((s) => s.isWordLike).map((s) => s.segment);
}

/**
 * Từ phụ để tính mức liên quan: tách từ, bỏ dấu câu ở hai đầu, hư từ của `language` và từ trùng.
 * Một chữ cái Latin viết hoa (vd "A" trong "Trần Văn A") vẫn tính là từ, viết thường thì bỏ.
 */
export function optionalWords(phrases: string[], language: string = SOURCE_LANGUAGE): string[] {
  const stop = stopWordSets.get(language);
  const words = phrases
    .flatMap((p) => cleanPhrase(p).split(' '))
    .flatMap(splitToken)
    .map((w) => w.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, ''))
    .filter(
      (w) =>
        w &&
        (/^\p{Lu}$/u.test(w) || (!stop?.has(w.toLowerCase()) && (w.length > 1 || !/\p{Script=Latin}/u.test(w)))),
    );
  return uniqueIgnoringCase(words);
}

/**
 * Động từ / từ chỉ hướng quá chung: dịch riêng thường lệch nghĩa ("đi" → "go", "идти") và kéo search engine
 * về kết quả lạc chủ đề. Phần từ phụ chỉ gồm những từ này (và hư từ) thì không dịch.
 */
const GENERIC_WORDS_VI = new Set(['đi', 'về', 'đến', 'tới', 'ra', 'vào', 'lên', 'xuống', 'làm', 'gặp', 'nói', 'cùng', 'qua', 'sang']);

/** Phần từ phụ có từ mang nghĩa riêng (không chỉ hư từ / từ quá chung) để đáng dịch sang ngôn ngữ khác */
export function hasMeaningfulOptional(optional: string[]): boolean {
  return optionalWords(optional, SOURCE_LANGUAGE).some((w) => !GENERIC_WORDS_VI.has(w.toLowerCase()));
}

const countWords = (query: string) => query.split(/\s+/).filter(Boolean).length;
const quote = (v: string) => `"${v}"`;

export interface SearchQueryOptions {
  /** Cụm loại trừ: thêm -"cụm" vào truy vấn */
  exclude?: string[];
  /** Mục Tin tức của Google không dùng được site: → không thêm -site: */
  vertical?: 'web' | 'news';
}

/**
 * Mỗi từ khoá bắt buộc bọc ngoặc kép (nhiều biến thể thì nối OR), từ phụ để nguyên cho Google xếp hạng.
 * Phạm vi "Ngoài nước" loại luôn báo trong nước ngay trong truy vấn (-site:vn, -site:vnexpress.net…)
 * để không phí suất kết quả của mỗi năm; pipeline vẫn lọc lại bằng classifyRegion.
 */
export function buildSearchQuery(
  terms: QueryTerm[],
  optional: string[],
  region: Region,
  { exclude = [], vertical = 'web' }: SearchQueryOptions = {},
): string {
  const single = terms.length === 1 && optional.length === 0;
  let query = terms
    .map((t) => {
      if (t.variants.length === 1) return quote(t.variants[0]);
      const or = t.variants.map(quote).join(' OR ');
      return single ? or : `(${or})`;
    })
    .join(' ');
  let words = countWords(query);
  for (const word of optional.flatMap((o) => o.split(/\s+/)).filter(Boolean)) {
    if (words + 1 > MAX_QUERY_WORDS) break;
    query += ` ${word}`;
    words += 1;
  }
  for (const phrase of exclude) {
    const n = countWords(phrase);
    if (words + n > MAX_QUERY_WORDS) break;
    query += ` -${quote(phrase)}`;
    words += n;
  }
  if (region === 'foreign' && vertical === 'web') {
    for (const domain of ['vn', ...domesticDomainsOutsideVn()]) {
      if (words + 1 > MAX_QUERY_WORDS) break;
      query += ` -site:${domain}`;
      words += 1;
    }
  }
  return query.trim();
}

/**
 * Truy vấn cho Baidu / Yandex / Naver: cú pháp OR khác Google (Baidu, Yandex dùng "|") và không rõ có hỗ trợ
 * ngoặc đơn, nên chỉ nối OR các biến thể khi có đúng một từ khoá bắt buộc; nhiều từ khoá thì mỗi từ khoá lấy
 * biến thể đầu. Không thêm -site: (kết quả vẫn được lọc phạm vi như thường).
 */
export function buildLocalQuery(group: QueryGroup, engine: LocalEngine): string {
  const or = engine === 'naver' ? ' OR ' : ' | ';
  const single = group.terms.length === 1 && group.optional.length === 0;
  const terms = group.terms.map((t) => (single ? t.variants.map(quote).join(or) : quote(t.variants[0])));
  return [...terms, ...group.optional].join(' ').trim();
}

/**
 * Kế hoạch truy vấn tiếng Việt (nhóm duy nhất; nhóm ngôn ngữ dịch được thêm bằng `withTranslations`).
 * Không đánh dấu gì thì nhóm không có từ khoá bắt buộc (tìm liên quan theo từ phụ).
 */
/**
 * Truy vấn chính tối đa chừng này từ khi gộp cách gọi khác (gợi ý) bằng OR: dài hơn thì bỏ cách gọi khác ra khỏi
 * truy vấn chính (chúng vẫn được dùng để xác minh và cho truy vấn bổ sung), để Google không cắt mất phần sau.
 */
const MAX_WORDS_WITH_EXPANSIONS = 24;

/** Từ khoá chỉ gồm biến thể gốc (bỏ cách gọi khác) */
const withoutExpansions = (terms: QueryTerm[]): QueryTerm[] =>
  terms.map((t) => (t.expansions?.length ? { ...t, variants: t.variants.filter((v) => !t.expansions!.includes(v)) } : t));

/**
 * Truy vấn chính của một nhóm: gộp cách gọi khác vào cùng truy vấn bằng OR (không tốn thêm lượt tìm);
 * truy vấn quá dài thì chỉ dùng biến thể gốc.
 */
export function buildMainQuery(terms: QueryTerm[], optional: string[], region: Region, options: SearchQueryOptions = {}): string {
  const full = buildSearchQuery(terms, optional, region, options);
  if (!terms.some((t) => t.expansions?.length)) return full;
  const core = buildSearchQuery(terms, [], region, { vertical: 'news' });
  return countWords(core) <= MAX_WORDS_WITH_EXPANSIONS ? full : buildSearchQuery(withoutExpansions(terms), optional, region, options);
}

/** Truy vấn chỉ bằng cách gọi khác: từ khoá có gợi ý được thay bằng các cách gọi khác, từ khoá còn lại giữ nguyên */
export function buildExpansionQuery(
  terms: QueryTerm[],
  optional: string[],
  region: Region,
  options: SearchQueryOptions = {},
): string | null {
  if (!terms.some((t) => t.expansions?.length)) return null;
  const swapped = terms.map((t) => (t.expansions?.length ? { ...t, variants: t.expansions } : t));
  return buildSearchQuery(swapped, optional, region, options);
}

export function buildQueryPlan(
  input: string,
  region: Region,
  options: { exclude?: string[]; expansions?: TermExpansion[] } = {},
): QueryPlan {
  const parsed = parseQuery(input);
  if (!parsed.required.length && !parsed.optional.length) throw new Error('Từ khoá đang trống');
  // Nhóm OR (`Bỉ | Brussels`): mỗi lựa chọn là một biến thể của cùng từ khoá.
  // Cách gọi khác (gợi ý): Ngoài nước thêm bản không dấu, không đảo thứ tự (chức danh không phải tên người)
  const terms: QueryTerm[] = parsed.required.map((text) => {
    const typed = termAlternatives(text).flatMap((alt) => (region === 'foreign' ? buildNameVariants(alt) : [alt]));
    const expansions = uniqueIgnoringCase(
      (options.expansions?.find((e) => e.term === text)?.alternatives ?? []).flatMap((alt) =>
        region === 'foreign' ? [alt, removeDiacritics(alt)] : [alt],
      ),
    ).filter((e) => !typed.some((v) => v.toLowerCase() === e.toLowerCase()));
    return { text, variants: uniqueIgnoringCase([...typed, ...expansions]), ...(expansions.length ? { expansions } : {}) };
  });
  return {
    phrase: canonicalQuery(parsed),
    groups: [
      {
        language: SOURCE_LANGUAGE,
        terms,
        optional: parsed.optional,
        searchQuery: buildMainQuery(terms, parsed.optional, region, { exclude: options.exclude }),
      },
    ],
  };
}

export interface TranslatedQuery {
  language: string;
  /** Biến thể của từng từ khoá bắt buộc, cùng thứ tự với nhóm tiếng Việt */
  terms: string[][];
  /** Bản dịch của phần từ phụ */
  optional: string[];
  /** Các cách diễn đạt khác của phần từ phụ (bản dịch thứ 2, 3…) */
  altOptional?: string[];
  /** Bản dịch các cách gọi khác (gợi ý) của từng từ khoá, cùng thứ tự với `terms` */
  termExpansions?: string[][];
}

/**
 * Thêm một nhóm truy vấn cho mỗi ngôn ngữ đã dịch; bản dịch thiếu một từ khoá bắt buộc nào thì bỏ.
 * Mỗi ngôn ngữ luôn tìm riêng, kể cả khi cách viết trùng ngôn ngữ khác (vd "Tran Van A" ở tiếng Anh,
 * Đức, Indonesia): mỗi nước tìm bằng Google của nước đó và chỉ lấy trang viết bằng ngôn ngữ đó,
 * nên kết quả khác nhau.
 */
export function withTranslations(
  plan: QueryPlan,
  translations: TranslatedQuery[],
  region: Region,
  options: { exclude?: string[] } = {},
): QueryPlan {
  const groups: QueryGroup[] = [...plan.groups];
  for (const t of translations) {
    const terms = t.terms.map((variants) => uniqueIgnoringCase(variants.map(cleanPhrase)));
    const optional = t.optional.map(cleanPhrase).filter(Boolean);
    // Thiếu bản dịch cho một từ khoá bắt buộc, hoặc tìm liên quan mà không có bản dịch nào → bỏ ngôn ngữ
    const incomplete = terms.length !== plan.groups[0].terms.length || terms.some((variants) => variants.length === 0);
    if (incomplete || (terms.length === 0 && optional.length === 0)) continue;
    const queryTerms: QueryTerm[] = terms.map((variants, i) => {
      const lower = new Set(variants.map((v) => v.toLowerCase()));
      const expansions = uniqueIgnoringCase((t.termExpansions?.[i] ?? []).map(cleanPhrase)).filter((e) => !lower.has(e.toLowerCase()));
      return { text: variants[0], variants: [...variants, ...expansions], ...(expansions.length ? { expansions } : {}) };
    });
    const altOptional = (t.altOptional ?? []).map(cleanPhrase).filter((o) => o && !optional.includes(o));
    groups.push({
      language: t.language,
      terms: queryTerms,
      optional,
      searchQuery: buildMainQuery(queryTerms, optional, region, options),
      ...(altOptional.length ? { altOptional } : {}),
    });
  }
  return { ...plan, groups };
}

/**
 * Quốc gia / ngôn ngữ gửi cho search engine. "Trong nước" luôn dùng gl=vn (kể cả với ngôn ngữ dịch,
 * để ra bản tiếng nước ngoài của báo Việt Nam); "Ngoài nước" dùng quốc gia của ngôn ngữ đó.
 * Nhóm dịch chỉ lấy trang viết bằng đúng ngôn ngữ đó (`onlyLanguage`, nếu search engine hỗ trợ).
 * Nhóm tiếng Việt không lọc ngôn ngữ: phạm vi Ngoài nước cần cả trang tiếng Anh viết tên không dấu.
 */
export function searchLocaleFor(region: Region, language: string = SOURCE_LANGUAGE): SearchLocale {
  if (language === SOURCE_LANGUAGE) {
    return region === 'domestic' ? { country: 'vn', language: 'vi' } : { country: 'us', language: 'en' };
  }
  const lang = SEARCH_LANGUAGES.find((l) => l.code === language);
  return { country: region === 'domestic' ? 'vn' : lang?.country, language: lang?.hl ?? language, onlyLanguage: language };
}
