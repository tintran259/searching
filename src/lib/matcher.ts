/**
 * So khớp CHÍNH XÁC cả cụm từ (tên người, cụm từ) trong văn bản tiếng Việt.
 *
 * - Chuẩn hoá Unicode NFC cho cả cụm và văn bản (trang có thể dùng dạng NFD).
 * - Không phân biệt hoa thường (cờ `iu`); giữa các từ chấp nhận mọi khoảng trắng (\s+).
 * - Ranh giới từ Unicode ở hai đầu cụm:
 *     (?<![\p{L}\p{N}\p{M}]) <cụm> (?![\p{L}\p{N}\p{M}])
 *   → "Trần Văn A" KHÔNG khớp "Trần Văn An", "Trần Văn Anh", "Trần Văn A1".
 *   So với mẫu trong đặc tả có thêm \p{M} (dấu kết hợp): nếu văn bản còn dấu rời
 *   không gộp được sau NFC thì chữ cuối cụm vẫn chưa được coi là hết từ.
 *   Chữ thuộc hệ viết không dùng dấu cách giữa các từ (Hán, Kana, Thái, Lào, Khmer, Myanmar,
 *   Hangul — tiếng Hàn gắn trợ từ liền sau tên) không tính là chữ khi xét ranh giới, nên
 *   "陈文安" vẫn khớp trong "记者陈文安表示", còn "Tran Van A" vẫn không khớp "Tran Van Anh".
 * - Hai kiểu đặt dấu thanh (hoà/hòa, thuỷ/thủy, khoẻ/khỏe) được coi là một.
 */

export interface Snippet {
  text: string;
  /** Vị trí [start, end) của cụm khớp trong `text` */
  highlightStart: number;
  highlightEnd: number;
}

export interface PhraseMatch {
  /** Biến thể (trong danh sách truyền vào) đã khớp */
  variant: string;
  /** Đoạn khớp đúng như trong văn bản, vd "TRẦN VĂN A" */
  matchedText: string;
  /** Vị trí trong văn bản đã chuẩn hoá */
  index: number;
  snippet: Snippet;
}

const NO_SPACE_SCRIPTS =
  '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Thai}\\p{Script=Lao}' +
  '\\p{Script=Khmer}\\p{Script=Myanmar}\\p{Script=Hangul}';
const WORD_CHAR = `(?:(?![${NO_SPACE_SCRIPTS}])[\\p{L}\\p{N}\\p{M}])`;
const BOUNDARY_BEFORE = `(?<!${WORD_CHAR})`;
const BOUNDARY_AFTER = `(?!${WORD_CHAR})`;

/** Ký tự vô hình hay bị chèn giữa chữ: soft hyphen, zero-width space/joiner, word joiner, BOM */
const INVISIBLE_CHARS = /[­​-‍⁠﻿]/g;

/** Dấu thanh ở dạng tổ hợp (NFD): huyền, sắc, ngã, hỏi, nặng */
const TONE_MARKS = '\\u0300\\u0301\\u0303\\u0309\\u0323';

/**
 * Âm tiết mở kết thúc bằng oa/oe/uy, dấu thanh đặt ở nguyên âm sau (kiểu mới: hoà, khoẻ, thuỷ).
 * Chuyển dấu về nguyên âm trước (kiểu cũ: hòa, khỏe, thủy) để hai kiểu so khớp được với nhau.
 */
const NEW_STYLE_TONE = new RegExp(
  `([oO])([aAeE])([${TONE_MARKS}])(?!${WORD_CHAR})|([uU])([yY])([${TONE_MARKS}])(?!${WORD_CHAR})`,
  'gu',
);

/** NFC, bỏ ký tự vô hình, sửa "Ð" (U+00D0, hay bị dùng nhầm) thành "Đ". */
export function normalizeText(text: string): string {
  return text.replace(INVISIBLE_CHARS, '').normalize('NFC').replace(/Ð/g, 'Đ');
}

