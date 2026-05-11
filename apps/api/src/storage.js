import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apiConfig } from './config.js';

const imageOutputMimeType = 'image/jpeg';
const imageOutputExtension = 'jpg';
const videoOutputMimeType = 'video/mp4';
let bucketBootstrapPromise = null;

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function sha256(value, encoding = 'hex') {
  return crypto.createHash('sha256').update(value).digest(encoding);
}

function toAmzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function encodePathSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sanitizeFilePart(value) {
  return String(value || 'file')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'file';
}

function getPublicStorageUrl(key) {
  const baseUrl =
    apiConfig.storagePublicBaseUrl ||
    'https://rjhwefsorvhnflvwnkud.supabase.co/storage/v1/object/public';
  return `${baseUrl.replace(/\/+$/, '')}/${apiConfig.storageBucket}/${key.split('/').map(encodePathSegment).join('/')}`;
}

function getStorageS3EndpointCandidates() {
  const endpoints = [apiConfig.storageS3Endpoint];

  if (apiConfig.supabaseUrl) {
    endpoints.push(`${apiConfig.supabaseUrl.replace(/\/+$/, '')}/storage/v1/s3`);
  }

  return [...new Set(endpoints.filter(Boolean).map((endpoint) => endpoint.replace(/\/+$/, '')))];
}

function assertStorageConfigured() {
  const missing = [];
  if (!apiConfig.storageS3Endpoint) missing.push('STORAGE_S3_ENDPOINT');
  if (!apiConfig.storageBucket) missing.push('STORAGE_BUCKET');
  if (!apiConfig.storageAccessKeyId) missing.push('STORAGE_ACCESS_KEY_ID');
  if (!apiConfig.storageSecretAccessKey) missing.push('STORAGE_SECRET_ACCESS_KEY');
  if (missing.length) {
    throw new Error(`Supabase S3 storage is not configured. Missing: ${missing.join(', ')}`);
  }
}

function assertSupportedEvidenceFile({ mimeType, sizeBytes }) {
  if (mimeType.startsWith('image/')) {
    if (sizeBytes > apiConfig.maxEvidenceImageBytes) {
      throw new Error('Image evidence must be 1 MB or smaller before upload.');
    }
    return 'image';
  }

  if (mimeType.startsWith('video/')) {
    if (sizeBytes > apiConfig.maxEvidenceVideoBytes) {
      throw new Error('Video evidence must be 10 MB or smaller before upload.');
    }
    return 'video';
  }

  throw new Error('Evidence upload must be an image or video file.');
}

function getOriginalImageExtension({ originalName, mimeType }) {
  const originalExtension = sanitizeFilePart(originalName).split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(originalExtension)) {
    return originalExtension === 'jpeg' ? 'jpg' : originalExtension;
  }

  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('webp')) return 'webp';
  return imageOutputExtension;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(apiConfig.ffmpegPath, args, (error, stdout, stderr) => {
      if (error) {
        const message = /ENOENT/i.test(String(error.code || ''))
          ? 'FFmpeg is not installed or FFMPEG_PATH is incorrect. Install FFmpeg on the API host before uploading evidence.'
          : stderr || stdout || error.message;
        reject(new Error(message));
        return;
      }
      resolve();
    });
  });
}

