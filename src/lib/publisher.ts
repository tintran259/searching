/**
 * Hồ sơ nguồn của một bài: quốc gia nhà xuất bản, ngôn ngữ, bài gốc hay đăng lại — dựa trên bằng chứng
 * của chính trang (tên miền, danh sách báo, thẻ meta, dòng ghi nguồn), KHÔNG dựa trên gl / hl / lr đã gửi cho Google.
 * Mỗi kết luận kèm danh sách tín hiệu để người dùng đối chiếu.
 */
import { COUNTRY_TLDS, DOMESTIC_SOURCES, FOREIGN_SOURCES } from '@/config/sources';
import { isVietnameseText } from './language-detect';
import type { ParsedPage } from './page-parser';
import { removeDiacritics } from './query-builder';
import { classifyRegion, hostnameOf, isForeignVietnameseSource, sourceNameOf } from './region';
import type { PublisherProfile, Region } from './types';

const hostMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Domain có trong danh sách người dùng nhập (khớp cả subdomain) */
export function domainListed(url: string, domains: string[]): boolean {
  const host = hostnameOf(url);
  return !!host && domains.some((d) => hostMatches(host, d.toLowerCase().replace(/^www\./, '')));
}

function knownForeign(url: string): { name: string; country: string | null } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const entry = FOREIGN_SOURCES.find((s) => hostMatches(host, s.match));
  return entry ? { name: entry.name, country: entry.country ?? null } : null;
}

/** Đuôi tên miền quốc gia (bbc.co.uk → uk), null nếu là tên miền chung */
function countryFromTld(url: string): { tld: string; country: string } | null {
  const tld = hostnameOf(url).split('.').pop() ?? '';
  const country = COUNTRY_TLDS[tld];
  return country ? { tld, country } : null;
}

/** Tên báo Việt Nam đã biết (so không phân biệt hoa thường / dấu, bỏ "Báo", "Online", "English Edition"…) */
const DOMESTIC_NAMES = new Set(DOMESTIC_SOURCES.map((s) => normalizeName(s.name)));
function normalizeName(name: string): string {
  return removeDiacritics(name)
    .toLowerCase()
    .replace(/^bao\s+/, '')
    .replace(/\s+(online|english edition|english|international)$/, '')
    .trim();
}

/**
 * Dòng ghi nguồn cho thấy bài lấy từ báo / hãng tin Việt Nam: "(VNA)", "Hanoi (VNA) –", "Source: VietnamPlus",
 * "[VOVWORLD]", "VGP -"… Chỉ xét đầu và cuối bài, nơi thường đặt dòng ghi nguồn; nhắc tới "theo TTXVN"
 * giữa bài là trích dẫn, không phải đăng lại.
 */
const CREDIT_LINES: RegExp[] = [
  /\((?:VNA|VNS|TTXVN|VGP|VOV)\)/,
  /\[VOVWORLD\]/i,
  /(?:^|\n)\s*VGP\s*[-–—]/,
  /\b(?:Source|Nguồn|Quelle|Источник|Fuente)\s*[:：]\s*(?:VNA|Vietnam News Agency|TTXVN|VietnamPlus|Vietnam\+|VnExpress|Tuoi Tre|Tuổi Trẻ|Thanh Nien|Thanh Niên|Nhan Dan|Nhân Dân|VOV|Viet ?Nam News|VTV|VietNamNet)\b/i,
  /来源[:：]\s*(?:越通社|越南通讯社|越南通訊社)/,
];
const EDGE_CHARS = 600;

function creditLine(text: string): string | null {
  const edges = text.length <= EDGE_CHARS * 2 ? [text] : [text.slice(0, EDGE_CHARS), text.slice(-EDGE_CHARS)];
  for (const part of edges) {
    for (const re of CREDIT_LINES) {
      const m = re.exec(part);
      if (m) return m[0].trim();
    }
  }
  return null;
}

/** Bằng chứng bài nước ngoài là bài đăng lại / dịch lại từ báo Việt Nam */
function republishedSignals(page: ParsedPage, googleSourceName?: string): string[] {
  const signals: string[] = [];
  const finalHost = hostnameOf(page.finalUrl);
  if (page.canonicalUrl && hostnameOf(page.canonicalUrl) !== finalHost && classifyRegion(page.canonicalUrl) === 'domestic') {
    signals.push(`Canonical trỏ về báo Việt Nam (${hostnameOf(page.canonicalUrl)})`);
  }
  const names = [page.siteName, page.seo?.publisher, googleSourceName].filter((n): n is string => !!n);
  const domesticName = names.find((n) => DOMESTIC_NAMES.has(normalizeName(n)));
  if (domesticName) signals.push(`Đơn vị xuất bản “${domesticName}” là báo Việt Nam`);
  const credit = creditLine(page.mainText);
  if (credit) signals.push(`Ghi nguồn “${credit}” (báo / hãng tin Việt Nam)`);
  return signals;
}