function canonicalizeTones(text: string): string {
  return text
    .normalize('NFD')
    .replace(NEW_STYLE_TONE, (_m, o, a, tone1, u, y, tone2) => (o ? o + tone1 + a : u + tone2 + y))
    .normalize('NFC');
}

/**
 * Dạng dùng để so khớp. Luôn cùng độ dài với `normalized` (cả hai kiểu dấu đều có
 * ký tự dựng sẵn) nên vị trí khớp dùng lại được trên văn bản gốc để cắt đoạn trích.
 */
function toMatchForm(normalized: string): string {
  const canonical = canonicalizeTones(normalized);
  return canonical.length === normalized.length ? canonical : normalized;
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ngôn ngữ có biến cách: báo chí đổi đuôi từ theo ngữ pháp (vd tiếng Nga "То Лам" → "То Лама", "То Ламу").
 *  - 'ru': chặt, dùng cho tên / từ khoá chính;
 *  - 'ru-stem': so theo gốc từ, dùng cho từ liên quan (Данию ~ Дании ~ Дания, визит ~ визиту).
 */
export type Inflection = 'ru' | 'ru-stem';

const CYRILLIC_CONSONANT_END = /[бвгджзклмнпрстфхцчшщ]$/i;
const CYRILLIC_A_END = /[ая]$/i;

/**
 * Cho phép đuôi biến cách tiếng Nga ở từ cuối (chỉ từ dài từ 3 chữ cái, để "Чан Ван А" không khớp "Чан Ван Ань"):
 *  - kết thúc bằng phụ âm (danh từ giống đực): thêm -а, -у, -ом, -е (Лам → Лама, Ламу, Ламом, Ламе);
 *  - kết thúc bằng -а / -я: đổi đuôi theo cách (Дания → Дании, Москва → Москвы, Москве, Москву, Москвой).
 */
function inflectLastWord(word: string, inflection: Inflection | undefined): string {
  const escaped = escapeRegExp(word);
  if (inflection === 'ru-stem') {
    // Bỏ một nguyên âm / dấu mềm ở cuối (Данию → Дани), gốc còn từ 4 chữ cái thì cho phép tối đa 3 chữ đuôi
    const stem = word.replace(/[аяюуеёиыоьй]$/i, '');
    return [...stem].length >= 4 && /\p{Script=Cyrillic}$/u.test(stem) ? `${escapeRegExp(stem)}[а-яё]{0,3}` : escaped;
  }
  if (inflection !== 'ru' || [...word].length < 3) return escaped;
  if (CYRILLIC_CONSONANT_END.test(word)) return `${escaped}(?:ом|а|у|е)?`;
  if (CYRILLIC_A_END.test(word)) return `${escapeRegExp(word.slice(0, -1))}(?:а|я|ы|и|е|у|ю|ой|ей|ою|ею)`;
  return escaped;
}

function phraseBody(phrase: string, inflection?: Inflection): string {
  const words = toMatchForm(normalizeText(phrase)).split(/\s+/).filter(Boolean);
  if (words.length === 0) throw new Error('Cụm từ cần tìm đang trống');
  const last = words.length - 1;
  return words.map((w, i) => (i === last ? inflectLastWord(w, inflection) : escapeRegExp(w))).join('\\s+');
}

/**
 * Regex khớp chính xác cả cụm. Dùng trên văn bản đã qua `normalizeText`
 * (hoặc gọi `containsPhrase` / `PhraseMatcher` để được chuẩn hoá đầy đủ).
 */
export function buildPhraseRegex(phrase: string): RegExp {
  return new RegExp(`${BOUNDARY_BEFORE}${phraseBody(phrase)}${BOUNDARY_AFTER}`, 'iu');
}

export class PhraseMatcher {
  private readonly patterns: { variant: string; exact: RegExp; longer: RegExp }[];

  constructor(variants: string[], options: { inflection?: Inflection } = {}) {
    const unique = [...new Set(variants.map((v) => normalizeText(v).replace(/\s+/g, ' ').trim()))];
    this.patterns = unique.filter(Boolean).map((variant) => {
      const body = phraseBody(variant, options.inflection);
      return {
        variant,
        exact: new RegExp(`${BOUNDARY_BEFORE}${body}${BOUNDARY_AFTER}`, 'iu'),
        longer: new RegExp(`${BOUNDARY_BEFORE}${body}${WORD_CHAR}+`, 'iu'),
      };
    });
    if (this.patterns.length === 0) throw new Error('Cụm từ cần tìm đang trống');
  }

  /** Tìm lần xuất hiện sớm nhất của bất kỳ biến thể nào. */
  find(text: string, snippetLength = 200): PhraseMatch | null {
    if (!text) return null;
    const normalized = normalizeText(text);
    const haystack = toMatchForm(normalized);
    let best: { index: number; length: number; variant: string } | null = null;
    for (const { variant, exact } of this.patterns) {
      const m = exact.exec(haystack);
      if (m && (!best || m.index < best.index)) best = { index: m.index, length: m[0].length, variant };
    }
    if (!best) return null;
    return {
      variant: best.variant,
      matchedText: normalized.slice(best.index, best.index + best.length),
      index: best.index,
      snippet: makeSnippet(normalized, best.index, best.length, snippetLength),
    };
  }

  /** Mọi vị trí khớp (của mọi biến thể) trong văn bản, đã gộp chồng lấn — dùng để tô sáng đoạn trích. */
  findAll(text: string): { start: number; end: number }[] {
    if (!text) return [];
    const haystack = toMatchForm(normalizeText(text));
    const ranges: { start: number; end: number }[] = [];
    for (const { exact } of this.patterns) {
      for (const m of haystack.matchAll(new RegExp(exact.source, 'giu'))) {
        ranges.push({ start: m.index, end: m.index + m[0].length });
      }
    }
    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    const merged: { start: number; end: number }[] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r.start < last.end) last.end = Math.max(last.end, r.end);
      else merged.push({ ...r });
    }
    return merged;
  }

  /** Tên dài hơn có cùng phần đầu (vd "Trần Văn Anh") — dùng để giải thích lý do loại. */
  findLongerName(text: string): string | null {
    if (!text) return null;
    const normalized = normalizeText(text);
    const haystack = toMatchForm(normalized);
    for (const { longer } of this.patterns) {
      const m = longer.exec(haystack);
      if (m) return normalized.slice(m.index, m.index + m[0].length);
    }
    return null;
  }
}

