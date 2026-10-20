import type { NextRequest } from 'next/server';
import { isValidIsoDate } from '@/lib/date-range';
import { WikidataSuggester } from '@/lib/suggest/wikidata';

const MAX_TERM_LENGTH = 80;

/**
 * GET /api/suggest?term=Tô Lâm&from=2026-10-19&to=2026-10-20
 * Gợi ý cách gọi khác cho một từ khoá chính (chức vụ trong khoảng ngày, tên khác, thủ đô…) từ Wikidata.
 * Không tốn lượt SerpApi. Lỗi Wikidata → danh sách rỗng (gợi ý chỉ là phần phụ, không chặn việc tìm).
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const term = (sp.get('term') ?? '').replace(/\s+/g, ' ').trim();
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  if (!term || term.length > MAX_TERM_LENGTH || !isValidIsoDate(from) || !isValidIsoDate(to)) {
    return Response.json({ error: 'Thiếu từ khoá hoặc khoảng ngày không hợp lệ.' }, { status: 400 });
  }
  try {
    const result = await new WikidataSuggester().suggest(term, from, to, request.signal);
    return Response.json(result, { headers: { 'Cache-Control': 'private, max-age=3600' } });
  } catch (err) {
    console.warn('[suggest] Wikidata lỗi:', err);
    return Response.json({ term, entity: null, suggestions: [], error: 'Không lấy được gợi ý từ Wikidata.' });
  }
}
