/**
 * Gợi ý cách gọi khác cho từ khoá chính, lấy từ Wikidata (miễn phí, không cần key, cập nhật liên tục):
 *  - người: các chức vụ đã / đang giữ (P39) kèm ngày bắt đầu / kết thúc → chỉ chức vụ trùng khoảng ngày đang tìm
 *    mới được coi là "đang giữ"; tên chức vụ lấy bản ngắn có tên nước ("Chủ tịch nước Việt Nam") để ít nhầm người;
 *  - mọi thực thể: tên khác (aliases) bằng tiếng Việt; quốc gia: thủ đô (P36).
 * API: https://www.wikidata.org/w/api.php (wbsearchentities, wbgetentities).
 */
import { createCache } from '../cache';
import { USER_AGENT } from '../fetcher';
import { removeDiacritics } from '../query-builder';
import type { KeywordSuggestion, TermSuggestions } from '../types';

const API = 'https://www.wikidata.org/w/api.php';
const TIMEOUT_MS = 8_000;
const HUMAN = 'Q5';
/** Số gợi ý tối đa mỗi loại, để danh sách gọn */
const MAX_ROLES = 4;
const MAX_ALIASES = 3;
/** Mỗi chức vụ lấy tối đa chừng này cách gọi (ngắn nhất trước) */
const NAMES_PER_ROLE = 2;
/** Tên quá dài hầu như không xuất hiện nguyên văn trong bài báo */
const MAX_NAME_LENGTH = 60;

const cache = createCache<TermSuggestions>('wikidata-suggest-v2', { ttlMs: 7 * 24 * 3_600_000 });

interface WdSnak {
  datavalue?: { value?: { id?: string; time?: string } };
}
interface WdClaim {
  mainsnak: WdSnak;
  qualifiers?: Record<string, WdSnak[]>;
  rank?: 'preferred' | 'normal' | 'deprecated';
}
interface WdEntity {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
  claims?: Record<string, WdClaim[]>;
}