export function containsPhrase(text: string, phrase: string): boolean {
  return new PhraseMatcher([phrase]).find(text) !== null;
}

/**
 * Cắt đoạn trích dài khoảng `maxLength` ký tự quanh vị trí khớp, không cắt giữa từ,
 * gộp khoảng trắng/xuống dòng thành một dấu cách.
 */
export function makeSnippet(text: string, index: number, length: number, maxLength = 200): Snippet {
  const size = Math.max(maxLength, length);
  const room = size - length;
  let start = Math.max(0, index - Math.floor(room / 2));
  let end = Math.min(text.length, start + size);
  start = Math.max(0, end - size);

  if (start > 0) {
    const ws = text.slice(start, index).search(/\s/);
    if (ws !== -1 && ws < 20) start += ws + 1;
  }
  if (end < text.length) {
    const tail = text.slice(index + length, end);
    const lastWs = tail.search(/\s\S*$/);
    if (lastWs !== -1 && tail.length - lastWs < 20) end = index + length + lastWs;
  }

  const squash = (s: string) => s.replace(/\s+/g, ' ');
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const before = squash(text.slice(start, index)).trimStart();
  const match = squash(text.slice(index, index + length));
  const after = squash(text.slice(index + length, end)).trimEnd();
  const highlightStart = prefix.length + before.length;
  return {
    text: prefix + before + match + after + suffix,
    highlightStart,
    highlightEnd: highlightStart + match.length,
  };
}
