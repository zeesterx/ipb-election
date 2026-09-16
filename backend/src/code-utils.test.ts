import { describe, expect, it } from 'vitest';
import { generateCode, normalizeCode } from './code-utils';

describe('voting codes', () => {
  it('normalizes lowercase input and removes punctuation', () => {
    expect(normalizeCode(' ab-c12 ')).toBe('ABC12');
  });

  it('generates six uppercase alphanumeric characters', () => {
    for (let index = 0; index < 100; index += 1) {
      expect(generateCode()).toMatch(/^[A-Z0-9]{6}$/);
    }
  });
});
