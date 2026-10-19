import { describe, expect, it } from 'vitest';
import {
  canonicalQuery,
  looksLikePersonName,
  markRequired,
  parseQuery,
  applyPlainEdit,
  markedRanges,
  requiredSegmentAt,
  segmentWords,
  stripMarks,
  toValueIndex,
  unmarkRequired,
} from './query-syntax';

describe('parseQuery', () => {
  it('không đánh dấu gì → tìm liên quan, không có từ khoá chính', () => {
    expect(parseQuery('  Chuyến thăm   ABC của thủ tướng ')).toMatchObject({
      required: [],
      optional: ['Chuyến thăm ABC của thủ tướng'],
      loose: true,
    });
  });

  it('phần trong dấu ` là từ khoá chính, phần còn lại là từ phụ', () => {
    const parsed = parseQuery('Chuyến thăm `ABC` của thủ tướng');
    expect(parsed).toMatchObject({ required: ['ABC'], optional: ['Chuyến thăm', 'của thủ tướng'], loose: false });
    expect(parsed.segments.map((s) => [s.text, s.required, s.start, s.end])).toEqual([
      ['Chuyến thăm', false, 0, 11],
      ['ABC', true, 12, 17],
      ['của thủ tướng', false, 18, 31],
    ]);
  });

  it('ngoặc kép (thẳng hay cong) chỉ là ký tự thường, bị bỏ qua', () => {
    expect(parseQuery('Lễ hội “Hoa Ban” "2024"')).toMatchObject({
      required: [],
      optional: ['Lễ hội Hoa Ban 2024'],
      loose: true,
    });
  });

  it('nhiều từ khoá chính, bỏ trùng, dấu rỗng', () => {
    expect(parseQuery('`Trần Văn A` gặp `ABC` và `abc` ``')).toMatchObject({
      required: ['Trần Văn A', 'ABC'],
      optional: ['gặp', 'và'],
    });
  });

  it('dấu mở không có dấu đóng thì kéo tới hết chuỗi', () => {
    expect(parseQuery('thăm `ABC của')).toMatchObject({ required: ['ABC của'], optional: ['thăm'] });
  });

  it('cả cụm trong dấu ` → khớp chính xác cả cụm; chỉ có dấu rỗng → trống', () => {
    expect(parseQuery('`Trần Văn A`')).toMatchObject({ required: ['Trần Văn A'], optional: [], loose: false });
    expect(parseQuery('``')).toMatchObject({ required: [], optional: [], loose: true });
  });
});

describe('canonicalQuery', () => {
  it('giữ dấu ` vì có hay không là khác nghĩa; bỏ ngoặc kép', () => {
    expect(canonicalQuery(parseQuery('Chuyến thăm `ABC`  của “thủ tướng”'))).toBe('Chuyến thăm `ABC` của thủ tướng');
    expect(canonicalQuery(parseQuery('`Trần Văn A`'))).toBe('`Trần Văn A`');
    expect(canonicalQuery(parseQuery('Trần  Văn A'))).toBe('Trần Văn A');
  });
});

describe('looksLikePersonName', () => {
  it.each([
    ['Trần Văn A', true],
    ['Nguyễn Thị Minh Khai', true],
    ['Chuyến thăm ABC của thủ tướng', false],
    ['Vingroup', false],
    ['Trần Văn A 2019', false],
  ])('%s → %s', (text, expected) => {
    expect(looksLikePersonName(text)).toBe(expected);
  });
});

