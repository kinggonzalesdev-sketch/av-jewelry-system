import { describe, expect, it } from 'vitest';

import { generateTempPassword } from '@/lib/authz/temp-password';

describe('generateTempPassword', () => {
  it('meets a reasonable policy: length + each character class', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateTempPassword();
      expect(pw.length).toBeGreaterThanOrEqual(10);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[2-9]/);
      expect(pw).toMatch(/[!@#$%*?]/);
    }
  });

  it('avoids ambiguous glyphs (0 O 1 l I) so it can be read aloud', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTempPassword()).not.toMatch(/[0O1lI]/);
    }
  });

  it('is random — two passwords differ', () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});
