import { describe, expect, it } from 'vitest';
import { sourceLabel, sourceNote } from './source-report';
import type { SourceReport } from './types';

const report = (o: Partial<SourceReport> = {}): SourceReport => ({
  id: 'ru:google',
  language: 'ru',
  engine: 'google',
  query: '"Чан Ван А"',
  requested: 10,
  returned: 10,
  exhausted: false,
  accepted: 4,
  rejected: 5,
  duplicates: 1,
  status: 'done',
  ...o,
});

describe('sourceNote', () => {
  it('đủ số kết quả yêu cầu', () => {
    expect(sourceNote(report(), true)).toEqual({ tone: 'ok', text: 'Đủ 10 kết quả; 4 bài hợp lệ.' });
  });

  it('không đủ 10 bài vì công cụ hết kết quả', () => {
    expect(sourceNote(report({ returned: 3, accepted: 2, rejected: 1, duplicates: 0, exhausted: true }), true).text).toBe(
      'Chỉ có 3/10 kết quả: Google không còn kết quả nào khác; 2 bài hợp lệ.',
    );
  });

  it('không có kết quả nào / có kết quả nhưng không bài nào hợp lệ', () => {
    expect(sourceNote(report({ returned: 0, accepted: 0, rejected: 0, duplicates: 0, exhausted: true }), true)).toEqual({
      tone: 'warn',
      text: 'Google không có kết quả nào cho truy vấn này trong khoảng ngày đã chọn.',
    });
    expect(sourceNote(report({ accepted: 0, rejected: 10, duplicates: 0, engine: 'yandex' }), true).text).toBe(
      'Đủ 10 kết quả; không bài nào hợp lệ (xem lý do ở tab Bị loại).',
    );
  });

  it('đang kiểm tra, lỗi, không có bản dịch', () => {
    expect(sourceNote(report({ accepted: 1, rejected: 1, duplicates: 0 }), false).text).toBe('Đang kiểm tra 8 bài…');
    expect(sourceNote(report({ status: 'failed', returned: 0, error: 'SerpApi không phản hồi sau 30s' }), true)).toEqual({
      tone: 'bad',
      text: 'Lỗi khi tìm: SerpApi không phản hồi sau 30s',
    });
    expect(sourceNote(report({ status: 'untranslated', returned: 0 }), true).tone).toBe('warn');
  });

  it('nhãn nguồn', () => {
    expect(sourceLabel('ru', 'yandex')).toBe('Tiếng Nga · Yandex');
    expect(sourceLabel('vi', 'google')).toBe('Tiếng Việt · Google');
  });
});
