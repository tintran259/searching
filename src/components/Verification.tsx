import { CONDITION_LABELS, EVIDENCE_LABELS, ORIGIN_LABELS, countryLabel } from '@/lib/labels';
import type { ArticleResult, ConditionStatus } from '@/lib/types';

const CONDITION_STYLES: Record<ConditionStatus, string> = {
  matched_exact: 'bg-ok-soft text-ok',
  matched_alias: 'bg-accent-soft text-accent',
  matched_expansion: 'bg-accent-soft text-accent',
  not_matched: 'bg-bad-soft text-bad',
  unverified: 'bg-warn-soft text-warn',
};

/** Trạng thái từng từ khoá bắt buộc: có nguyên văn / cách viết khác / chỉ thấy trên Google, kèm vị trí */
export function ConditionBadges({ item }: { item: ArticleResult }) {
  if (!item.conditions.length) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Từ khoá bắt buộc">
      {item.conditions.map((c) => (
        <li
          key={c.term}
          className={`rounded px-1.5 py-0.5 text-[11px] leading-4 font-medium ${CONDITION_STYLES[c.status]}`}
          title={`${CONDITION_LABELS[c.status]}${c.variant ? ` “${c.variant}”` : ''}${c.where ? ` ở ${EVIDENCE_LABELS[c.where]}` : ''}`}
        >
          {c.term}: {CONDITION_LABELS[c.status].toLowerCase()}
          {c.where && c.status !== 'unverified' ? ` (${EVIDENCE_LABELS[c.where]})` : ''}
        </li>
      ))}
    </ul>
  );
}

/** Quốc gia nhà xuất bản (nếu xác định được), bài gốc / đăng lại; rê chuột xem các tín hiệu */
export function PublisherInfo({ item }: { item: ArticleResult }) {
  const p = item.publisher;
  const country = countryLabel(p.country);
  const tags: { text: string; tone: string }[] = [];
  if (country) tags.push({ text: country, tone: 'text-muted' });
  else if (p.verified) tags.push({ text: 'Nguồn đã biết', tone: 'text-muted' });
  else if (p.kind === 'news') tags.push({ text: 'Chưa rõ quốc gia', tone: 'text-muted' });
  if (p.origin !== 'unknown') tags.push({ text: ORIGIN_LABELS[p.origin], tone: p.origin === 'republished' ? 'text-warn' : 'text-muted' });
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 text-xs" title={p.signals.join('\n')}>
      {tags.map((t) => (
        <span key={t.text} className={t.tone}>
          {t.text}
        </span>
      ))}
    </div>
  );
}