describe('markRequired / unmarkRequired / requiredSegmentAt', () => {
  const text = 'Chuyến thăm ABC của thủ tướng';

  it('bôi đen một phần → thêm dấu `', () => {
    expect(markRequired(text, 12, 15)).toBe('Chuyến thăm `ABC` của thủ tướng');
  });

  it('bôi đen giữa chữ thì nới ra cho đủ từ', () => {
    expect(markRequired(text, 13, 14)).toBe('Chuyến thăm `ABC` của thủ tướng');
    expect(markRequired(text, 22, 26)).toBe('Chuyến thăm ABC của `thủ tướng`');
  });

  it('vùng chọn chạm cụm đã đánh dấu thì gộp lại', () => {
    expect(markRequired('Chuyến thăm `ABC` của thủ tướng', 14, 21)).toBe('Chuyến thăm `ABC của` thủ tướng');
  });

  it('đánh dấu cả chuỗi → khớp chính xác cả cụm', () => {
    expect(markRequired('Trần Văn A', 0, 10)).toBe('`Trần Văn A`');
  });

  it('vùng chọn chỉ có khoảng trắng thì giữ nguyên', () => {
    expect(markRequired(text, 11, 12)).toBe(text);
  });

  it('bỏ đánh dấu một cụm', () => {
    const input = 'Chuyến thăm `ABC` của `thủ tướng`';
    const segment = parseQuery(input).segments.find((s) => s.text === 'ABC')!;
    expect(unmarkRequired(input, segment)).toBe('Chuyến thăm ABC của `thủ tướng`');
  });

  it('chạm từng từ (điện thoại): từ liền kề nối vào từ khoá chính có sẵn', () => {
    const text = 'Chủ tịch nước Tô Lâm thăm Đan Mạch';
    const words = segmentWords(text, parseQuery(text).segments[0]);
    expect(words.map((w) => w.text)).toEqual(['Chủ', 'tịch', 'nước', 'Tô', 'Lâm', 'thăm', 'Đan', 'Mạch']);
    const tap = (input: string, word: string) => {
      const w = parseQuery(input).segments.filter((seg) => !seg.required).flatMap((seg) => segmentWords(input, seg)).find((x) => x.text === word)!;
      return markRequired(input, w.start, w.end, { mergeAdjacent: true });
    };
    const once = tap(text, 'Tô');
    expect(once).toBe('Chủ tịch nước `Tô` Lâm thăm Đan Mạch');
    expect(tap(once, 'Lâm')).toBe('Chủ tịch nước `Tô Lâm` thăm Đan Mạch');
    expect(tap(tap(once, 'Lâm'), 'Đan')).toBe('Chủ tịch nước `Tô Lâm` thăm `Đan` Mạch'); // không liền kề → từ khoá riêng
    // Bôi đen (không mergeAdjacent) vẫn tạo được hai từ khoá chính liền nhau
    expect(markRequired('`Tô Lâm` Đan Mạch', 9, 17)).toBe('`Tô Lâm` `Đan Mạch`');
  });

  it('tìm từ khoá chính chứa trọn vùng đang bôi đen', () => {
    const parsed = parseQuery('Chuyến thăm `ABC` của thủ tướng');
    expect(requiredSegmentAt(parsed, 13, 16)?.text).toBe('ABC');
    expect(requiredSegmentAt(parsed, 12, 17)?.text).toBe('ABC');
    expect(requiredSegmentAt(parsed, 10, 16)).toBeNull();
  });
});

describe('hiển thị không có dấu ` (stripMarks, markedRanges, toValueIndex, applyPlainEdit)', () => {
  const value = 'Chuyến thăm `ABC` của thủ tướng';

  it('chuỗi hiển thị và vị trí từ khoá chính', () => {
    expect(stripMarks(value)).toBe('Chuyến thăm ABC của thủ tướng');
    expect(markedRanges(value)).toEqual([{ start: 12, end: 15 }]);
    expect(markedRanges('a `bc')).toEqual([{ start: 2, end: 4 }]); // dấu mở chưa đóng
    expect(markedRanges('a `` b')).toEqual([]);
  });

  it('gõ ngay trước / ngay sau từ khoá chính thì nằm ngoài; gõ giữa thì nằm trong', () => {
    expect(applyPlainEdit(value, 12, 12, 'x')).toBe('Chuyến thăm x`ABC` của thủ tướng');
    expect(applyPlainEdit(value, 15, 15, 'x')).toBe('Chuyến thăm `ABC`x của thủ tướng');
    expect(applyPlainEdit(value, 13, 13, 'x')).toBe('Chuyến thăm `AxBC` của thủ tướng');
  });

  it('gõ tay dấu `: gõ tiếp sau dấu mở chưa đóng vẫn nằm trong từ khoá', () => {
    expect(applyPlainEdit('thăm `', 5, 5, 'A')).toBe('thăm `A');
    expect(markedRanges('thăm `A')).toEqual([{ start: 5, end: 6 }]);
  });

  it('xoá: giữ dấu nằm trong đoạn bị xoá, xoá hết từ khoá thì bỏ cặp dấu', () => {
    expect(applyPlainEdit(value, 10, 13, '')).toBe('Chuyến thă`BC` của thủ tướng');
    expect(applyPlainEdit(value, 12, 15, '')).toBe('Chuyến thăm  của thủ tướng');
    expect(applyPlainEdit(value, 14, 19, 'Y')).toBe('Chuyến thăm `ABY` thủ tướng'); // xoá "C của" qua dấu đóng
  });

  it('vị trí hiển thị → vị trí trong giá trị thật', () => {
    expect(toValueIndex(value, 0)).toBe(0);
    expect(toValueIndex(value, 12)).toBe(12); // trước dấu mở
    expect(toValueIndex(value, 13)).toBe(14); // giữa từ khoá
    expect(toValueIndex(value, 15)).toBe(17); // sau dấu đóng
    expect(toValueIndex(value, stripMarks(value).length)).toBe(value.length);
  });
});
