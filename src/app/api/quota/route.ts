import { connection } from 'next/server';
import { getSearchQuota } from '@/lib/search';

/** GET /api/quota — số lượt tìm còn lại của tài khoản SerpApi (null nếu chưa cấu hình) */
export async function GET() {
  // Luôn đọc theo từng request, không prerender lúc build
  await connection();
  return Response.json(await getSearchQuota(), { headers: { 'Cache-Control': 'no-store' } });
}
