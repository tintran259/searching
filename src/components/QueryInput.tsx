'use client';

import { Button } from 'antd';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  KEYWORD_MARK,
  LOOSE_MIN_RATIO,
  applyPlainEdit,
  looksLikePersonName,
  markRequired,
  markedRanges,
  parseQuery,
  requiredSegmentAt,
  segmentWords,
  stripMarks,
  toValueIndex,
  unmarkRequired,
} from '@/lib/query-syntax';
import { SEARCH_LIMITS } from '@/lib/search-params';
import { LockIcon, SearchIcon } from './icons';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Nút tìm / dừng đặt cạnh ô nhập */
  action: ReactNode;
}

interface Selection {
  /** Vị trí trong chuỗi hiển thị (không có dấu `) */
  start: number;
  end: number;
  /** Tâm vùng bôi đen, tính từ mép trái ô nhập (px) — vị trí mũi tên của popup */
  x: number;
}

const chipBase =
  'inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60';

/** Độ rộng (px) của chuỗi theo font của ô nhập — ô <input> không cho biết toạ độ vùng bôi đen */
function textWidth(input: HTMLInputElement, text: string, canvas: { current: HTMLCanvasElement | null }): number {
  canvas.current ??= document.createElement('canvas');
  const ctx = canvas.current.getContext('2d');
  if (!ctx) return 0;
  ctx.font = getComputedStyle(input).font;
  return ctx.measureText(text).width;
}

/** Thao tác sửa giữa hai chuỗi hiển thị: thay [start, end) của chuỗi cũ bằng `inserted` (dựa vào vị trí con trỏ) */
function diffEdit(before: string, after: string, caret: number) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  start = Math.min(start, caret);
  let suffix = 0;
  const maxSuffix = Math.min(before.length - start, after.length - Math.max(start, caret));
  while (suffix < maxSuffix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return { start, end: before.length - suffix, inserted: after.slice(start, after.length - suffix) };
}

/**
 * Ô tìm kiếm có từ khoá chính: bôi đen một phần → popup "Đặt làm từ khoá chính",
 * hoặc bấm các thẻ "Cách hiểu" bên dưới để chuyển qua lại giữa từ khoá chính / từ phụ.
 *
 * Giá trị thật đánh dấu từ khoá chính bằng dấu ` (vd "thăm `ABC`"), nhưng ô nhập không hiện dấu đó:
 * một lớp hiển thị nằm dưới tô đậm + đổi màu từ khoá chính, còn ô <input> thật nằm trên có chữ trong suốt
 * (vẫn thấy con trỏ, bôi đen, gõ dấu tiếng Việt bình thường). Gõ tay dấu ` để bắt đầu / kết thúc từ khoá chính.
 */
