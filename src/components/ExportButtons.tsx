'use client';

import { useState } from 'react';
import { downloadBlob, exportFileName, toCsv, toXlsx } from '@/lib/export';
import type { ArticleResult, RejectedItem } from '@/lib/types';
import { DownloadIcon } from './icons';

export interface ExportScope {
  id: string;
  label: string;
  /** Theo đúng thứ tự và bộ lọc đang hiển thị */
  articles: ArticleResult[];
}

interface Props {
  /** Phạm vi xuất (vd tab đang xem, cả hai tab); phạm vi đầu là mặc định */
  scopes: ExportScope[];
  rejected: RejectedItem[];
  query: string;
}

const buttonClass =
  'inline-flex h-9 items-center gap-1.5 rounded-lg bg-surface px-3 text-sm font-medium ring-1 ring-line transition hover:bg-surface-muted focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50';

export function ExportButtons({ scopes, rejected, query }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const scope = scopes.find((s) => s.id === scopeId) ?? scopes[0];
  const articles = scope?.articles ?? [];

  async function exportXlsx() {
    setBusy(true);
    setError(null);
    try {
      downloadBlob(await toXlsx(articles, rejected), exportFileName(query, 'xlsx'));
    } catch (err) {
      setError(`Không tạo được file Excel: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    downloadBlob(new Blob([toCsv(articles)], { type: 'text/csv;charset=utf-8' }), exportFileName(query, 'csv'));
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {scopes.length > 1 && (
          <label className="flex items-center">
            <span className="sr-only">Xuất những bài nào</span>
            <select
              value={scope.id}
              onChange={(e) => setScopeId(e.target.value)}
              className="h-9 rounded-lg border border-line bg-surface px-2 text-sm outline-none focus:border-accent focus:ring-3 focus:ring-accent/20"
            >
              {scopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.articles.length})
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={exportXlsx}
          disabled={busy || (articles.length === 0 && rejected.length === 0)}
          className={buttonClass}
          title="File Excel gồm sheet “Kết quả” (theo lựa chọn bên cạnh và bộ lọc đang xem) và sheet “Bị loại”"
        >
          <DownloadIcon className="size-4" />
          {busy ? 'Đang tạo…' : 'Excel'}
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={articles.length === 0}
          className={buttonClass}
          title="Danh sách kết quả theo lựa chọn bên cạnh"
        >
          <DownloadIcon className="size-4" />
          CSV
        </button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
