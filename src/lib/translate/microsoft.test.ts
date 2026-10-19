import { describe, expect, it } from 'vitest';
import { SEARCH_LANGUAGES } from '@/config/languages';
import { createCache } from '../cache';
import { withTranslationCache } from './cached';
import { withFallback } from './fallback';
import { MicrosoftTranslator } from './microsoft';
import { TranslationError, type Translator } from './types';

const langs = (...codes: string[]) => SEARCH_LANGUAGES.filter((l) => codes.includes(l.code));

function stubFetch(status: number, body: unknown) {
  const requests: { url: URL; headers: Headers; body: unknown }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

describe('MicrosoftTranslator', () => {
  it('gọi API v3 với mã ngôn ngữ của Microsoft, trả 1 cách viết mỗi ngôn ngữ', async () => {
    const { requests, fetchImpl } = stubFetch(200, [
      { translations: [{ text: 'To Lam', to: 'en' }, { text: '苏林', to: 'zh-Hans' }, { text: 'To Lam', to: 'fil' }] },
    ]);
    const result = await new MicrosoftTranslator('KEY', 'southeastasia', { fetch: fetchImpl }).translate(
      'Tô Lâm',
      langs('en', 'zh-CN', 'tl', 'lo'),
    );
    const [{ url, headers, body }] = requests;
    expect(url.origin + url.pathname).toBe('https://api.cognitive.microsofttranslator.com/translate');
    expect(url.searchParams.get('api-version')).toBe('3.0');
    expect(url.searchParams.get('from')).toBe('vi');
    expect(url.searchParams.getAll('to')).toEqual(['en', 'zh-Hans', 'lo', 'fil']);
    expect(headers.get('Ocp-Apim-Subscription-Key')).toBe('KEY');
    expect(headers.get('Ocp-Apim-Subscription-Region')).toBe('southeastasia');
    expect(body).toEqual([{ Text: 'Tô Lâm' }]);
    expect(result).toEqual([
      { language: 'en', variants: ['To Lam'] },
      { language: 'zh-CN', variants: ['苏林'] },
      { language: 'lo', variants: [] },
      { language: 'tl', variants: ['To Lam'] },
    ]);
  });

  it('lỗi key / hết hạn mức → TranslationError dễ hiểu', async () => {
    const bad = stubFetch(401, { error: { code: 401000, message: 'Unauthorized' } });
    await expect(new MicrosoftTranslator('KEY', '', { fetch: bad.fetchImpl }).translate('x', langs('en'))).rejects.toThrow(
      'key hoặc vùng (region) không hợp lệ',
    );
    const quota = stubFetch(403, { error: { code: 403001, message: 'Out of call volume quota' } });
    await expect(new MicrosoftTranslator('KEY', '', { fetch: quota.fetchImpl }).translate('x', langs('en'))).rejects.toThrow(
      'đã hết hạn mức (Out of call volume quota)',
    );
  });
});

describe('withFallback + cache', () => {
  const failing: Translator = {
    id: 'gemini',
    async translate() {
      throw new TranslationError('Gemini API: đã hết lượt của gói miễn phí');
    },
  };
  const backup: Translator = {
    id: 'microsoft',
    async translate(_phrase, languages) {
      return languages.map((l) => ({ language: l.code, variants: [`${l.code}-mt`] }));
    },
  };

  it('bộ chính lỗi → dùng bộ dự phòng, kèm lý do; không lưu cache để lần sau thử lại bộ chính', async () => {
    let primaryCalls = 0;
    const counting: Translator = {
      id: 'gemini',
      async translate(phrase, languages, signal) {
        primaryCalls++;
        return failing.translate(phrase, languages, signal);
      },
    };
    const translator = withTranslationCache(
      withFallback(counting, backup, 'bản dịch máy Microsoft Translator'),
      createCache('translations-test', { ttlMs: 60_000, mode: 'memory' }),
    );
    const first = await translator.translate('Tô Lâm', langs('en', 'ru'));
    expect(first).toEqual([
      { language: 'en', variants: ['en-mt'], fallbackNote: 'Gemini API: đã hết lượt của gói miễn phí → đã dùng bản dịch máy Microsoft Translator' },
      { language: 'ru', variants: ['ru-mt'], fallbackNote: 'Gemini API: đã hết lượt của gói miễn phí → đã dùng bản dịch máy Microsoft Translator' },
    ]);
    await translator.translate('Tô Lâm', langs('en', 'ru'));
    expect(primaryCalls).toBe(2);
  });

  it('cả hai đều lỗi → báo lỗi của cả hai', async () => {
    const broken: Translator = {
      id: 'microsoft',
      async translate() {
        throw new TranslationError('Không kết nối được Microsoft Translator');
      },
    };
    await expect(withFallback(failing, broken, 'Microsoft Translator').translate('x', langs('en'))).rejects.toThrow(
      'Gemini API: đã hết lượt của gói miễn phí; Microsoft Translator cũng lỗi: Không kết nối được Microsoft Translator',
    );
  });
});
