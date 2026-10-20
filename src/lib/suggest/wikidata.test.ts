import { describe, expect, it } from 'vitest';
import { WikidataSuggester } from './wikidata';

const claim = (id: string, start?: string, end?: string) => ({
  mainsnak: { datavalue: { value: { id } } },
  qualifiers: {
    ...(start ? { P580: [{ datavalue: { value: { time: `+${start}T00:00:00Z` } } }] } : {}),
    ...(end ? { P582: [{ datavalue: { value: { time: `+${end}T00:00:00Z` } } }] } : {}),
  },
  rank: 'normal',
});
const label = (vi: string) => ({ vi: { value: vi } });

/** Dữ liệu Wikidata thu gọn (theo dữ liệu thật của Tô Lâm và Bỉ) */
const ENTITIES: Record<string, object> = {
  Q1: {
    id: 'Q1',
    labels: label('Tô Lâm'),
    descriptions: label('Tổng Bí thư Đảng Cộng sản Việt Nam từ 2024'),
    claims: {
      P31: [claim('Q5')],
      P39: [
        claim('QMIN', '2016-04-09', '2024-05-22'),
        claim('QPRES', '2024-05-22', '2024-10-21'),
        claim('QPRES', '2026-04-07'),
        claim('QGS', '2024-08-03'),
      ],
    },
  },
  QMIN: { id: 'QMIN', labels: label('Bộ trưởng Bộ Công an Việt Nam'), aliases: { vi: [{ value: 'Bộ trưởng Công an Việt Nam' }] } },
  QPRES: {
    id: 'QPRES',
    labels: label('Chủ tịch nước Việt Nam'),
    aliases: { vi: [{ value: 'Chủ tịch nước Cộng hòa Xã hội Chủ nghĩa Việt Nam' }, { value: 'Chủ tịch Việt Nam' }] },
  },
  QGS: {
    id: 'QGS',
    labels: label('Tổng Bí thư Ban Chấp hành Trung ương Đảng Cộng sản Việt Nam'),
    aliases: { vi: [{ value: 'Tổng Bí thư Đảng Cộng sản Việt Nam' }, { value: 'Tổng bí thư Việt Nam' }] },
  },
  Q31: { id: 'Q31', labels: label('Bỉ'), aliases: { vi: [{ value: 'Vương quốc Bỉ' }] }, claims: { P31: [claim('Q6256')], P36: [claim('Q239')] } },
  Q239: { id: 'Q239', labels: { vi: { value: 'Bruxelles' }, en: { value: 'Brussels' } } },
};

function stubFetch() {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.searchParams.get('action') ?? '');
    let body: unknown;
    if (url.searchParams.get('action') === 'wbsearchentities') {
      const id = { 'Tô Lâm': 'Q1', Bỉ: 'Q31' }[url.searchParams.get('search') ?? ''];
      body = { search: id ? [{ id: 'QD', description: 'trang định hướng Wikimedia' }, { id }] : [] };
    } else {
      const ids = (url.searchParams.get('ids') ?? '').split('|');
      body = { entities: Object.fromEntries(ids.map((id) => [id, ENTITIES[id]])) };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('WikidataSuggester', () => {
  it('người: chức vụ trùng khoảng ngày trước (tên ngắn nhất có tên nước), chức vụ đã thôi giữ để sau và đánh dấu', async () => {
    const { fetchImpl } = stubFetch();
    const r = await new WikidataSuggester(fetchImpl).suggest('Tô Lâm', '2026-10-19', '2026-10-20');
    expect(r.entity).toMatchObject({ id: 'Q1', description: 'Tổng Bí thư Đảng Cộng sản Việt Nam từ 2024' });
    expect(r.suggestions.map((s) => [s.text, s.current, s.note])).toEqual([
      ['Chủ tịch Việt Nam', true, 'từ 04/2026'],
      ['Chủ tịch nước Việt Nam', true, 'từ 04/2026'],
      ['Tổng bí thư Việt Nam', true, 'từ 08/2024'],
      ['Tổng Bí thư Đảng Cộng sản Việt Nam', true, 'từ 08/2024'],
      ['Bộ trưởng Công an Việt Nam', false, 'đã thôi giữ từ 05/2024'],
      ['Bộ trưởng Bộ Công an Việt Nam', false, 'đã thôi giữ từ 05/2024'],
    ]);
  });

  it('khoảng ngày năm 2023: Bộ trưởng Công an là chức vụ đang giữ', async () => {
    const { fetchImpl } = stubFetch();
    const r = await new WikidataSuggester(fetchImpl).suggest('Tô Lâm', '2023-01-01', '2023-12-31');
    expect(r.suggestions.filter((s) => s.current).map((s) => s.text)).toEqual(['Bộ trưởng Công an Việt Nam', 'Bộ trưởng Bộ Công an Việt Nam']);
  });

  it('quốc gia: tên khác và thủ đô (cả tên tiếng Việt và tiếng Anh); bỏ trang định hướng', async () => {
    const { fetchImpl } = stubFetch();
    const r = await new WikidataSuggester(fetchImpl).suggest('Bỉ', '2026-10-01', '2026-10-31');
    expect(r.entity?.id).toBe('Q31');
    expect(r.suggestions.map((s) => [s.text, s.kind, s.note])).toEqual([
      ['Vương quốc Bỉ', 'alias', 'Tên khác'],
      ['Bruxelles', 'related', 'Thủ đô'],
      ['Brussels', 'related', 'Thủ đô'],
    ]);
  });

  it('không tìm thấy thực thể: danh sách rỗng', async () => {
    const { fetchImpl } = stubFetch();
    expect(await new WikidataSuggester(fetchImpl).suggest('xyz không có', '2026-10-01', '2026-10-31')).toEqual({
      term: 'xyz không có',
      entity: null,
      suggestions: [],
    });
  });
});
