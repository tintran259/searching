import { describe, expect, it } from 'vitest';
import { parseSearchParams, toQueryString } from './search-params';

const TODAY = '2026-10-15';
const parse = (qs: string) => parseSearchParams(new URLSearchParams(qs), TODAY);

describe('parseSearchParams', () => {
  it('dùng giá trị mặc định: Trong nước, hôm qua → hôm nay, 10 kết quả mỗi ngôn ngữ, không dịch', () => {
    expect(parse('q=Trần Văn A')).toEqual({
      ok: true,
      params: {
        query: 'Trần Văn A',
        region: 'domestic',
        fromDate: '2026-10-14',
        toDate: TODAY,
        pagesPerSource: 1,
        languages: [],
        localEngines: false,
        budget: 10,
        exclude: [],
        sourcePolicy: 'labeled',
        excludeRepublished: true,
        allowDomains: [],
        denyDomains: [],
      },
    });
  });

  it('đọc khoảng ngày đầy đủ và đi ngược được qua toQueryString', () => {
    const parsed = parse('q=%60Tr%E1%BA%A7n+V%C4%83n+A%60&region=foreign&from=2019-05-01&to=2020-06-30&pages=5&langs=ru,en,,en,zh-CN&local=1');
    expect(parsed).toEqual({
      ok: true,
      // ngôn ngữ được bỏ trùng và xếp theo thứ tự cấu hình
      params: {
        query: '`Trần Văn A`',
        region: 'foreign',
        fromDate: '2019-05-01',
        toDate: '2020-06-30',
        pagesPerSource: 5,
        languages: ['en', 'ru', 'zh-CN'],
        localEngines: true,
        budget: 10,
        exclude: [],
        sourcePolicy: 'labeled',
        excludeRepublished: true,
        allowDomains: [],
        denyDomains: [],
      },
    });
    if (parsed.ok) expect(parse(toQueryString(parsed.params))).toEqual(parsed);
  });

  it('ngân sách lượt tìm, cụm loại trừ, chính sách nguồn và danh sách domain', () => {
    const parsed = parse(
      `q=a&budget=30&exclude=${encodeURIComponent('bóng đá, xổ số')}&policy=verified&republished=0&allow=${encodeURIComponent('https://www.MirageNews.com/x, b.org')}&deny=c.net`,
    );
    expect(parsed.ok && parsed.params).toMatchObject({
      budget: 30,
      exclude: ['bóng đá', 'xổ số'],
      sourcePolicy: 'verified',
      excludeRepublished: false,
      allowDomains: ['miragenews.com', 'b.org'],
      denyDomains: ['c.net'],
    });
    if (parsed.ok) expect(parse(toQueryString(parsed.params))).toEqual(parsed);
  });

  it('giữ phần đánh dấu từ khoá chính (dấu `), bỏ ngoặc kép, chuẩn hoá khoảng trắng', () => {
    const parsed = parse(`q=${encodeURIComponent('  Chuyến thăm `ABC`   của  “thủ tướng” ')}`);
    expect(parsed.ok && parsed.params.query).toBe('Chuyến thăm `ABC` của thủ tướng');
  });

  it('vẫn nhận kiểu cũ chỉ có năm; ngày kết thúc trong tương lai tính đến hôm nay', () => {
    const parsed = parse('q=a&from=2010&to=2015');
    expect(parsed.ok && [parsed.params.fromDate, parsed.params.toDate]).toEqual(['2010-01-01', '2015-12-31']);
    const future = parse('q=a&from=2026&to=2026');
    expect(future.ok && [future.params.fromDate, future.params.toDate]).toEqual(['2026-01-01', TODAY]);
  });

  it.each([
    ['', 'từ khoá'],
    ['q=%60%60', 'từ khoá'],
    ['q=%22%22', 'từ khoá'],
    ['q=a&region=asia', 'Phạm vi'],
    ['q=a&from=2020-01-01&to=2019-12-31', 'Khoảng ngày'],
    ['q=a&from=1980-01-01', 'Khoảng ngày'],
    ['q=a&from=2027-01-01', 'Khoảng ngày'],
    ['q=a&from=2019-02-30', 'Ngày không hợp lệ'],
    ['q=a&from=01/02/2019', 'Ngày không hợp lệ'],
    ['q=a&pages=0', 'Số kết quả mỗi ngôn ngữ'],
    ['q=a&pages=11', 'Số kết quả mỗi ngôn ngữ'],
    ['q=a&budget=0', 'Số lượt tìm tối đa'],
    ['q=a&budget=101', 'Số lượt tìm tối đa'],
    ['q=a&policy=any', 'Chính sách nguồn'],
    ['q=a&langs=en,xx', 'Ngôn ngữ chưa hỗ trợ: xx'],
    ['q=a&region=foreign', 'chọn ít nhất một ngôn ngữ'],
    [`q=${'a'.repeat(121)}`, 'tối đa'],
  ])('báo lỗi: %s', (qs, message) => {
    const parsed = parse(qs);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(message);
  });
});
