import { useEffect, useState } from 'react';
import { engineLabel, formatDate, languageLabel } from '@/lib/labels';
import { sourceLabel, sourceNote, type NoteTone } from '@/lib/source-report';
import type { QueryGroup, SourceReport } from '@/lib/types';
import { AlertIcon, ChevronDownIcon } from './icons';
import type { SearchState, SearchStatus } from './useSearchStream';

function ProgressBar({ label, value, max }: { label: string; value: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="tabular-nums">
          {value}/{max}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div
          className="h-full w-full origin-left rounded-full bg-accent transition-transform duration-500 ease-out"
          style={{ transform: `scaleX(${percent / 100})` }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'text-fg' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className={`font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

const DOT_STYLES: Record<SearchStatus, string> = {
  idle: 'bg-muted',
  running: 'bg-accent animate-pulse',
  done: 'bg-ok',
  stopped: 'bg-warn',
  error: 'bg-bad',
};

/** Từ khoá bắt buộc (các biến thể) + từ phụ của một nhóm truy vấn */
function GroupTerms({ group }: { group: QueryGroup }) {
  if (!group.terms.length) return <span className="wrap-break-word text-fg">{group.optional.join(' ')}</span>;
  return (
    <span className="wrap-break-word text-fg">
      {group.terms.map((t) => t.variants.join(' · ')).join(' + ')}
      {group.optional.length > 0 && <span className="text-muted"> + {group.optional.join(' ')}</span>}
    </span>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} giây` : `${Math.floor(seconds / 60)} phút ${seconds % 60} giây`;
}

/** Số giây kể từ khi `active` bật (đếm mỗi giây), 0 khi tắt */
function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [active]);
  return active ? elapsed : 0;
}

function statusText({ status, progress, durationMs, params }: SearchState, translatingFor: number): string {
  if (status === 'error') return 'Không tìm được';
  if (status === 'stopped') return 'Đã dừng — các bài tìm được vẫn được giữ lại';
  if (status === 'done') return durationMs === null ? 'Hoàn tất' : `Hoàn tất sau ${formatDuration(durationMs)}`;
  if (!progress) return 'Đang bắt đầu…';
  const verified = `đã kiểm tra ${progress.verified}/${progress.toVerify} bài`;
  if (progress.phase === 'translating') {
    const base = `Đang dịch từ khoá sang ${params?.languages.length ?? 0} ngôn ngữ… ${translatingFor}s`;
    // Bộ dịch chậm (vd Gemini quá tải): cho người dùng biết app vẫn đang chạy và sẽ tự xử lý
    return translatingFor >= 10 ? `${base} — bộ dịch đang chậm, quá lâu sẽ tự chuyển sang model dự phòng` : base;
  }
  if (progress.phase === 'searching' && progress.language && progress.engine) {
    const page = progress.page ?? 1;
    const range = `kết quả ${(page - 1) * 10 + 1}–${page * 10} / tối đa ${progress.pagesPerSource * 10}`;
    return `Đang tìm ${languageLabel(progress.language).toLowerCase()} trên ${engineLabel(progress.engine)} (${range}) · ${verified}`;
  }
  return `Đã tìm xong, đang kiểm tra ${progress.verified}/${progress.toVerify} bài…`;
}

const NOTE_TONES: Record<NoteTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  muted: 'text-muted',
};

/** Báo cáo theo từng nguồn: yêu cầu bao nhiêu kết quả, tìm được bao nhiêu, hợp lệ / bị loại / trùng, và vì sao thiếu */
function SourceTable({ sources, finished }: { sources: SourceReport[]; finished: boolean }) {
  const num = (n: number, show: boolean) => (show ? n : '–');
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Báo cáo theo ngôn ngữ</h3>
      <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
        <table className="w-full min-w-180 border-collapse text-xs">
          <thead className="text-left text-muted">
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-3 font-medium">Nguồn</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Tối đa</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Tìm được</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Hợp lệ</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Bị loại</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Trùng</th>
              <th scope="col" className="py-2 font-medium">Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((r) => {
              const note = sourceNote(r, finished);
              const ran = r.status !== 'untranslated' && r.status !== 'waiting';
              return (
                <tr key={r.id} className="border-b border-line/60 align-top last:border-0">
                  <td className="py-2 pr-3 font-medium whitespace-nowrap" title={r.query || undefined}>
                    {sourceLabel(r.language, r.engine)}
                  </td>
                  <td className="py-2 pr-3 text-right text-muted tabular-nums">{r.requested}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{num(r.returned, ran)}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-ok tabular-nums">{num(r.accepted, ran)}</td>
                  <td className="py-2 pr-3 text-right text-bad tabular-nums">{num(r.rejected, ran)}</td>
                  <td className="py-2 pr-3 text-right text-muted tabular-nums">{num(r.duplicates, ran)}</td>
                  <td className={`py-2 text-pretty ${NOTE_TONES[note.tone]}`}>{note.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-pretty text-muted">
        &ldquo;Trùng&rdquo; là bài đã được nguồn khác (hoặc chính nguồn này) tìm ra trước. Rê chuột vào tên nguồn để xem truy
        vấn đã gửi.
      </p>
    </div>
  );
}

export function ProgressPanel({ state }: { state: SearchState }) {
  const { progress, plan, params, warnings, error } = state;
  const translatedGroups = plan?.groups.slice(1) ?? [];
  const finished = state.status !== 'running';
  const translatingFor = useElapsedSeconds(state.status === 'running' && progress?.phase === 'translating');

  return (
    <section aria-live="polite" className="flex flex-col gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`size-2.5 shrink-0 rounded-full ${DOT_STYLES[state.status]}`} aria-hidden />
          <p className="font-medium text-pretty">{statusText(state, translatingFor)}</p>
        </div>
        {progress && (
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Stat label="Hợp lệ" value={progress.accepted} tone="text-ok" />
            <Stat label="Bị loại" value={progress.rejected} tone="text-bad" />
            <Stat label="Trùng" value={progress.duplicates} />
            <Stat
              label="Lượt tìm"
              value={progress.cachedCalls ? `${progress.searchCalls} (${progress.cachedCalls} từ bộ nhớ đệm)` : progress.searchCalls}
            />
          </dl>
        )}
      </div>

      {progress && (
        <div className="grid gap-4 sm:grid-cols-2">
          <ProgressBar label="Nguồn đã tìm" value={progress.sourcesDone} max={progress.totalSources} />
          <ProgressBar label="Bài đã kiểm tra" value={progress.verified} max={progress.toVerify} />
        </div>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad">
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg bg-warn-soft px-3 py-2.5 text-sm text-warn">
          {warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-2">
              <AlertIcon className="mt-0.5 size-4 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {progress && progress.sources.length > 0 && <SourceTable sources={progress.sources} finished={finished} />}

      {plan && (
        <details className="group text-xs">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-muted transition hover:text-fg focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            Truy vấn đã dùng
            {translatedGroups.length > 0 && ` và bản dịch (${translatedGroups.length} ngôn ngữ)`}
            {params && ` · ${formatDate(params.fromDate)} → ${formatDate(params.toDate)}`}
            <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-muted">
              Tiếng Việt:{' '}
              <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] break-all text-fg">
                {plan.groups[0].searchQuery}
              </code>
            </p>
            {translatedGroups.length > 0 && (
              <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {translatedGroups.map((g) => (
                  <li key={g.language} className="flex gap-2" title={g.searchQuery}>
                    <span className="w-40 shrink-0 text-muted">{languageLabel(g.language)}</span>
                    <GroupTerms group={g} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
