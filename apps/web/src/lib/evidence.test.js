import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadFileToCatbox = vi.fn();
const signWalletMessage = vi.fn();

vi.mock('./catbox.js', () => ({
  isCatboxUploadConfigured: () => true,
  uploadFileToCatbox
}));

vi.mock('./wallet.js', () => ({
  signWalletMessage
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
    uploadFileToCatbox.mockReset();
    signWalletMessage.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads to Catbox, stores evidence metadata, and returns the managed evidence summary', async () => {
    signWalletMessage.mockResolvedValue('0xsigned');
    uploadFileToCatbox.mockResolvedValue({
      name: 'proof.png',
      url: 'https://files.catbox.moe/proof.png'
    });
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ authenticated: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          message: 'Sign this message to verify your wallet for StakeWithFriends evidence uploads.'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          address: '0xabc'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          address: '0xabc'
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 201));
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
      url: 'https://files.catbox.moe/proof.png',
      contentHashSha256: 'deadbeef',
      mimeType: 'image/png',
      sizeBytes: 3
    });

    expect(signWalletMessage).toHaveBeenCalledWith(
      '0xabc',
      'Sign this message to verify your wallet for StakeWithFriends evidence uploads.'
    );
    expect(uploadFileToCatbox).toHaveBeenCalledWith(file);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/auth/session',
      expect.objectContaining({
        credentials: 'include'
      })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/auth/nonce',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          address: '0xabc'
        })
      })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      '/api/auth/verify',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          address: '0xabc',
          signature: '0xsigned'
        })
      })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      4,
      '/api/auth/session',
      expect.objectContaining({
        credentials: 'include'
      })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      5,
      '/api/evidence/metadata',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          pactId: 12,
          uri: 'https://files.catbox.moe/proof.png',
          contentHashSha256: 'deadbeef',
          mimeType: 'image/png',
          sizeBytes: 3,
          originalName: 'proof.png'
        })
      })
    );

    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        evidence: [{ id: 1, evidence_uri: 'https://files.catbox.moe/proof.png' }]
      })
    );

    await expect(readPactEvidenceHistory(12, '0xabc')).resolves.toEqual([
      { id: 1, evidence_uri: 'https://files.catbox.moe/proof.png' }
    ]);
  });
});
