/** Prompt và xử lý kết quả dùng chung cho mọi bộ dịch dựa trên LLM (Gemini, Claude). */
import type { SearchLanguage } from '@/config/languages';
import type { Translation } from './types';

export const MAX_VARIANTS = 3;

export const SYSTEM_PROMPT = `You prepare search keywords for a news-monitoring tool. The user gives a Vietnamese keyword - usually a person's name, sometimes an organization, place or phrase - and a list of target languages. For each target language, write the keyword the way news articles in that language would most likely print it, so that it can be searched as an exact phrase.

Person names (Vietnamese order: family name, middle name(s), given name):
- Latin-script languages: the name without Vietnamese diacritics, normally in Vietnamese order ("Nguyễn Văn An" -> "Nguyen Van An"). Add a given-name-first form ("An Nguyen Van" or "Van An Nguyen") only if press in that language commonly uses it.
- Russian: the standard Cyrillic transcription used by Russian media.
- Chinese: the Sino-Vietnamese (Hán) characters when the name has an established Hán form - simplified for zh-CN, traditional for zh-TW. If the characters are uncertain, put the most likely form first.
- Japanese: katakana transcription as used by Japanese media.
- Korean: Hangul transcription as used by Korean media.
- Thai, Lao, Khmer, Burmese: transcription in that script as used by local media.
For a well-known person, place or organization, prefer the established spelling in that language.
Other keywords: translate the meaning the way local media would write it, keeping proper nouns.

Rules:
- Give 1 to ${MAX_VARIANTS} variants per language, most common first.
- Each variant is only the keyword itself: no explanations, quotation marks, honorifics (Mr., Ông) or extra words.
- Return every requested language exactly once, using the given language codes.`;

export function userPrompt(phrase: string, languages: SearchLanguage[]): string {
  const list = languages.map((l) => `- ${l.code}: ${l.englishName}`).join('\n');
  return `Keyword: ${phrase}\nTarget languages:\n${list}`;
}

/** Sắp theo thứ tự ngôn ngữ yêu cầu, bỏ biến thể rỗng, tối đa MAX_VARIANTS; ngôn ngữ thiếu → danh sách rỗng */
export function pickVariants(
  output: { language: string; variants: string[] }[],
  languages: SearchLanguage[],
): Translation[] {
  return languages.map(({ code }) => ({
    language: code,
    variants: output
      .filter((t) => t.language === code)
      .flatMap((t) => t.variants)
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, MAX_VARIANTS),
  }));
}
