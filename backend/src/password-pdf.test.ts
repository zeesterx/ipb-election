import { describe, expect, it } from 'vitest';
import { createPasswordPdf, PASSWORDS_PER_PAGE } from './password-pdf';

describe('PDF de senhas', () => {
  it('acomoda oitenta senhas por página', () => {
    expect(PASSWORDS_PER_PAGE).toBe(80);
  });

  it('gera um PDF válido com mais de uma página', async () => {
    const pdf = await createPasswordPdf({
      churchName: 'Igreja Presbiteriana de Lavras',
      electionDate: '2026-09-15',
      batchNumber: 1,
      voterUrl: 'https://example.com',
      codes: Array.from({ length: 81 }, (_, index) => `A${String(index).padStart(5, '0')}`)
    });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1_000);
  });
});
