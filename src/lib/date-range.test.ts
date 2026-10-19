import { describe, expect, it } from 'vitest';
import { isValidIsoDate, shiftDate, splitByYear, todayInVietnam } from './date-range';

describe('splitByYear', () => {
  it('chia theo năm, giữ đúng ngày đầu và cuối, từ năm xa nhất', () => {
    expect(splitByYear('2019-05-01', '2021-03-31')).toEqual([
      { year: 2019, start: '2019-05-01', end: '2019-12-31' },
      { year: 2020, start: '2020-01-01', end: '2020-12-31' },
      { year: 2021, start: '2021-01-01', end: '2021-03-31' },
    ]);
  });

  it('khoảng nằm trong một năm', () => {
    expect(splitByYear('2024-02-10', '2024-02-20')).toEqual([{ year: 2024, start: '2024-02-10', end: '2024-02-20' }]);
  });
});

describe('isValidIsoDate', () => {
  it.each([
    ['2024-02-29', true],
    ['2023-02-29', false],
    ['2024-13-01', false],
    ['2024-1-01', false],
    ['01/02/2024', false],
  ])('%s → %s', (value, expected) => {
    expect(isValidIsoDate(value)).toBe(expected);
  });
});

describe('todayInVietnam', () => {
  it('đổi sang ngày theo giờ Việt Nam (GMT+7)', () => {
    expect(todayInVietnam(new Date('2026-10-14T18:30:00Z'))).toBe('2026-10-15');
    expect(todayInVietnam(new Date('2026-10-14T16:30:00Z'))).toBe('2026-10-14');
  });
});

describe('shiftDate', () => {
  it('lùi theo năm, tháng, ngày; ngày cuối tháng được giữ hợp lệ', () => {
    expect(shiftDate('2026-10-15', { years: -5 })).toBe('2021-10-15');
    expect(shiftDate('2026-10-15', { months: -12 })).toBe('2025-10-15');
    expect(shiftDate('2026-10-15', { days: -30 })).toBe('2026-09-15');
    expect(shiftDate('2024-02-29', { years: -1 })).toBe('2023-02-28');
    expect(shiftDate('2026-03-31', { months: -1 })).toBe('2026-02-28');
  });
});
