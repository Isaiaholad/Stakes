import { buildQueryString, fetchJson } from './api.js';

export const maxEvidenceImageBytes = 1 * 1024 * 1024;
export const maxEvidenceVideoBytes = 10 * 1024 * 1024;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round((bytes / 1024) * 10) / 10} KB`;
  }

  return `${bytes} B`;
}

export function validateManagedEvidenceFile(file) {
  if (!file) {
    throw new Error('Choose a file before uploading.');
  }

  const mimeType = String(file.type || '').toLowerCase();
  if (mimeType.startsWith('image/')) {
    if (file.size > maxEvidenceImageBytes) {
      throw new Error(`Image evidence must be ${formatBytes(maxEvidenceImageBytes)} or smaller.`);
    }
    return 'image';
  }

  if (mimeType.startsWith('video/')) {
    if (file.size > maxEvidenceVideoBytes) {
      throw new Error(`Video evidence must be ${formatBytes(maxEvidenceVideoBytes)} or smaller.`);
    }
    return 'video';
  }

  throw new Error('Evidence must be an image or video file.');
}

export async function computeFileSha256(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return toHex(digest);
}

export async function uploadManagedEvidence({ pactId, address, file }) {
  const uploaderAddress = String(address || '').trim();
  if (!uploaderAddress) {
    throw new Error('Connect your wallet before uploading evidence.');
  }

  validateManagedEvidenceFile(file);

  const formData = new FormData();
  formData.append('pactId', String(pactId));
  formData.append('address', uploaderAddress);
  formData.append('file', file);

  const [originalContentHashSha256, payload] = await Promise.all([
    computeFileSha256(file),
    fetchJson('/evidence/upload', {
      method: 'POST',
      body: formData
    })
  ]);

  const uploadResult = payload.evidence || {};
  return {
    name: uploadResult.name || file.name || 'Evidence file',
    url: uploadResult.url,
    objectKey: uploadResult.objectKey || '',
    contentHashSha256: uploadResult.contentHashSha256 || '',
    originalContentHashSha256,
    mimeType: uploadResult.mimeType || file.type || '',
    sizeBytes: uploadResult.sizeBytes || file.size || 0,
    originalSizeBytes: uploadResult.originalSizeBytes || file.size || 0,
    source: uploadResult.source || 'supabase-storage',
    uploadWarning: uploadResult.uploadWarning || ''
  };
}

export async function storeEvidenceMetadata(metadata) {
  return await fetchJson('/evidence/metadata', {
    method: 'POST',
    body: JSON.stringify(metadata)
  });
}

export async function analyzePactEvidence({ pactId, address }) {
  const requesterAddress = String(address || '').trim();
  if (!requesterAddress) {
    throw new Error('Connect your wallet before asking AI to analyze the result screenshot.');
  }

  return await fetchJson(`/pacts/${pactId}/analyze-evidence`, {
    method: 'POST',
    body: JSON.stringify({
      address: requesterAddress
    })
  });
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
