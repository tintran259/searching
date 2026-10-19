/** Thông tin chung của trang, dùng cho metadata, sitemap, robots, JSON-LD */
export const SITE_NAME = 'Dò bài viết';
export const SITE_TITLE = 'Dò bài viết — tìm bài báo nhắc tới một người hoặc sự kiện';
export const SITE_DESCRIPTION =
  'Tìm link bài báo trong nước và quốc tế nhắc tới một người hoặc sự kiện: tự dịch từ khoá sang nhiều ngôn ngữ, kiểm tra nội dung và ngày đăng từng bài, xếp từ cũ đến mới, xuất Excel / CSV.';

/**
 * Địa chỉ gốc của trang (không có "/" cuối): SITE_URL nếu đặt (vd tên miền riêng), trên Vercel là tên miền
 * production của project, chạy máy thì localhost.
 */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}
