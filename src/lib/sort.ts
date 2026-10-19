import type { ArticleResult } from './types';

export type SortDirection = 'asc' | 'desc';

/** Sắp xếp theo ngày đăng. Bài không xác định được ngày luôn nằm cuối, theo tiêu đề. */
export function sortArticles(items: ArticleResult[], direction: SortDirection = 'asc'): ArticleResult[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (a.date && b.date) return sign * (a.date.timestamp - b.date.timestamp) || a.title.localeCompare(b.title, 'vi');
    if (a.date) return -1;
    if (b.date) return 1;
    return a.title.localeCompare(b.title, 'vi');
  });
}
