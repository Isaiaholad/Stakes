import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAccessToken = vi.fn();

vi.mock('@privy-io/react-auth', () => ({
  getAccessToken
}));

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

describe('managed evidence uploads', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    getAccessToken.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads through the managed backend endpoint and returns the evidence summary', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        evidence: {
          name: 'proof.png',
          url: 'https://rjhwefsorvhnflvwnkud.supabase.co/storage/v1/object/public/evidence/pacts/12/proof.webp',
          objectKey: 'pacts/12/0xabc/proof.webp',
          contentHashSha256: 'compressedbeef',
          mimeType: 'image/webp',
          sizeBytes: 2,
          originalSizeBytes: 3,
          source: 'supabase-storage'
        }
      }, 201)
    );
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer);

    const file = {
      name: 'proof.png',
      type: 'image/png',
      size: 3,
      async arrayBuffer() {
        return new Uint8Array([1, 2, 3]).buffer;
      }
    };
    const { readPactEvidenceHistory, uploadManagedEvidence } = await import('./evidence.js');

    await expect(
      uploadManagedEvidence({
        pactId: 12,
        address: '0xabc',
        file
      })
    ).resolves.toEqual({
      name: 'proof.png',
      url: 'https://rjhwefsorvhnflvwnkud.supabase.co/storage/v1/object/public/evidence/pacts/12/proof.webp',
      objectKey: 'pacts/12/0xabc/proof.webp',
      contentHashSha256: 'compressedbeef',
      originalContentHashSha256: 'deadbeef',
      mimeType: 'image/webp',
      sizeBytes: 2,
      originalSizeBytes: 3,
      source: 'supabase-storage',
      uploadWarning: ''
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/evidence/upload',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: expect.any(FormData)
      })
    );
    expect(global.fetch.mock.calls[0][1].body.get('address')).toBe('0xabc');

    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        evidence: [{ id: 1, evidence_uri: 'https://files.catbox.moe/proof.png' }]
      })
    );

    await expect(readPactEvidenceHistory(12, '0xabc')).resolves.toEqual([
      { id: 1, evidence_uri: 'https://files.catbox.moe/proof.png' }
    ]);
  });

  it('blocks oversized evidence before calling the upload API', async () => {
    const { uploadManagedEvidence } = await import('./evidence.js');
    const oversizedImage = {
      name: 'huge.png',
      type: 'image/png',
      size: 1024 * 1024 + 1,
      async arrayBuffer() {
        return new Uint8Array([1]).buffer;
      }
    };

    await expect(
      uploadManagedEvidence({
        pactId: 12,
        address: '0xabc',
        file: oversizedImage
      })
    ).rejects.toThrow('Image evidence must be 1 MB or smaller.');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects unsupported dispute evidence types', async () => {
    const { uploadManagedEvidence } = await import('./evidence.js');
    const pdfFile = {
      name: 'proof.pdf',
      type: 'application/pdf',
      size: 1000,
      async arrayBuffer() {
        return new Uint8Array([1]).buffer;
      }
    };

    await expect(
      uploadManagedEvidence({
        pactId: 12,
        address: '0xabc',
        file: pdfFile
      })
    ).rejects.toThrow('Evidence must be an image or video file.');

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
