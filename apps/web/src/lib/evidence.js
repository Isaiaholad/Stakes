import { buildQueryString, fetchJson } from './api.js';
import { ensureWalletSession } from './authSession.js';
import { uploadFileToCatbox } from './catbox.js';

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function computeFileSha256(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return toHex(digest);
}

export async function uploadManagedEvidence({ pactId, address, file }) {
  await ensureWalletSession(address, 'Connect your wallet before uploading dispute evidence.');
  const [contentHashSha256, uploadResult] = await Promise.all([
    computeFileSha256(file),
    uploadFileToCatbox(file)
  ]);

  await fetchJson('/evidence/metadata', {
    method: 'POST',
    body: JSON.stringify({
      pactId,
      uri: uploadResult.url,
      contentHashSha256,
      mimeType: file.type || '',
      sizeBytes: file.size || 0,
      originalName: file.name || uploadResult.name
    })
  });

  return {
    ...uploadResult,
    contentHashSha256,
    mimeType: file.type || '',
    sizeBytes: file.size || 0
  };
}

export async function readPactEvidenceHistory(pactId, address) {
  let payload;
  try {
    payload = await fetchJson(`/pacts/${pactId}/evidence${buildQueryString({ address })}`);
  } catch (error) {
    if (Number(error?.status || 0) === 403) {
      return [];
    }

    throw error;
  }

  return Array.isArray(payload.evidence) ? payload.evidence : [];
}