async function compressEvidenceFile({ buffer, originalName, mimeType, kind }) {
  const workDir = join(tmpdir(), `swf-evidence-${crypto.randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  const inputExt = sanitizeFilePart(originalName).split('.').pop() || (kind === 'image' ? 'png' : 'mp4');
  const inputPath = join(workDir, `input.${inputExt}`);
  const outputPath = join(workDir, kind === 'image' ? `output.${imageOutputExtension}` : 'output.mp4');

  try {
    await writeFile(inputPath, buffer);

    if (kind === 'image') {
      await runFfmpeg([
        '-y',
        '-i',
        inputPath,
        '-vf',
        'scale=w=min(1600\\,iw):h=-2',
        '-frames:v',
        '1',
        '-update',
        '1',
        '-c:v',
        'mjpeg',
        '-q:v',
        '5',
        outputPath
      ]);
    } else {
      await runFfmpeg([
        '-y',
        '-i',
        inputPath,
        '-vf',
        'scale=w=-2:h=min(720\\,ih)',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '28',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        outputPath
      ]);
    }

    const compressedBuffer = await readFile(outputPath);
    return {
      buffer: compressedBuffer,
      mimeType: kind === 'image' ? imageOutputMimeType : videoOutputMimeType,
      extension: kind === 'image' ? imageOutputExtension : 'mp4'
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function buildS3Authorization({ method, url, contentType, payloadHash, amzDate, dateStamp }) {
  const endpoint = new URL(url);
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${endpoint.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`
  ].join('\n');
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    endpoint.pathname,
    endpoint.search.slice(1),
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/${apiConfig.storageRegion}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n');
  const dateKey = hmac(`AWS4${apiConfig.storageSecretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, apiConfig.storageRegion);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = hmac(signingKey, stringToSign, 'hex');

  return `AWS4-HMAC-SHA256 Credential=${apiConfig.storageAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function putObjectToSupabaseS3({ key, buffer, mimeType }) {
  assertStorageConfigured();
  const encodedKey = key.split('/').map(encodePathSegment).join('/');
  const errors = [];

  for (const endpoint of getStorageS3EndpointCandidates()) {
    const url = `${endpoint}/${apiConfig.storageBucket}/${encodedKey}`;

    try {
      await putObjectToSupabaseS3Url({ url, buffer, mimeType });
      return;
    } catch (error) {
      errors.push(`${endpoint}: ${error?.message || error}`);
      if (!/ENOTFOUND|getaddrinfo|fetch failed/i.test(String(error?.message || ''))) {
        throw error;
      }
    }
  }

  throw new Error(`Supabase S3 upload failed because no storage endpoint was reachable. ${errors.join(' | ')}`);
}

async function putObjectToSupabaseS3Url({ url, buffer, mimeType }) {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(buffer);
  const authorization = buildS3Authorization({
    method: 'PUT',
    url,
    contentType: mimeType,
    payloadHash,
    amzDate,
    dateStamp
  });

  const putObject = () =>
    fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': mimeType,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate
      },
      body: buffer
    });

  let response;
  try {
    response = await putObject();
  } catch (error) {
    const cause = error?.cause;
    const causeMessage = cause ? `${cause.code || cause.name || 'network'} ${cause.message || ''}`.trim() : '';
    throw new Error([error?.message || 'fetch failed', causeMessage].filter(Boolean).join(': '));
  }

  if (response.ok) {
    return;
  }

  const detail = await response.text().catch(() => '');
  if (response.status === 404 && /NoSuchBucket|Bucket not found/i.test(detail)) {
    await ensureSupabaseStorageBucket();
    response = await putObject();
    if (response.ok) {
      return;
    }
    const retryDetail = await response.text().catch(() => '');
    throw new Error(`Supabase S3 upload failed with ${response.status}. ${retryDetail}`.trim());
  }

  throw new Error(`Supabase S3 upload failed with ${response.status}. ${detail}`.trim());
}

async function ensureSupabaseStorageBucket() {
  if (!apiConfig.storageAutoCreateBucket) {
    throw new Error(
      `Supabase storage bucket "${apiConfig.storageBucket}" does not exist. Create it or enable STORAGE_AUTO_CREATE_BUCKET.`
    );
  }

  if (!apiConfig.supabaseUrl || !apiConfig.supabaseServiceRoleKey) {
    throw new Error(
      `Supabase storage bucket "${apiConfig.storageBucket}" does not exist. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the API environment or create the bucket manually.`
    );
  }

  if (!bucketBootstrapPromise) {
    bucketBootstrapPromise = createSupabaseStorageBucket().catch((error) => {
      bucketBootstrapPromise = null;
      throw error;
    });
  }

  return bucketBootstrapPromise;
}

async function createSupabaseStorageBucket() {
  const baseUrl = apiConfig.supabaseUrl.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiConfig.supabaseServiceRoleKey}`,
      apikey: apiConfig.supabaseServiceRoleKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: apiConfig.storageBucket,
      name: apiConfig.storageBucket,
      public: true,
      file_size_limit: apiConfig.maxEvidenceVideoBytes,
      allowed_mime_types: [imageOutputMimeType, videoOutputMimeType]
    })
  });

  if (response.ok || response.status === 409) {
    return;
  }

  const detail = await response.text().catch(() => '');
  if (response.status === 400 && /already exists|Duplicate/i.test(detail)) {
    return;
  }

  throw new Error(`Supabase storage bucket creation failed with ${response.status}. ${detail}`.trim());
}

export async function processAndUploadEvidenceFile({ pactId, uploaderAddress, file }) {
  const originalName = file.filename || 'evidence';
  const mimeType = String(file.contentType || '').toLowerCase();
  const originalBuffer = file.data;
  const kind = assertSupportedEvidenceFile({
    mimeType,
    sizeBytes: originalBuffer.length
  });
  const processed =
    kind === 'image'
      ? {
          buffer: originalBuffer,
          mimeType,
          extension: getOriginalImageExtension({ originalName, mimeType })
        }
      : await compressEvidenceFile({
          buffer: originalBuffer,
          originalName,
          mimeType,
          kind
        });
  const contentHashSha256 = sha256(processed.buffer);
  const objectKey = [
    'pacts',
    String(pactId),
    sanitizeFilePart(uploaderAddress),
    `${Date.now()}-${contentHashSha256.slice(0, 16)}.${processed.extension}`
  ].join('/');

  await putObjectToSupabaseS3({
    key: objectKey,
    buffer: processed.buffer,
    mimeType: processed.mimeType
  });

  return {
    name: originalName,
    url: getPublicStorageUrl(objectKey),
    objectKey,
    source: 'supabase-storage',
    contentHashSha256,
    mimeType: processed.mimeType,
    sizeBytes: processed.buffer.length,
    originalSizeBytes: originalBuffer.length
  };
}
