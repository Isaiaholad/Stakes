import { describe, expect, it } from 'vitest';
import { buildPactPath, formatPactPublicId, parsePactPublicId } from './pactIds.js';

describe('public pact ids', () => {
  it('formats pact ids into friendly URL codes while preserving old numeric links', () => {
    expect(formatPactPublicId(6)).toBe('swf-0006');
    expect(buildPactPath(6)).toBe('/pact/swf-0006');
    expect(parsePactPublicId('swf-0006')).toBe(6);
    expect(parsePactPublicId('6')).toBe(6);
  });

  it('rejects malformed pact codes', () => {
    expect(parsePactPublicId('')).toBe(0);
    expect(parsePactPublicId('not a pact')).toBe(0);
    expect(parsePactPublicId('swf-')).toBe(0);
  });
});
