import { describe, expect, it } from 'vitest';
import { isVietnameseText } from './language-detect';

describe('isVietnameseText', () => {
  it('văn bản tiếng Việt', () => {
    expect(isVietnameseText('Tổng Bí thư Tô Lâm thăm chính thức Vương quốc Bỉ, gặp Thủ tướng nước này')).toBe(true);
  });

  it('bài tiếng Anh / Pháp chỉ nhắc vài tên riêng có dấu thì không phải tiếng Việt', () => {
    expect(isVietnameseText("President Tô Lâm announcing Vietnam's priorities in the EU")).toBe(false);
    expect(isVietnameseText("Le président Tô Lâm à l'hôtel de ville, où il a été accueilli")).toBe(false);
    expect(isVietnameseText('Визит То Лама в Данию')).toBe(false);
    expect(isVietnameseText('')).toBe(false);
  });
});
