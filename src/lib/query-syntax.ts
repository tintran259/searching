/**
 * Cú pháp ô tìm kiếm (dùng được ở cả server và client):
 *  - Phần trong dấu huyền `…` là TỪ KHOÁ CHÍNH (bắt buộc): trang phải chứa nguyên văn, không tách từ.
 *  - Phần còn lại là từ phụ: có hay không đều được; dùng để Google tìm đúng chủ đề hơn
 *    và để tính mức liên quan của từng bài.
 *  - Không có từ khoá chính nào → tìm LIÊN QUAN: bài chỉ cần có phần lớn các từ đã nhập
 *    (xem pipeline), không cần đúng thứ tự hay liền nhau.
 * Dùng dấu ` thay cho ngoặc kép như Google vì ngoặc kép hay xuất hiện trong chính nội dung cần tìm
 * (tên sự kiện, trích dẫn); ngoặc kép người dùng gõ được bỏ qua. Khi gửi lên Google, từ khoá chính
 * mới được bọc ngoặc kép (query-builder). Trên giao diện, người dùng bôi đen một phần rồi bấm
 * "Đặt làm từ khoá chính" trong popup — thực chất là thêm dấu `.
 */
import { normalizeText } from './matcher';

/** Tìm liên quan (không đánh dấu từ khoá bắt buộc): bài phải có ít nhất tỉ lệ này trong số từ đã nhập */
export const LOOSE_MIN_RATIO = 0.6;
/**
 * Có từ khoá chính: ngoài từ khoá chính, bài còn phải có ít nhất tỉ lệ này trong số các từ còn lại
 * (nội dung liên quan, vd "chuyến công du Đan Mạch"), để không nhận mọi bài chỉ nhắc tới từ khoá chính.
 */
export const RELATED_MIN_RATIO = 0.5;

/** Dấu đánh dấu từ khoá chính */
export const KEYWORD_MARK = '`';
const MARK = /`/;
/** Bỏ khi chuẩn hoá: dấu đánh dấu và mọi loại ngoặc kép (không có ý nghĩa cú pháp) */
const QUOTES_G = /[`"“”„«»]/g;
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

export interface QuerySegment {
  text: string;
  required: boolean;
  /** Vị trí [start, end) trong chuỗi người dùng nhập; với phần bắt buộc gồm cả hai dấu ngoặc */
  start: number;
  end: number;
}

export interface ParsedQuery {
  segments: QuerySegment[];
  /** Các từ khoá bắt buộc (đã chuẩn hoá, không trùng) */
  required: string[];
  /** Các đoạn từ phụ (không bắt buộc) */
  optional: string[];
  /** true khi không đánh dấu gì: tìm liên quan theo các từ đã nhập */
  loose: boolean;
}

const clean = (s: string) => normalizeText(s).replace(QUOTES_G, ' ').replace(/\s+/g, ' ').trim();

