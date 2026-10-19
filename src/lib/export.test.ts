import { describe, expect, it } from 'vitest';
import { exportFileName, toCsv } from './export';
import type { ArticleResult } from './types';

const article = (overrides: Partial<ArticleResult> = {}): ArticleResult => ({
  id: 'vnexpress.net/a',
  url: 'https://vnexpress.net/a.html',
  title: 'Ông Trần Văn A, "người hùng" thầm lặng',
  domain: 'vnexpress.net',
  sourceName: 'VnExpress',
  region: 'domestic',
  date: { date: '2019-05-12', timestamp: 0, source: 'meta', raw: '2019-05-12', estimated: false },
  snippet: '…ông Trần Văn A cho biết,\nhôm nay…',
  highlights: [{ start: 5, end: 15, kind: 'required' }],
  matchedVariant: 'Trần Văn A',
  matchedLanguage: 'vi',
  loose: false,
  optionalMatch: null,
  foundLanguage: 'vi',
  foundVia: 'google',
  seo: null,
  ...overrides,
});

describe('toCsv', () => {
  it('có BOM UTF-8, tiêu đề cột và escape dấu ngoặc kép / xuống dòng', () => {
    const csv = toCsv([article()]);
    expect(
      csv.startsWith(
        '﻿STT,Ngày đăng,Nguồn ngày,Độ tin cậy,Tiêu đề,Báo,Domain,Phạm vi,Khớp theo,Biến thể khớp,Từ phụ khớp,Tìm qua,Đoạn trích,Link,Tiêu đề SEO,Mô tả (meta description),Ảnh đại diện,Tác giả,Chuyên mục,Từ khoá SEO,Canonical,Ngày cập nhật,Số từ\r\n',
      ),
    ).toBe(true);
    expect(csv).toContain(
      '1,2019-05-12,Meta tag,Tin cậy cao,"Ông Trần Văn A, ""người hùng"" thầm lặng",VnExpress,vnexpress.net,Trong nước,Từ khoá gốc,Trần Văn A,,Tiếng Việt · Google,"…ông Trần Văn A cho biết,\nhôm nay…",https://vnexpress.net/a.html,,,,,,,,,',
    );
  });

  it('ghi rõ bài khớp nhờ bản dịch nào', () => {
    const csv = toCsv([article({ region: 'foreign', matchedLanguage: 'ru', matchedVariant: 'Чан Ван А' })]);
    expect(csv).toContain(',Ngoài nước,Bản dịch tiếng Nga,Чан Ван А,');
    expect(toCsv([article({ foundLanguage: 'ru', foundVia: 'yandex' })])).toContain(',Trần Văn A,,Tiếng Nga · Yandex,');
  });

  it('ghi số từ phụ có trong bài', () => {
    const csv = toCsv([article({ optionalMatch: { found: ['thăm', 'thủ'], total: 4 } })]);
    expect(csv).toContain(',Trần Văn A,"2/4: thăm, thủ",');
    expect(toCsv([article({ loose: true, optionalMatch: { found: [], total: 3 } })])).toContain(',Trần Văn A,0/3,');
  });

  it('xuất kèm chi tiết SEO của bài', () => {
    const csv = toCsv([
      article({
        seo: {
          title: 'Tiêu đề | VnExpress',
          ogTitle: 'Tiêu đề',
          description: 'Mô tả bài',
          ogDescription: null,
          image: 'https://vnexpress.net/a.jpg',
          author: 'Nguyễn Văn B',
          section: 'Thời sự',
          keywords: ['Tô Lâm', 'Đan Mạch'],
          canonical: 'https://vnexpress.net/a.html',
          language: 'vi',
          publisher: 'VnExpress',
          modified: '2026-10-19',
          robots: null,
          wordCount: 820,
        },
      }),
    ]);
    expect(csv).toContain(
      ',https://vnexpress.net/a.html,Tiêu đề | VnExpress,Mô tả bài,https://vnexpress.net/a.jpg,Nguyễn Văn B,Thời sự,"Tô Lâm, Đan Mạch",https://vnexpress.net/a.html,2026-10-19,820',
    );
  });

  it('bài không rõ ngày và ô có nguy cơ chèn công thức', () => {
    const csv = toCsv([article({ date: null, title: '=HYPERLINK("http://x")' })]);
    expect(csv).toContain(',,Không xác định,,');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});

describe('exportFileName', () => {
  it('tên file không dấu kèm ngày', () => {
    expect(exportFileName('Trần Văn A', 'xlsx', new Date(2026, 9, 13))).toBe('bai-viet-tran-van-a-20261013.xlsx');
    expect(exportFileName('', 'csv', new Date(2026, 0, 2))).toBe('bai-viet-ket-qua-20260102.csv');
  });
});