export function QueryInput({ value, onChange, disabled, action }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  /** Vị trí con trỏ cần đặt lại sau khi chuỗi hiển thị khác chuỗi trong ô (vd vừa gõ dấu `) */
  const pendingCaretRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Vùng bôi đen đã đóng popup bằng Esc ("start:end") — không mở lại cho tới khi bôi đen vùng khác */
  const dismissedRef = useRef<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const parsed = useMemo(() => parseQuery(value), [value]);
  const plain = stripMarks(value);
  const ranges = useMemo(() => markedRanges(value), [value]);
  const toValue = (index: number) => toValueIndex(value, index);
  const hasText = parsed.segments.length > 0;
  const selectedKeyword = selection
    ? requiredSegmentAt(parsed, toValue(selection.start), toValue(selection.end))
    : null;

  /** Lớp hiển thị cuộn ngang theo ô nhập */
  const syncScroll = () => {
    if (mirrorRef.current && inputRef.current) {
      mirrorRef.current.style.transform = `translateX(${-inputRef.current.scrollLeft}px)`;
    }
  };

  // Chạm / bấm ra ngoài ô nhập và popup thì đóng popup. Không đóng khi ô nhập mất focus: trên điện thoại
  // chạm vào nút trong popup làm ô nhập mất focus trước khi nút nhận được cú chạm.
  useEffect(() => {
    if (!selection) return;
    const close = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setSelection(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [selection]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && pendingCaretRef.current !== null) {
      el.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current);
      pendingCaretRef.current = null;
    }
    syncScroll();
  }, [value]);
  const showPopup = Boolean(selection && !disabled);

  const readSelection = () => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    syncScroll();
    if (end <= start || !plain.slice(start, end).trim() || dismissedRef.current === `${start}:${end}`) {
      setSelection(null);
      return;
    }
    dismissedRef.current = null;
    const left = parseFloat(getComputedStyle(el).paddingLeft);
    const before = textWidth(el, plain.slice(0, start), canvasRef);
    const selected = textWidth(el, plain.slice(start, end), canvasRef);
    const x = left + before + selected / 2 - el.scrollLeft;
    // Giữ mũi tên trong phạm vi ô nhập khi vùng bôi đen bị cuộn khuất
    setSelection({ start, end, x: Math.min(Math.max(x, left), el.clientWidth - 24) });
  };

  const apply = (next: string) => {
    const caret = selection?.end ?? null;
    onChange(next);
    setSelection(null);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      el?.focus();
      if (el && caret !== null) el.setSelectionRange(caret, caret);
    });
  };

  let hint: ReactNode;
  if (!hasText) {
    hint = (
      <>
        Mẹo: bôi đen phần bắt buộc phải có nguyên văn (vd tên người) rồi chọn <b className="font-semibold">Đặt làm từ khoá
        chính</b>; hoặc tự gõ trong dấu{' '}
        <code className="rounded bg-surface-muted px-1 font-mono">
          {KEYWORD_MARK}…{KEYWORD_MARK}
        </code>
        . Chấp nhận một trong nhiều cách viết: dùng dấu | trong từ khoá chính, vd{' '}
        <code className="rounded bg-surface-muted px-1 font-mono">
          {KEYWORD_MARK}Bỉ | Brussels{KEYWORD_MARK}
        </code>
        .
      </>
    );
  } else if (parsed.loose) {
    hint = `Chưa có từ khoá chính: tìm bài liên quan — có ít nhất ${Math.round(LOOSE_MIN_RATIO * 100)}% số từ đã nhập, không cần đúng thứ tự. Bôi đen phần cần chính xác để đặt làm từ khoá chính.`;
  } else if (parsed.optional.length === 0) {
    hint = 'Bài phải có nguyên văn mọi từ khoá chính (có ổ khoá), ở tiêu đề hay trong nội dung đều được. Thêm vài từ mô tả nội dung (không đánh dấu) để Google tìm đúng chủ đề hơn.';
  } else {
    hint = 'Bài phải có nguyên văn mọi từ khoá chính (có ổ khoá), ở tiêu đề hay trong nội dung đều được. Các từ còn lại giúp Google tìm đúng chủ đề và để chấm mức liên quan, không bắt buộc.';
  }

  return (
    // Điện thoại: ô nhập → cách hiểu → gợi ý → nút tìm; màn hình rộng: nút tìm nằm cạnh ô nhập
    <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div ref={wrapperRef} className="relative sm:col-start-1 sm:row-start-1">
        {/* Lớp hiển thị: cùng font / lề với ô nhập, từ khoá chính tô đậm + đổi màu */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 flex items-center overflow-hidden rounded-xl border border-transparent bg-surface pr-4 pl-12 text-base whitespace-pre ${disabled ? 'opacity-60' : ''}`}
        >
          {/* Cắt chữ đúng ở mép vùng nội dung như ô nhập (không tràn sang lề có icon khi chữ cuộn ngang) */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <span ref={mirrorRef} className="inline-block">
              {ranges.length === 0
                ? plain
                : ranges.flatMap((r, i) => [
                    plain.slice(i === 0 ? 0 : ranges[i - 1].end, r.start),
                    <span key={i} className="query-keyword">
                      {plain.slice(r.start, r.end)}
                    </span>,
                    ...(i === ranges.length - 1 ? [plain.slice(r.end)] : []),
                  ])}
            </span>
          </div>
        </div>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          aria-label="Từ khoá cần tìm"
          value={plain}
          onChange={(e) => {
            const el = e.target;
            const { start, end, inserted } = diffEdit(plain, el.value, el.selectionEnd ?? el.value.length);
            const next = applyPlainEdit(value, start, end, inserted);
            // Vừa gõ dấu ` (không hiện trong ô) → đặt lại con trỏ cho đúng chỗ
            if (stripMarks(next) !== el.value) pendingCaretRef.current = start + stripMarks(inserted).length;
            onChange(next);
            setSelection(null);
          }}
          onSelect={readSelection}
          onKeyUp={readSelection}
          onMouseUp={readSelection}
          onScroll={readSelection}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || !selection) return;
            dismissedRef.current = `${selection.start}:${selection.end}`;
            setSelection(null);
          }}
          placeholder="Vd: Chuyến thăm ABC của thủ tướng"
          maxLength={SEARCH_LIMITS.maxQueryLength}
          disabled={disabled}
          autoFocus
          className="relative h-13 w-full rounded-xl border border-line bg-transparent pr-4 pl-12 text-base text-transparent caret-fg outline-none transition selection:bg-accent-soft selection:text-fg placeholder:text-muted/70 focus:border-accent focus:ring-4 focus:ring-accent/15 disabled:opacity-60"
        />

        {/* Popup dưới vùng bôi đen (trên điện thoại, menu Sao chép/Dán của hệ thống nằm phía trên) */}
        {showPopup && selection && (
          <div
            role="toolbar"
            aria-label="Phần đã bôi đen"
            className="query-popup absolute top-full z-20 mt-2 -translate-x-1/2"
            style={{ left: selection.x }}
            // Giữ vùng bôi đen trong ô nhập khi bấm vào popup
            onMouseDown={(e) => e.preventDefault()}
          >
            <span
              aria-hidden
              className="absolute -top-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 border-t border-l border-line bg-surface"
            />
            <div className="relative rounded-lg border border-line bg-surface p-1.5 whitespace-nowrap shadow-card">
              {selectedKeyword ? (
                <Button size="small" onClick={() => apply(unmarkRequired(value, selectedKeyword))}>
                  Bỏ từ khoá chính
                </Button>
              ) : (
                <Button
                  size="small"
                  type="primary"
                  icon={<LockIcon className="size-3.5" />}
                  onClick={() => apply(markRequired(value, toValue(selection.start), toValue(selection.end)))}
                >
                  Đặt làm từ khoá chính
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {hasText && (
        <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2">
          <span className="pr-1 text-xs text-muted">Chạm từ để đặt làm từ khoá chính:</span>
          {parsed.segments.map((segment, i) =>
            segment.required ? (
              <button
                key={i}
                type="button"
                onClick={() => apply(unmarkRequired(value, segment))}
                disabled={disabled}
                className={`${chipBase} bg-accent-soft text-accent ring-1 ring-accent/40 hover:ring-accent`}
                title="Từ khoá chính, bài phải có nguyên văn — chạm để bỏ"
              >
                <LockIcon className="size-3.5 shrink-0" />
                <span className="truncate">{segment.text}</span>
              </button>
            ) : (
              // Từ phụ tách từng từ: chạm một từ để đặt làm từ khoá chính, chạm từ liền kề để nối thành cụm
              segmentWords(value, segment).map((word) => (
                <button
                  key={`${i}-${word.start}`}
                  type="button"
                  onClick={() => apply(markRequired(value, word.start, word.end, { mergeAdjacent: true }))}
                  disabled={disabled}
                  className={`${chipBase} px-1.5 text-muted ring-1 ring-line ring-inset hover:text-fg hover:ring-muted/50`}
                  title="Từ phụ — chạm để đặt làm từ khoá chính (chạm tiếp từ liền kề để nối thành cụm)"
                >
                  {word.text}
                </button>
              ))
            ),
          )}
        </div>
      )}

      <p className="text-xs leading-relaxed text-pretty text-muted sm:col-span-2">
        {hint}
        {parsed.loose && looksLikePersonName(value) && (
          <>
            {' '}
            <button
              type="button"
              onClick={() => apply(markRequired(value, 0, value.length))}
              disabled={disabled}
              className="rounded font-semibold text-accent hover:underline focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none"
            >
              Đây là tên người? Đặt cả tên làm từ khoá chính
            </button>
          </>
        )}
      </p>

      <div className="mt-1 grid sm:col-start-2 sm:row-start-1 sm:mt-0">{action}</div>
    </div>
  );
}
