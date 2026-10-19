import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    // API tìm kiếm tốn quota và không có nội dung để index
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
