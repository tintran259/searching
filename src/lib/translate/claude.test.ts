import { describe, expect, it } from 'vitest';
import { SEARCH_LANGUAGES } from '@/config/languages';
import { createCache } from '../cache';
import { withTranslationCache } from './cached';
import { ClaudeTranslator } from './claude';
import { TranslationError, type Translation, type Translator } from './types';

const langs = (...codes: string[]) => SEARCH_LANGUAGES.filter((l) => codes.includes(l.code));

interface CapturedRequest {
  headers: Headers;
  body: {
    model: string;
    fallbacks: unknown;
    output_config: { effort: string; format: { type: string; schema: { properties: Record<string, unknown> } } };
    system: string;
    messages: { role: string; content: string }[];
  };
}

function stubFetch(status: number, body: unknown) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

const message = (text: string, stopReason = 'end_turn') => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: text ? [{ type: 'text', text }] : [],
  stop_reason: stopReason,
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 50 },
});

const translatorWith = (fetchImpl: typeof fetch) => new ClaudeTranslator({ apiKey: 'test-key', fetch: fetchImpl, maxRetries: 0 });

describe('ClaudeTranslator', () => {
  it('gọi claude-opus-5-5 với JSON schema, fallback mặc định và danh sách ngôn ngữ', async () => {
    const output = {
      translations: [
        { language: 'ru', variants: ['Чан Ван А', '  ', 'Чан Ван A', 'Чан Ван-А', 'thừa'] },
        { language: 'zh-CN', variants: ['陈文A'] },
      ],
    };
    const { requests, fetchImpl } = stubFetch(200, message(JSON.stringify(output)));
    const result = await translatorWith(fetchImpl).translate('Trần Văn A', langs('zh-CN', 'ru', 'th'));

    const [{ headers, body }] = requests;
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.fallbacks).toBe('default');
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(body.output_config.effort).toBe('medium');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(Object.keys(body.output_config.format.schema.properties)).toEqual(['translations']);
    expect(body.messages[0].content).toBe('Keyword: Trần Văn A\nTarget languages:\n- ru: Russian\n- zh-CN: Chinese (Simplified)\n- th: Thai');

    // theo thứ tự ngôn ngữ yêu cầu, bỏ biến thể rỗng, tối đa 3; ngôn ngữ thiếu → rỗng
    expect(result).toEqual<Translation[]>([
      { language: 'ru', variants: ['Чан Ван А', 'Чан Ван A', 'Чан Ван-А'] },
      { language: 'zh-CN', variants: ['陈文A'] },
      { language: 'th', variants: [] },
    ]);
  });

  it('không gọi API khi không có ngôn ngữ nào', async () => {
    const { requests, fetchImpl } = stubFetch(200, message('{}'));
    expect(await translatorWith(fetchImpl).translate('Trần Văn A', [])).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it('Claude từ chối → TranslationError', async () => {
    const { fetchImpl } = stubFetch(200, message('', 'refusal'));
    await expect(translatorWith(fetchImpl).translate('Trần Văn A', langs('en'))).rejects.toThrow(
      new TranslationError('Claude từ chối dịch từ khoá này'),
    );
  });

  it('sai API key → TranslationError dễ hiểu', async () => {
    const { fetchImpl } = stubFetch(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    await expect(translatorWith(fetchImpl).translate('Trần Văn A', langs('en'))).rejects.toThrow(
      'Claude API: API key không hợp lệ (ANTHROPIC_API_KEY)',
    );
  });
});

describe('withTranslationCache', () => {
  it('chỉ dịch những ngôn ngữ chưa có trong cache', async () => {
    const calls: string[][] = [];
    const inner: Translator = {
      id: 'stub',
      async translate(_phrase, languages) {
        calls.push(languages.map((l) => l.code));
        return languages.map((l) => ({ language: l.code, variants: [`${l.code}-variant`] }));
      },
    };
    const cached = withTranslationCache(inner, createCache(`translations-test-${Date.now()}`, { ttlMs: 60_000, mode: 'memory' }));
    await cached.translate('Trần Văn A', langs('en', 'ru'));
    const second = await cached.translate('Trần Văn A', langs('ru', 'th', 'en'));
    expect(calls).toEqual([['en', 'ru'], ['th']]);
    expect(second).toEqual([
      { language: 'en', variants: ['en-variant'] },
      { language: 'ru', variants: ['ru-variant'] },
      { language: 'th', variants: ['th-variant'] },
    ]);
  });
});
