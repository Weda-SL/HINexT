import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, sharePayload, shareUrl, SHARE_LIMIT } from '../src/state/share';
import { EXAMPLES } from '../src/examples';

describe('share links', () => {
  it('round-trips every example, splits and network included', async () => {
    for (const ex of EXAMPLES) {
      const p = ex.build();
      const payload = await encodeShare(p, 'test');
      expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
      const back = await decodeShare(payload);
      expect(back.streams).toEqual(p.streams);
      expect(back.network ?? null).toEqual(p.network ?? null);
      expect(back.settings).toEqual(p.settings);
    }
  });

  it('keeps typical projects well under the link length limit', async () => {
    const payload = await encodeShare(EXAMPLES.find((e) => e.key === 'smith-split-mer')!.build(), 'test');
    expect(payload.length).toBeLessThan(SHARE_LIMIT / 4);
  });

  it('builds and reads the fragment', () => {
    const url = shareUrl('abc', 'https://hinext.netlify.app/app/#old');
    expect(url).toBe('https://hinext.netlify.app/app/#p=abc');
    expect(sharePayload('#p=abc')).toBe('abc');
    expect(sharePayload('#other')).toBeNull();
  });

  it('reports a damaged link', async () => {
    await expect(decodeShare('not-a-real-payload')).rejects.toThrow(/damaged|valid JSON|HINexT/);
  });
});
