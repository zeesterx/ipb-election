import { describe, expect, it } from 'vitest';
import { createMinutesPdf } from './minutes-pdf';

describe('PDF do resultado para a ata', () => {
  it('gera um PDF válido com os dois grupos de oficiais', async () => {
    const pdf = await createMinutesPdf({
      churchName: 'Igreja Presbiteriana de Lavras',
      electionDate: new Date('2026-09-16T00:00:00.000Z'),
      presentMembers: 200,
      elders: [{ name: 'Presbítero eleito', roundNumber: 1, votes: 128 }],
      deacons: [{ name: 'Diácono eleito', roundNumber: 3, votes: 109 }]
    });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1_000);
  });
});