const fold = (s: string) => removeDiacritics(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** "+2024-08-03T00:00:00Z" → "2024-08-03" (độ chính xác chỉ tới năm / tháng: "-00" → "-01") */
function wdDate(time: string | undefined): string | null {
  const m = time ? /^[+-]?(\d{4})-(\d{2})-(\d{2})/.exec(time) : null;
  if (!m) return null;
  return `${m[1]}-${m[2] === '00' ? '01' : m[2]}-${m[3] === '00' ? '01' : m[3]}`;
}

/** "2024-08-03" → "08/2024" */
const monthYear = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export class WikidataSuggester {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async api<T>(params: Record<string, string>, signal?: AbortSignal): Promise<T> {
    const url = `${API}?${new URLSearchParams({ ...params, format: 'json', origin: '*' })}`;
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const res = await this.fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Thực thể khớp nhất với từ khoá (bỏ trang định hướng); tìm tiếng Việt trước, không có thì tiếng Anh */
  private async findEntity(term: string, signal?: AbortSignal): Promise<string | null> {
    for (const language of ['vi', 'en']) {
      const data = await this.api<{ search?: { id: string; description?: string }[] }>(
        { action: 'wbsearchentities', search: term, language, uselang: 'vi', type: 'item', limit: '5' },
        signal,
      );
      const hit = (data.search ?? []).find((s) => !/disambiguation|định hướng/i.test(s.description ?? ''));
      if (hit) return hit.id;
    }
    return null;
  }

  private async entities(ids: string[], signal?: AbortSignal): Promise<Record<string, WdEntity>> {
    if (!ids.length) return {};
    const data = await this.api<{ entities?: Record<string, WdEntity> }>(
      { action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions|aliases|claims', languages: 'vi|en' },
      signal,
    );
    return data.entities ?? {};
  }

  /** Gợi ý cho một từ khoá trong khoảng ngày [fromDate, toDate] (YYYY-MM-DD) */
  async suggest(term: string, fromDate: string, toDate: string, signal?: AbortSignal): Promise<TermSuggestions> {
    const key = `${fold(term)}|${fromDate}|${toDate}`;
    const cached = await cache.get(key);
    if (cached) return { ...cached, term };

    const empty: TermSuggestions = { term, entity: null, suggestions: [] };
    const id = await this.findEntity(term, signal);
    if (!id) {
      await cache.set(key, empty);
      return empty;
    }
    const entity = (await this.entities([id], signal))[id];
    if (!entity) return empty;

    const label = entity.labels?.vi?.value ?? entity.labels?.en?.value ?? term;
    const description = entity.descriptions?.vi?.value ?? entity.descriptions?.en?.value ?? null;
    const seen = new Set([fold(term), fold(label)]);
    const suggestions: KeywordSuggestion[] = [];
    const add = (s: KeywordSuggestion) => {
      const k = fold(s.text);
      if (!s.text || s.text.length > MAX_NAME_LENGTH || seen.has(k)) return false;
      seen.add(k);
      suggestions.push(s);
      return true;
    };

    const isHuman = (entity.claims?.P31 ?? []).some((c) => c.mainsnak.datavalue?.value?.id === HUMAN);
    if (isHuman) {
      // Chức vụ: đang giữ trong khoảng ngày trước, rồi chức vụ gần nhất đã thôi giữ / chưa nhận
      const positions = (entity.claims?.P39 ?? [])
        .filter((c) => c.rank !== 'deprecated' && c.mainsnak.datavalue?.value?.id)
        .map((c) => ({
          id: c.mainsnak.datavalue!.value!.id!,
          start: wdDate(c.qualifiers?.P580?.[0]?.datavalue?.value?.time),
          end: wdDate(c.qualifiers?.P582?.[0]?.datavalue?.value?.time),
        }))
        .map((p) => ({ ...p, current: (!p.start || p.start <= toDate) && (!p.end || p.end >= fromDate) }));
      // Một chức vụ có thể giữ nhiều nhiệm kỳ: còn một nhiệm kỳ trùng khoảng ngày là "đang giữ"
      const byId = new Map<string, (typeof positions)[number]>();
      for (const p of positions) {
        const known = byId.get(p.id);
        if (!known || (p.current && !known.current) || (p.current === known.current && (p.start ?? '') > (known.start ?? ''))) {
          byId.set(p.id, p);
        }
      }
      const ordered = [...byId.values()].sort(
        (a, b) => Number(b.current) - Number(a.current) || (b.end ?? '9999').localeCompare(a.end ?? '9999'),
      );
      const roles = await this.entities(ordered.map((p) => p.id).slice(0, MAX_ROLES * 2), signal);
      let roleCount = 0;
      for (const p of ordered) {
        if (roleCount >= MAX_ROLES) break;
        const role = roles[p.id];
        if (!role) continue;
        // Tên ngắn nhất trước: tên đầy đủ ("Tổng Bí thư Ban Chấp hành Trung ương Đảng…") hiếm khi được viết nguyên văn
        const names = [role.labels?.vi?.value, ...(role.aliases?.vi ?? []).map((a) => a.value)]
          .filter((n): n is string => !!n && n.length <= MAX_NAME_LENGTH)
          .sort((a, b) => a.length - b.length);
        let note: string;
        if (p.current) note = p.start ? `từ ${monthYear(p.start)}` : 'đang giữ';
        else if (p.end && p.end < fromDate) note = `đã thôi giữ từ ${monthYear(p.end)}`;
        else note = p.start ? `nhận chức từ ${monthYear(p.start)}` : 'không trùng khoảng ngày';
        let added = 0;
        for (const text of names) {
          if (added >= NAMES_PER_ROLE) break;
          if (add({ text, kind: 'role', note, current: p.current })) added++;
        }
        if (added) roleCount++;
      }
    }

    // Tên khác của chính thực thể
    let aliasCount = 0;
    for (const a of entity.aliases?.vi ?? []) {
      if (aliasCount >= MAX_ALIASES) break;
      if (add({ text: a.value, kind: 'alias', note: 'Tên khác', current: true })) aliasCount++;
    }
    if (label !== term && !isHuman) add({ text: label, kind: 'alias', note: 'Tên trên Wikidata', current: true });

    // Quốc gia: thủ đô (báo hay viết "Brussels" thay cho "Bỉ"); lấy cả tên tiếng Việt và tiếng Anh
    // vì báo Việt dùng cả hai ("Bruxelles", "Brussels")
    const capitalId = entity.claims?.P36?.[0]?.mainsnak.datavalue?.value?.id;
    if (capitalId) {
      const capital = (await this.entities([capitalId], signal))[capitalId];
      for (const name of [capital?.labels?.vi?.value, capital?.labels?.en?.value]) {
        if (name) add({ text: name, kind: 'related', note: 'Thủ đô', current: true });
      }
    }

    const result: TermSuggestions = {
      term,
      entity: { id, label, description, url: `https://www.wikidata.org/wiki/${id}` },
      suggestions,
    };
    await cache.set(key, result);
    return result;
  }
}
