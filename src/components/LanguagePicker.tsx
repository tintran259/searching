'use client';

import { DEFAULT_LANGUAGE_CODES, LANGUAGE_REGIONS, SEARCH_LANGUAGES } from '@/config/languages';
import { CheckIcon } from './icons';

interface Props {
  value: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
}

const PRESETS = [
  { label: 'Gợi ý (Anh, Đức, Nga, Trung, Đông Nam Á)', codes: DEFAULT_LANGUAGE_CODES },
  { label: 'Tất cả', codes: SEARCH_LANGUAGES.map((l) => l.code) },
  { label: 'Bỏ chọn hết', codes: [] as string[] },
];

export function LanguagePicker({ value, onChange, disabled }: Props) {
  const selected = new Set(value);
  // Giữ thứ tự theo cấu hình để truy vấn và cache ổn định
  const toggle = (code: string) =>
    onChange(SEARCH_LANGUAGES.filter((l) => (l.code === code ? !selected.has(code) : selected.has(l.code))).map((l) => l.code));

  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">
        Ngôn ngữ / nước cần tìm
        <span className="mt-0.5 block text-xs font-normal text-pretty text-muted">
          Từ khoá tiếng Việt được tự dịch / phiên âm sang từng ngôn ngữ đã chọn rồi tìm riêng trên Google của nước đó.
          Không tìm bằng tiếng Việt khi tìm báo nước ngoài.
        </span>
      </legend>

      {LANGUAGE_REGIONS.map((region) => (
        <div key={region.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
          <span className="w-40 shrink-0 pt-1 text-xs text-muted">{region.label}</span>
          <div className="flex flex-wrap gap-1.5">
            {SEARCH_LANGUAGES.filter((l) => l.region === region.id).map((l) => {
              const on = selected.has(l.code);
              return (
                <label
                  key={l.code}
                  className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition select-none has-disabled:cursor-not-allowed has-focus-visible:ring-3 has-focus-visible:ring-accent/30 active:scale-[0.97] ${
                    on ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:text-fg'
                  }`}
                >
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(l.code)} />
                  {on && <CheckIcon className="size-3.5" />}
                  {l.name.replace(/^Tiếng /, '')}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:pl-44">
        <span className="text-muted tabular-nums">Đã chọn {value.length} ngôn ngữ ·</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange(preset.codes)}
            className="rounded font-medium text-accent hover:underline focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none disabled:opacity-50"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