/**
 * Tài khoản mạng xã hội của báo / hãng tin Việt Nam (phần đầu đường dẫn: facebook.com/VNAEnglish,
 * instagram.com/vnexpress, x.com/VietnamPlus…): bài đăng của họ bằng tiếng nước ngoài vẫn là báo Việt Nam.
 */
const VN_OUTLET_ACCOUNT =
  /^(?:vna|vnaenglish|ttxvn|vietnamplus|vnexpress|tuoitre|thanhnien|nhandan|vovworld|vov|vtv|baochinhphu|vietnamnews|vietnamnet|dantri|znews|zingnews|laodong|qdnd|cand|sggp|hanoitimes|vir)/i;

function socialAccount(url: string): string | null {
  try {
    const first = new URL(url).pathname.split('/').filter(Boolean)[0] ?? '';
    return first.replace(/^@/, '') || null;
  } catch {
    return null;
  }
}

/** Mã ngôn ngữ từ thẻ lang / og:locale ("en-US", "en_GB" → "en"; "zh-CN" giữ nguyên) */
function pageLanguage(page: ParsedPage | null | undefined, text: string): string | null {
  const raw = page?.seo?.language?.trim();
  if (raw) {
    const code = raw.replace('_', '-').toLowerCase();
    return code.startsWith('zh') ? code.replace(/^zh-(cn|hans).*/, 'zh-CN').replace(/^zh-(tw|hant|hk).*/, 'zh-TW') : code.split('-')[0];
  }
  return text && isVietnameseText(text) ? 'vi' : null;
}

export interface PublisherInput {
  /** URL thật của bài (sau chuyển hướng) */
  url: string;
  region: Region;
  kind: 'news' | 'social';
  /** Trang đã tải; null khi chỉ có tiêu đề + đoạn trích của Google */
  page: ParsedPage | null;
  /** Văn bản để đoán ngôn ngữ khi trang không ghi (nội dung chính, hoặc đoạn trích) */
  text: string;
  allowDomains?: string[];
  /** Tên báo do Google News ghi */
  googleSourceName?: string;
}

export function profilePublisher(input: PublisherInput): PublisherProfile {
  const { url, region, kind, page } = input;
  const signals: string[] = [];
  let country: string | null = null;
  let verified = false;

  if (domainListed(url, input.allowDomains ?? [])) {
    verified = true;
    signals.push('Domain nằm trong danh sách được cho phép');
  }

  let origin: PublisherProfile['origin'] = 'unknown';
  if (kind === 'social') {
    const account = socialAccount(url);
    if (region === 'foreign' && account && VN_OUTLET_ACCOUNT.test(account)) {
      origin = 'republished';
      signals.push(`Tài khoản “${account}” của báo / hãng tin Việt Nam`);
    } else {
      signals.push('Bài đăng mạng xã hội: phạm vi xét theo ngôn ngữ bài đăng, chưa xác minh được tài khoản đăng');
    }
  } else if (region === 'domestic') {
    country = 'vn';
    const host = hostnameOf(url);
    if (host.endsWith('.vn')) {
      verified = true;
      signals.push('Tên miền .vn');
    }
    const name = sourceNameOf(url);
    if (name) {
      verified = true;
      signals.push(`Có trong danh sách báo Việt Nam (${name})`);
    }
  } else {
    const known = knownForeign(url);
    const tld = countryFromTld(url);
    if (isForeignVietnameseSource(url)) {
      verified = true;
      signals.push(`Báo nước ngoài tiếng Việt (${sourceNameOf(url)})`);
    }
    if (known) {
      verified = true;
      country = known.country;
      signals.push(`Có trong danh sách báo nước ngoài (${known.name})`);
    }
    if (tld) {
      verified = true;
      country ??= tld.country;
      signals.push(`Tên miền quốc gia .${tld.tld}`);
    }
    if (!known && !tld && !isForeignVietnameseSource(url)) {
      signals.push('Chưa xác định được quốc gia nhà xuất bản (tên miền chung như .com / .org, chưa có trong danh sách báo đã biết)');
    }
  }

  if (page && kind === 'news' && region === 'foreign') {
    const republished = republishedSignals(page, input.googleSourceName);
    origin = republished.length ? 'republished' : 'original';
    signals.push(...(republished.length ? republished : ['Không thấy dấu hiệu đăng lại từ báo Việt Nam']));
  }

  return { country, verified, language: pageLanguage(page, input.text), kind, origin, signals };
}