function uniqueIgnoringCase(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Các đoạn trong dấu ` (kể cả dấu); dấu mở không có dấu đóng thì kéo tới hết chuỗi */
function quotedRegions(input: string): { start: number; end: number; inner: string }[] {
  const regions: { start: number; end: number; inner: string }[] = [];
  let i = 0;
  while (i < input.length) {
    const rel = input.slice(i).search(MARK);
    if (rel === -1) break;
    const open = i + rel;
    const relClose = input.slice(open + 1).search(MARK);
    const close = relClose === -1 ? input.length : open + 1 + relClose;
    const end = relClose === -1 ? input.length : close + 1;
    regions.push({ start: open, end, inner: input.slice(open + 1, close) });
    i = end;
  }
  return regions;
}

export function parseQuery(input: string): ParsedQuery {
  const segments: QuerySegment[] = [];
  const pushOptional = (from: number, to: number) => {
    const raw = input.slice(from, to);
    const text = clean(raw);
    if (!text) return;
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    segments.push({ text, required: false, start: from + lead, end: to - trail });
  };

  let cursor = 0;
  for (const region of quotedRegions(input)) {
    pushOptional(cursor, region.start);
    const text = clean(region.inner);
    if (text) segments.push({ text, required: true, start: region.start, end: region.end });
    cursor = region.end;
  }
  pushOptional(cursor, input.length);

  const required = uniqueIgnoringCase(segments.filter((s) => s.required).map((s) => s.text));
  const optional = segments.filter((s) => !s.required).map((s) => s.text);
  return { segments, required, optional, loose: required.length === 0 };
}

const mark = (text: string) => `${KEYWORD_MARK}${text}${KEYWORD_MARK}`;

/** Chuỗi chuẩn gửi lên server: từ khoá chính trong dấu `, phần còn lại để nguyên */
export function canonicalQuery(parsed: ParsedQuery): string {
  return parsed.segments.map((s) => (s.required ? mark(s.text) : s.text)).join(' ');
}

/** Trông giống tên người: 2–5 từ, từ nào cũng viết hoa chữ đầu, không có chữ số (vd "Trần Văn A") */
export function looksLikePersonName(text: string): boolean {
  const words = clean(text).split(' ').filter(Boolean);
  return words.length >= 2 && words.length <= 5 && words.every((w) => /^\p{Lu}[\p{L}\p{M}]*$/u.test(w));
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Đặt vùng [start, end) của chuỗi làm từ khoá chính (thêm dấu `). Vùng chọn được nới ra
 * cho đủ từ (bôi "AB" trong "ABC" → "ABC") và gộp với các cụm bắt buộc mà nó chạm tới.
 */
export function markRequired(
  input: string,
  start: number,
  end: number,
  options: { mergeAdjacent?: boolean } = {},
): string {
  let s = Math.max(0, Math.min(start, end));
  let e = Math.min(input.length, Math.max(start, end));
  while (s > 0 && WORD_CHAR.test(input[s - 1]) && WORD_CHAR.test(input[s] ?? '')) s--;
  while (e < input.length && e > 0 && WORD_CHAR.test(input[e - 1]) && WORD_CHAR.test(input[e])) e++;
  for (const region of quotedRegions(input)) {
    // mergeAdjacent (chạm từng từ trên điện thoại): từ khoá chính chỉ cách bởi khoảng trắng cũng được nối lại
    const touches = region.start < e && region.end > s;
    const adjacent =
      options.mergeAdjacent &&
      ((region.end <= s && !input.slice(region.end, s).trim()) || (region.start >= e && !input.slice(e, region.start).trim()));
    if (touches || adjacent) {
      s = Math.min(s, region.start);
      e = Math.max(e, region.end);
    }
  }
  const inner = clean(input.slice(s, e));
  if (!inner) return input;
  return tidy(`${input.slice(0, s)} ${mark(inner)} ${input.slice(e)}`);
}

/** Bỏ đánh dấu từ khoá chính của một cụm (xoá dấu `) */
export function unmarkRequired(input: string, segment: QuerySegment): string {
  const inner = input.slice(segment.start, segment.end).replace(QUOTES_G, ' ');
  return tidy(`${input.slice(0, segment.start)} ${inner} ${input.slice(segment.end)}`);
}

/** Từ khoá chính chứa trọn vùng [start, end) của chuỗi (để popup đổi thành "Bỏ từ khoá chính"), nếu có */
export function requiredSegmentAt(parsed: ParsedQuery, start: number, end: number): QuerySegment | null {
  return parsed.segments.find((s) => s.required && s.start <= start && end <= s.end) ?? null;
}

/*
 * Ô nhập hiển thị chuỗi KHÔNG có dấu ` (từ khoá chính được tô đậm thay vì hiện dấu), còn giá trị thật
 * vẫn giữ dấu `. Các hàm dưới chuyển vị trí / thao tác sửa giữa chuỗi hiển thị và giá trị thật.
 */

/** Chuỗi hiển thị: bỏ mọi dấu ` */
export function stripMarks(value: string): string {
  return value.replaceAll(KEYWORD_MARK, '');
}

/** Các đoạn từ khoá chính tính theo vị trí trong chuỗi hiển thị (dấu mở chưa đóng thì kéo tới hết chuỗi) */
export function markedRanges(value: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let plain = 0;
  let open: number | null = null;
  for (const ch of value) {
    if (ch !== KEYWORD_MARK) {
      plain += ch.length;
      continue;
    }
    if (open === null) open = plain;
    else {
      if (plain > open) ranges.push({ start: open, end: plain });
      open = null;
    }
  }
  if (open !== null && plain > open) ranges.push({ start: open, end: plain });
  return ranges;
}

/**
 * Vị trí trong giá trị thật ứng với vị trí `plainIndex` của chuỗi hiển thị. Ở ranh giới từ khoá chính,
 * chọn phía NGOÀI dấu: gõ ngay trước hay ngay sau từ khoá chính không làm nó dài ra.
 * Riêng dấu mở chưa có dấu đóng (đang gõ tay `…) thì gõ tiếp vẫn nằm trong từ khoá.
 */
export function toValueIndex(value: string, plainIndex: number): number {
  let plain = 0;
  let marks = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === KEYWORD_MARK) {
      // Dấu đóng nằm ngay tại vị trí cần tìm → đứng sau nó (ngoài từ khoá)
      if (plain === plainIndex && marks % 2 === 1 && value.indexOf(KEYWORD_MARK, i + 1) !== -1) return i + 1;
      marks++;
      continue;
    }
    if (plain === plainIndex) {
      // Ngay sau dấu mở → lùi ra trước dấu mở
      return value[i - 1] === KEYWORD_MARK && marks % 2 === 1 ? i - 1 : i;
    }
    plain++;
  }
  return value.length;
}

/**
 * Áp một thao tác sửa trên chuỗi hiển thị (thay đoạn [start, end) bằng `inserted`) vào giá trị thật.
 * Dấu ` nằm trong đoạn bị xoá được giữ lại; cặp dấu rỗng (từ khoá bị xoá hết) thì bỏ.
 */
export function applyPlainEdit(value: string, start: number, end: number, inserted: string): string {
  const from = toValueIndex(value, start);
  const to = Math.max(from, start === end ? from : toValueIndex(value, end));
  const keptMarks = value.slice(from, to).replace(/[^`]/g, '');
  const next = value.slice(0, from) + inserted + keptMarks + value.slice(to);
  return next.replaceAll(`${KEYWORD_MARK}${KEYWORD_MARK}`, '');
}

/** Các từ (vị trí [start, end) trong chuỗi) của một đoạn từ phụ — để chạm từng từ đặt làm từ khoá chính */
export function segmentWords(input: string, segment: QuerySegment): { text: string; start: number; end: number }[] {
  const words: { text: string; start: number; end: number }[] = [];
  for (const m of input.slice(segment.start, segment.end).matchAll(/[^\s`"“”„«»]+/g)) {
    words.push({ text: m[0], start: segment.start + m.index, end: segment.start + m.index + m[0].length });
  }
  return words;
}
