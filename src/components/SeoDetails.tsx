import { formatDate } from '@/lib/labels';
import type { ArticleSeo } from '@/lib/types';
import { ChevronDownIcon } from './icons';

/** Độ dài khuyến nghị cho kết quả tìm kiếm Google (ký tự) */
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;

export function SeoToggle({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="mt-1.5 inline-flex items-center gap-1 rounded text-xs font-medium text-accent hover:underline focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none"
    >
      Chi tiết SEO
      <ChevronDownIcon className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );
}

function Length({ text, max }: { text: string; max: number }) {
  const length = [...text].length;
  return (
    <span className={`ml-1.5 text-[11px] tabular-nums ${length > max ? 'text-warn' : 'text-muted'}`}>
      ({length} ký tự{length > max ? `, nên ≤ ${max}` : ''})
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? <span className="text-muted">—</span>}</dd>
    </>
  );
}

/** Chi tiết SEO của một bài: tiêu đề, mô tả, ảnh đại diện, tác giả, chuyên mục, từ khoá, canonical… */
export function SeoDetails({ seo, id }: { seo: ArticleSeo | null; id: string }) {
  if (!seo) {
    return (
      <p id={id} className="text-xs text-muted">
        Không đọc được thông tin SEO của trang này.
      </p>
    );
  }
  const description = seo.description ?? seo.ogDescription;
  const noindex = seo.robots && /noindex/i.test(seo.robots);
  return (
    <div id={id} className="flex flex-col gap-4 rounded-xl bg-surface-muted/50 p-4 text-xs ring-1 ring-line sm:flex-row">
      {seo.image && (
        // Ảnh từ trang báo bất kỳ: dùng <img> thường thay vì next/image (không khai báo trước được tên miền)
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={seo.image}
          alt="Ảnh đại diện của bài (og:image)"
          // Chỉ hiện khi người dùng mở "Chi tiết SEO" nên tải ngay
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          className="aspect-[1.91/1] w-full shrink-0 rounded-lg bg-surface object-cover ring-1 ring-line sm:w-56"
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
      )}
      <dl className="grid min-w-0 flex-1 grid-cols-[5.5rem_minmax(0,1fr)] sm:grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 leading-relaxed">
        <Row label="Tiêu đề SEO">
          {seo.title ? (
            <>
              {seo.title}
              <Length text={seo.title} max={TITLE_MAX} />
            </>
          ) : null}
        </Row>
        {seo.ogTitle && seo.ogTitle !== seo.title && <Row label="Tiêu đề chia sẻ">{seo.ogTitle}</Row>}
        <Row label="Mô tả">
          {description ? (
            <>
              {description}
              <Length text={description} max={DESCRIPTION_MAX} />
            </>
          ) : null}
        </Row>
        <Row label="Tác giả">{seo.author}</Row>
        <Row label="Chuyên mục">{seo.section}</Row>
        <Row label="Từ khoá">
          {seo.keywords.length ? (
            <span className="flex flex-wrap gap-1">
              {seo.keywords.map((k) => (
                <span key={k} className="rounded bg-surface px-1.5 py-0.5 ring-1 ring-line">
                  {k}
                </span>
              ))}
            </span>
          ) : null}
        </Row>
        <Row label="Canonical">
          {seo.canonical ? (
            <a href={seo.canonical} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">
              {seo.canonical}
            </a>
          ) : null}
        </Row>
        <Row label="Nhà xuất bản">{seo.publisher}</Row>
        <Row label="Ngôn ngữ">{seo.language}</Row>
        <Row label="Cập nhật">{seo.modified ? formatDate(seo.modified) : null}</Row>
        <Row label="Robots">
          {seo.robots ? <span className={noindex ? 'font-medium text-warn' : undefined}>{seo.robots}</span> : null}
        </Row>
        <Row label="Số từ">{seo.wordCount.toLocaleString('vi-VN')}</Row>
      </dl>
    </div>
  );
}
