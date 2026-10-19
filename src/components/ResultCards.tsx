import { REGION_LABELS, engineLabel, matchSourceLabel } from '@/lib/labels';
import { SOURCE_LANGUAGE, type ArticleResult } from '@/lib/types';
import { ExternalIcon } from './icons';
import { DateInfo, Highlighted, MatchInfo } from './ResultsTable';

/** Kết quả dạng thẻ cho màn hình hẹp (thay cho bảng phải cuộn ngang) */
export function ResultCards({ items }: { items: ArticleResult[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item, i) => (
        <li key={item.id} className="rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line">
          <div className="flex items-start justify-between gap-3">
            <DateInfo item={item} />
            <span className="text-xs text-muted tabular-nums">#{i + 1}</span>
          </div>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2.5 block leading-snug font-semibold text-pretty hover:text-accent"
          >
            {item.title || item.url}
            <ExternalIcon className="ml-1 inline size-3.5 align-[-2px] text-muted" />
          </a>
          <p className="mt-1 text-xs text-muted">
            {item.sourceName ?? item.domain} · {REGION_LABELS[item.region]}
            {item.matchedLanguage !== SOURCE_LANGUAGE ? ` · ${matchSourceLabel(item.matchedLanguage)}` : ''}
            {item.foundVia !== 'google' ? ` · qua ${engineLabel(item.foundVia)}` : ''}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            <Highlighted text={item.snippet} ranges={item.highlights} />
          </p>
          <MatchInfo item={item} />
        </li>
      ))}
    </ol>
  );
}
