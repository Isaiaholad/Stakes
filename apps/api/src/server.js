import crypto from 'node:crypto';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { URL } from 'node:url';
import { clearSessionCookie, createNonceChallenge, createSessionCookie, destroySession, getSessionFromRequest, verifySignatureAndCreateSession } from './auth.js';
import { getChainTimeSnapshot, readPactAccessFromChain, readProtocolSnapshot, readUsernameByAddressFromChain, readVaultSnapshot, resolveUsernameFromChain, zeroAddress } from './chain.js';
import { apiConfig, hasCoreContractsConfigured, hasUsernameRegistryConfigured, isAddressConfigured } from './config.js';
import { all, ensureSyncState, get, getDatabase, nowIso, run } from './db.js';
import { startIndexerLoop } from './indexer.js';
import { startKeeperLoop } from './keeper.js';
import { addressByUsername, addressIsParticipant, getPactAccessRecord, getPactById, listAdminQueuePacts, listOpenPacts, listPactEvidence, listPactMessages, listRecentPacts, usernameByAddress } from './pacts.js';
import { consumeRateLimit, getRequestIp } from './rateLimit.js';
import { processAndUploadEvidenceFile } from './storage.js';
import { Ollama } from 'ollama';

function normalizeAddress(value) {
  return String(value || '').toLowerCase();
}

function isPactParticipant(address, pact) {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress || !pact) {
    return false;
  }

  return (
    normalizedAddress === normalizeAddress(pact.creator_address) ||
    normalizedAddress === normalizeAddress(pact.counterparty_address)
  );
}

async function resolvePactAccessRecord(pactId) {
  const indexedRecord = await getPactAccessRecord(Number(pactId));
  const chainRecord = await readPactAccessFromChain(Number(pactId)).catch(() => null);
  return chainRecord || indexedRecord;
}

function readRawBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Upload body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parseMultipartDisposition(value = '') {
  return String(value)
    .split(';')
    .map((entry) => entry.trim())
    .reduce((accumulator, entry) => {
      const [rawKey, rawValue] = entry.split('=');
      if (!rawValue) {
        return accumulator;
      }
      accumulator[rawKey.toLowerCase()] = rawValue.replace(/^"|"$/g, '');
      return accumulator;
    }, {});
}

function parseMultipartFormData(request, buffer) {
  const contentType = String(request.headers['content-type'] || '');
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    throw new Error('Upload request must use multipart/form-data.');
  }

  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const fields = {};
  const files = [];
  let cursor = buffer.indexOf(boundary);

  while (cursor !== -1) {
    cursor += boundary.length;
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) {
      break;
    }
    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) {
      cursor += 2;
    }

    const headerEnd = buffer.indexOf('\r\n\r\n', cursor, 'utf8');
    if (headerEnd === -1) {
      break;
    }

    const headerText = buffer.slice(cursor, headerEnd).toString('utf8');
    const headers = headerText.split('\r\n').reduce((accumulator, line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) {
        return accumulator;
      }
      accumulator[line.slice(0, separatorIndex).trim().toLowerCase()] = line.slice(separatorIndex + 1).trim();
      return accumulator;
    }, {});
    const nextBoundary = buffer.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) {
      break;
    }

    const contentEnd = buffer[nextBoundary - 2] === 13 && buffer[nextBoundary - 1] === 10
      ? nextBoundary - 2
      : nextBoundary;
    const content = buffer.slice(headerEnd + 4, contentEnd);
    const disposition = parseMultipartDisposition(headers['content-disposition']);
    const name = disposition.name || '';

    if (disposition.filename) {
      files.push({
        fieldName: name,
        filename: disposition.filename,
        contentType: headers['content-type'] || 'application/octet-stream',
        data: content
      });
    } else if (name) {
      fields[name] = content.toString('utf8');
    }

    cursor = nextBoundary;
  }

  return { fields, files };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > apiConfig.maxJsonBodyBytes) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });

    request.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });

    request.on('error', reject);
  });
}

function getCorsHeaders(request) {
  const origin = request.headers.origin || '';
  const allowedOrigin = apiConfig.allowedOrigin === '*' ? (origin || '*') : apiConfig.allowedOrigin;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function writeJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function writeRateLimited(response, message, resetAt) {
  const retryAfterSeconds = Math.max(Math.ceil((Number(resetAt) - Date.now()) / 1000), 1);
  writeJson(
    response,
    429,
    {
      error: message
    },
    {
      'Retry-After': String(retryAfterSeconds)
    }
  );
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function isDataImageUri(value) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(value || ''));
}

function isImageEvidenceRecord(record) {
  const uri = String(record?.evidence_uri || '');
  const mimeType = String(record?.mime_type || '');
  return (
    mimeType.toLowerCase().startsWith('image/') ||
    isDataImageUri(uri) ||
    /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(uri)
  );
}

function dataUrlFromBuffer(buffer, mimeType = 'image/png') {
  return `data:${mimeType || 'image/png'};base64,${buffer.toString('base64')}`;
}

function imageBufferFromDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) {
    throw new Error('Evidence image data is not valid.');
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64')
  };
}

async function loadEvidenceImageAsDataUrl(evidenceRecord) {
  const uri = String(evidenceRecord?.evidence_uri || '').trim();
  if (isDataImageUri(uri)) {
    return uri;
  }

  if (!/^https?:\/\//i.test(uri)) {
    throw new Error('Evidence image is not a fetchable URL.');
  }

  const imageResponse = await fetch(uri);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch evidence image: ${imageResponse.status} ${imageResponse.statusText}`);
  }

  const mimeType = imageResponse.headers.get('content-type') || evidenceRecord?.mime_type || 'image/png';
  const arrayBuffer = await imageResponse.arrayBuffer();
  return dataUrlFromBuffer(Buffer.from(arrayBuffer), mimeType);
}

function normalizePlayerName(value) {
  return String(value || '').trim().replace(/^@+/, '').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
}

function levenshteinDistance(left, right) {
  const leftValue = String(left || '');
  const rightValue = String(right || '');
  if (leftValue === rightValue) {
    return 0;
  }
  if (!leftValue.length) {
    return rightValue.length;
  }
  if (!rightValue.length) {
    return leftValue.length;
  }

  const previous = Array.from({ length: rightValue.length + 1 }, (_, index) => index);
  const current = Array.from({ length: rightValue.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= leftValue.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= rightValue.length; rightIndex += 1) {
      const substitutionCost = leftValue[leftIndex - 1] === rightValue[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[rightValue.length];
}

function namesAreFuzzyMatch(left, right) {
  if (!left || !right || left.length < 5 || right.length < 5) {
    return false;
  }

  return levenshteinDistance(left, right) <= 2;
}

function namesMatch(left, right) {
  const leftCandidates = getNameCandidates(left);
  const rightCandidates = getNameCandidates(right);

  return leftCandidates.some((normalizedLeft) =>
    rightCandidates.some((normalizedRight) =>
      Boolean(
        normalizedLeft &&
          normalizedRight &&
          (normalizedLeft === normalizedRight ||
            normalizedLeft.includes(normalizedRight) ||
            normalizedRight.includes(normalizedLeft) ||
            namesAreFuzzyMatch(normalizedLeft, normalizedRight))
      )
    )
  );
}

function getNameCandidates(value) {
  const values = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      values
        .map(normalizePlayerName)
        .filter(Boolean)
        .flatMap((normalized) => {
          const candidates = [normalized];
          if (/^[il1][a-z0-9]{4,}$/.test(normalized)) {
            candidates.push(normalized.slice(1));
          }
          return candidates;
        })
    )
  ];
}

function parseScoreLine(value) {
  const match = String(value || '').match(/(\d{1,2})\D+(\d{1,2})/);
  if (!match) {
    return null;
  }

  return {
    leftScore: Number(match[1]),
    rightScore: Number(match[2])
  };
}

function normalizeOcrScoreToken(value) {
  const normalized = String(value || '')
    .replace(/[oO]/g, '0')
    .replace(/[iIl|]/g, '1')
    .replace(/[^0-9]/g, '');
  if (!normalized) {
    return Number.NaN;
  }

  return Number(normalized.replace(/^0+/, '') || '0');
}

function cleanOcrPlayerName(value) {
  return String(value || '')
    .replace(/^\s*[iIl|1]\s+/, '')
    .replace(/^[^a-zA-Z0-9@]+|[^a-zA-Z0-9@._/\-\s]+$/g, '')
    .trim();
}

function parseRawEfootballScore(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const patterns = [
    /^(.+?)\s+([0-9oO]{1,2})\s*[-=–]\s*([0-9oO]{1,2})\s+(.+)$/i,
    /^(.+?)\s+([0-9oO]{1,2})\W+(?:[iIl1|]\s*)?(?:[sS]{1,2}\s*)?(?:[iIl1|]\s*)?([0-9oO]{1,2})\W+(.+)$/i
  ];

  for (const line of lines) {
    if (/%|possession|shots|passes|fouls|corners|tackles|saves/i.test(line)) {
      continue;
    }

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) {
        continue;
      }

      const leftName = cleanOcrPlayerName(match[1]);
      const rightName = cleanOcrPlayerName(match[4]);
      const leftScore = normalizeOcrScoreToken(match[2]);
      const rightScore = normalizeOcrScoreToken(match[3]);
      if (
        leftName &&
        rightName &&
        /[a-zA-Z]/.test(leftName) &&
        /[a-zA-Z]/.test(rightName) &&
        Number.isFinite(leftScore) &&
        Number.isFinite(rightScore)
      ) {
        return {
          leftName,
          rightName,
          leftScore,
          rightScore,
          scoreLine: `${leftScore} – ${rightScore}`
        };
      }
    }
  }

  return null;
}

function extractOpenAiOutputText(payload) {
  if (typeof payload?.output_text === 'string') {
    return payload.output_text;
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string') {
        return part.text;
      }
    }
  }

  return '';
}

function parseAiResultText(text) {
  const trimmedText = String(text || '').trim();
  if (!trimmedText) {
    throw new Error('AI analysis returned an empty response.');
  }

  try {
    return JSON.parse(trimmedText);
  } catch {
    const jsonMatch = trimmedText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('AI analysis did not return valid JSON.');
  }
}

function mapWinnerSideToAddress(winnerSide, pact) {
  const normalizedSide = String(winnerSide || '').trim().toLowerCase();
  if (normalizedSide === 'creator') {
    return pact.creator_address;
  }
  if (normalizedSide === 'counterparty') {
    return pact.counterparty_address;
  }
  return zeroAddress;
}

function inferWinnerSideFromAnalysis(analysis, { creatorUsername, counterpartyUsername } = {}) {
  const explicitSide = String(analysis?.winnerSide || analysis?.winner_side || '').trim().toLowerCase();
  if (['creator', 'counterparty', 'unknown'].includes(explicitSide)) {
    return explicitSide;
  }

  const winnerName = analysis?.winnerUsername || analysis?.winner_username || analysis?.winner || '';
  if (namesMatch(winnerName, creatorUsername)) {
    return 'creator';
  }
  if (namesMatch(winnerName, counterpartyUsername)) {
    return 'counterparty';
  }

  const parsedRawScore = parseRawEfootballScore(analysis?.raw_text || analysis?.rawText || '');
  const leftName = analysis?.home_username || analysis?.team1 || analysis?.left_username || analysis?.player1 || parsedRawScore?.leftName || '';
  const rightName = analysis?.away_username || analysis?.team2 || analysis?.right_username || analysis?.player2 || parsedRawScore?.rightName || '';
  const parsedScoreLine = parseScoreLine(analysis?.score_line || analysis?.scoreLine || analysis?.score) || parsedRawScore;
  const leftScore = Number(
    analysis?.home_score ??
      analysis?.homeScore ??
      analysis?.score1 ??
      analysis?.left_score ??
      analysis?.leftScore ??
      parsedRawScore?.leftScore ??
      parsedScoreLine?.leftScore
  );
  const rightScore = Number(
    analysis?.away_score ??
      analysis?.awayScore ??
      analysis?.score2 ??
      analysis?.right_score ??
      analysis?.rightScore ??
      parsedRawScore?.rightScore ??
      parsedScoreLine?.rightScore
  );

  if (Number.isFinite(leftScore) && Number.isFinite(rightScore) && leftScore !== rightScore) {
    const leftSide = namesMatch(leftName, creatorUsername)
      ? 'creator'
      : namesMatch(leftName, counterpartyUsername)
        ? 'counterparty'
        : '';
    const rightSide = namesMatch(rightName, creatorUsername)
      ? 'creator'
      : namesMatch(rightName, counterpartyUsername)
        ? 'counterparty'
        : '';
    if (leftScore > rightScore) {
      return leftSide || (rightSide === 'creator' ? 'counterparty' : rightSide === 'counterparty' ? 'creator' : 'unknown');
    }
    return rightSide || (leftSide === 'creator' ? 'counterparty' : leftSide === 'counterparty' ? 'creator' : 'unknown');
  }

  return 'unknown';
}

function normalizeAnalysisResult(rawResult, { pact, creatorUsername, counterpartyUsername, source }) {
  const parsedRawScore = parseRawEfootballScore(rawResult?.raw_text || rawResult?.rawText || '');
  const normalizedResult = {
    ...rawResult,
    home_username: rawResult?.home_username || parsedRawScore?.leftName || '',
    away_username: rawResult?.away_username || parsedRawScore?.rightName || '',
    score_line: parseScoreLine(rawResult?.score_line || rawResult?.scoreLine || rawResult?.score)
      ? rawResult?.score_line || rawResult?.scoreLine || rawResult?.score
      : parsedRawScore?.scoreLine || rawResult?.score_line || rawResult?.scoreLine || ''
  };
  const winnerSide = inferWinnerSideFromAnalysis(rawResult, { creatorUsername, counterpartyUsername });
  const winnerAddress = mapWinnerSideToAddress(winnerSide, pact);
  const rawConfidence = Number(rawResult?.confidence);
  const confidence = Number.isFinite(rawConfidence) && rawConfidence > 0
    ? rawConfidence
    : winnerAddress === zeroAddress
      ? 0
      : 0.75;

  return {
    ...normalizedResult,
    source,
    winnerSide,
    winnerAddress,
    confidence
  };
}

function extractEfootballAliasesFromText(text) {
  const aliases = {};
  const patterns = [
    ['creatorUsername', /creator(?:'s)?\s+in-game\s+username\s*:\s*([^\n\r]+)/i],
    ['counterpartyUsername', /counterparty(?:'s)?\s+in-game\s+username\s*:\s*([^\n\r]+)/i]
  ];

  for (const [key, pattern] of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) {
      aliases[key] = match[1].trim();
    }
  }

  return aliases;
}

async function getEfootballUsernameAliases(pact) {
  const creatorAliases = [await usernameByAddress(pact.creator_address)];
  const counterpartyAliases = [await usernameByAddress(pact.counterparty_address)];
  const sources = [pact.description || ''];
  const messages = await listPactMessages(Number(pact.pact_id), apiConfig.maxMessagesPerPact).catch(() => []);
  sources.push(...messages.map((message) => message.body || ''));

  for (const source of sources) {
    const aliases = extractEfootballAliasesFromText(source);
    if (aliases.creatorUsername) {
      creatorAliases.push(aliases.creatorUsername);
    }
    if (aliases.counterpartyUsername) {
      counterpartyAliases.push(aliases.counterpartyUsername);
    }
  }

  return {
    creatorUsername: [...new Set(creatorAliases.filter(Boolean))],
    counterpartyUsername: [...new Set(counterpartyAliases.filter(Boolean))]
  };
}

async function runEfootballOcrAnalysis({ evidenceRecord, pact, creatorUsername, counterpartyUsername }) {
  const imageDataUrl = await loadEvidenceImageAsDataUrl(evidenceRecord);
  const { mimeType, buffer } = imageBufferFromDataUrl(imageDataUrl);
  const extension = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
  const tempPath = join(tmpdir(), `swf_efootball_${pact.pact_id || 'pact'}_${Date.now()}.${extension}`);
  await writeFile(tempPath, buffer);

  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile(apiConfig.pythonPath, [join(apiConfig.apiRoot, 'src', 'analyze_efootball.py'), tempPath], {
        timeout: 20_000,
        maxBuffer: 1024 * 1024
      }, (error, output, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message || 'eFootball OCR failed.').trim()));
          return;
        }
        resolve(output);
      });
    });
    const parsed = JSON.parse(String(stdout || '{}'));
    if (parsed.error) {
      throw new Error(parsed.error);
    }

    return normalizeAnalysisResult(parsed, {
      pact,
      creatorUsername,
      counterpartyUsername,
      source: 'efootball-ocr'
    });
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

async function runOllamaEfootballAnalysis({ evidenceRecord, pact, creatorUsername, counterpartyUsername }) {
  const imageDataUrl = await loadEvidenceImageAsDataUrl(evidenceRecord);
  const { buffer } = imageBufferFromDataUrl(imageDataUrl);
  const ollamaClient = new Ollama({ host: apiConfig.ollamaBaseUrl });
  const response = await ollamaClient.chat({
    model: apiConfig.ollamaVisionModel,
    messages: [
      {
        role: 'user',
        content: [
          'Analyze this eFootball final result screenshot.',
          'Return ONLY compact JSON with winnerSide, winnerUsername, creatorScore, counterpartyScore, confidence, and explanation.',
          'winnerSide must be "creator", "counterparty", or "unknown".',
          `Creator username: ${creatorUsername || 'unknown'} wallet: ${pact.creator_address}`,
          `Counterparty username: ${counterpartyUsername || 'unknown'} wallet: ${pact.counterparty_address}`
        ].join('\n'),
        images: [buffer.toString('base64')]
      }
    ]
  });

  const parsed = parseAiResultText(response?.message?.content || '');
  return normalizeAnalysisResult(parsed, {
    pact,
    creatorUsername,
    counterpartyUsername,
    source: 'ollama'
  });
}

async function analyzeEfootballScreenshot({ pact, evidenceRecord, creatorUsername, counterpartyUsername }) {
  const attempts = [];

  try {
    const ocrResult = await runEfootballOcrAnalysis({
      evidenceRecord,
      pact,
      creatorUsername,
      counterpartyUsername
    });
    attempts.push({
      source: ocrResult.source,
      winnerSide: ocrResult.winnerSide,
      winnerAddress: ocrResult.winnerAddress,
      confidence: ocrResult.confidence,
      winnerUsername: ocrResult.winnerUsername || ocrResult.winner || '',
      scoreLine: ocrResult.score_line || ocrResult.scoreLine || ''
    });
    if (ocrResult.winnerAddress !== zeroAddress && ocrResult.confidence >= apiConfig.efootballOcrConfidenceThreshold) {
      return {
        ...ocrResult,
        attempts
      };
    }
  } catch (error) {
    attempts.push({
      source: 'efootball-ocr',
      error: error?.message || 'eFootball OCR failed.'
    });
  }

  if (apiConfig.aiAnalysisProvider === 'ollama' || apiConfig.aiAnalysisProvider === 'auto') {
    try {
      const ollamaResult = await runOllamaEfootballAnalysis({
        evidenceRecord,
        pact,
        creatorUsername,
        counterpartyUsername
      });
      attempts.push({
        source: ollamaResult.source,
        winnerSide: ollamaResult.winnerSide,
        confidence: ollamaResult.confidence
      });
      return {
        ...ollamaResult,
        attempts
      };
    } catch (error) {
      attempts.push({
        source: 'ollama',
        error: error?.message || 'Ollama analysis failed.'
      });
      if (apiConfig.aiAnalysisProvider !== 'auto') {
        console.error('eFootball analysis attempts failed', {
          pactId: pact.pact_id,
          creatorUsername,
          counterpartyUsername,
          attempts
        });
        throw new Error(`OCR could not detect a winner and Ollama fallback failed. ${error?.message || ''}`.trim());
      }
    }
  }

  if (apiConfig.aiAnalysisProvider !== 'openai' && apiConfig.aiAnalysisProvider !== 'auto') {
    throw new Error('OCR could not confidently detect a winner and no AI fallback is configured.');
  }

  if (!apiConfig.openaiApiKey) {
    throw new Error('AI evidence analysis is not configured. Set OPENAI_API_KEY on the API service.');
  }

  const imageDataUrl = await loadEvidenceImageAsDataUrl(evidenceRecord);
  const prompt = [
    'You are reviewing an eFootball match result screenshot for a funded two-player pact.',
    'Read the visible final score, player names, and winner. Match the winner to exactly one side.',
    'Only choose "creator" or "counterparty" when the screenshot clearly shows that side won.',
    'If the image is not a final eFootball result screen, the score is tied, or the winner cannot be matched, return "unknown".',
    '',
    `Creator wallet: ${pact.creator_address}`,
    `Creator in-game username: ${creatorUsername || 'unknown'}`,
    `Counterparty wallet: ${pact.counterparty_address}`,
    `Counterparty in-game username: ${counterpartyUsername || 'unknown'}`
  ].join('\n');

  const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiConfig.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: apiConfig.openaiVisionModel,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: prompt
            },
            {
              type: 'input_image',
              image_url: imageDataUrl
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'efootball_result',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              winnerSide: {
                type: 'string',
                enum: ['creator', 'counterparty', 'unknown']
              },
              winnerUsername: {
                type: 'string'
              },
              creatorScore: {
                type: 'integer',
                minimum: 0
              },
              counterpartyScore: {
                type: 'integer',
                minimum: 0
              },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1
              },
              explanation: {
                type: 'string'
              }
            },
            required: ['winnerSide', 'winnerUsername', 'creatorScore', 'counterpartyScore', 'confidence', 'explanation']
          }
        }
      }
    })
  });

  const payload = await openAiResponse.json().catch(() => ({}));
  if (!openAiResponse.ok) {
    const message = payload?.error?.message || `OpenAI analysis failed with status ${openAiResponse.status}.`;
    throw new Error(message);
  }

  const aiResult = parseAiResultText(extractOpenAiOutputText(payload));
  const winnerAddress = mapWinnerSideToAddress(aiResult.winnerSide, pact);
  if (winnerAddress === zeroAddress || Number(aiResult.confidence || 0) < 0.6) {
    return {
      ...aiResult,
      winnerAddress: zeroAddress,
      source: 'openai',
      attempts
    };
  }

  return {
    ...aiResult,
    winnerAddress,
    source: 'openai',
    attempts
  };
}

async function requireSession(request, response, message) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    writeJson(response, 401, {
      error: message
    });
    return null;
  }

  if (!session.address) {
    await destroySession(session.session_id);
    writeJson(
      response,
      401,
      {
        error: message
      },
      {
        'Set-Cookie': clearSessionCookie()
      }
    );
    return null;
  }

  return session;
}

function checkRateLimit(request, response, { scope, limit, windowMs, message }) {
  const decision = consumeRateLimit({
    scope,
    identifier: getRequestIp(request),
    limit,
    windowMs
  });

  if (decision.allowed) {
    return false;
  }

  writeRateLimited(response, message, decision.resetAt);
  return true;
}

function parseLimit(url, fallback) {
  const parsedLimit = Number.parseInt(url.searchParams.get('limit') || '', 10);
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return fallback;
  }

  return parsedLimit;
}

function computeSyncLagBlocks(latestBlockNumber, row) {
  return Math.max(latestBlockNumber - Number(row.last_block_number || 0), 0);
}

function formatSyncStatusRow(row, latestBlockNumber, required) {
  return {
    key: row.sync_key,
    required,
    startBlock: Number(row.start_block || 0),
    lastBlockNumber: Number(row.last_block_number || 0),
    lagBlocks: computeSyncLagBlocks(latestBlockNumber, row),
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error
  };
}

async function respondWithHealth(response) {
  let databaseOk = false;
  try {
    await getDatabase();
    databaseOk = true;
  } catch {
    databaseOk = false;
  }

  const contractsConfigured = hasCoreContractsConfigured();
  const storageOk =
    apiConfig.storageMode === 'supabase-s3'
      ? Boolean(
          apiConfig.storageS3Endpoint &&
          apiConfig.storageBucket &&
          apiConfig.storageRegion &&
          apiConfig.storageAccessKeyId &&
          apiConfig.storageSecretAccessKey
        )
      : Boolean(apiConfig.storageMode);
  const chainTime = contractsConfigured ? await getChainTimeSnapshot() : null;
  const syncRows = await all(`SELECT * FROM sync_state ORDER BY sync_key ASC`);
  const indexedPactsCount = databaseOk ? Number((await get(`SELECT COUNT(*) AS count FROM pacts`))?.count || 0) : 0;
  const latestBlockNumber = chainTime?.blockNumber || 0;
  const requiredSyncRows = syncRows.filter((row) => row.sync_key === 'core');
  const auxiliarySyncRows = syncRows.filter(
    (row) => row.sync_key !== 'core' && (row.sync_key !== 'usernames' || hasUsernameRegistryConfigured())
  );
  const syncLagBlocks = requiredSyncRows.length
    ? Math.max(...requiredSyncRows.map((row) => computeSyncLagBlocks(latestBlockNumber, row)))
    : latestBlockNumber;
  const indexerOk =
    contractsConfigured &&
    requiredSyncRows.length > 0 &&
    requiredSyncRows.every((row) => row.status !== 'error') &&
    syncLagBlocks <= apiConfig.healthSyncLagBlocks;
  const readModelAvailable =
    contractsConfigured &&
    databaseOk &&
    requiredSyncRows.length > 0 &&
    requiredSyncRows.every((row) => row.status !== 'error') &&
    (indexedPactsCount > 0 ||
      requiredSyncRows.some((row) => Number(row.last_block_number || 0) >= Number(row.start_block || 0)));

  writeJson(response, 200, {
    ready: Boolean(contractsConfigured && databaseOk && indexerOk && storageOk),
    contractsConfigured,
    databaseOk,
    indexerOk,
    readModelAvailable,
    indexedPactsCount,
    storageOk,
    storageMode: apiConfig.storageMode,
    syncLagBlocks,
    sync: [
      ...requiredSyncRows.map((row) => formatSyncStatusRow(row, latestBlockNumber, true)),
      ...auxiliarySyncRows.map((row) => formatSyncStatusRow(row, latestBlockNumber, false))
    ],
    chainTime
  });
}

async function handleDashboard(url, response) {
  const address = normalizeAddress(url.searchParams.get('address') || '');
  const limit = parseLimit(url, 12);
  const protocol = await withTimeout(readProtocolSnapshot(address), 5_500, 'Protocol read');
  const pacts = await withTimeout(listRecentPacts(limit, protocol, address), 5_500, 'Dashboard read');

  writeJson(response, 200, {
    pacts
  });
}

async function handleOpenPacts(url, response) {
  const address = normalizeAddress(url.searchParams.get('address') || '');
  const limit = parseLimit(url, 18);
  const protocol = await withTimeout(readProtocolSnapshot(address), 5_500, 'Protocol read');
  const pacts = await withTimeout(listOpenPacts(limit, protocol, address), 5_500, 'Open pact read');

  writeJson(response, 200, {
    pacts
  });
}

async function handlePactDetail(url, response, pactId) {
  const address = normalizeAddress(url.searchParams.get('address') || '');
  let protocol;
  let pact;

  try {
    protocol = await withTimeout(readProtocolSnapshot(address), 5_500, 'Protocol read');
    pact = await withTimeout(getPactById(Number(pactId), protocol, address), 5_500, 'Pact detail read');
  } catch (error) {
    writeJson(response, 503, {
      error: error?.message || 'Pact detail reads are temporarily unavailable.'
    });
    return;
  }

  if (!pact) {
    writeJson(response, 404, {
      error: 'Pact not found.'
    });
    return;
  }

  if (
    !pact.isOpen &&
    pact.participantRole === 'viewer' &&
    !protocol.isAdmin &&
    !protocol.isArbiter
  ) {
    writeJson(response, 403, {
      error: 'This pact is only visible to its joined participants and arbiters.'
    });
    return;
  }

  writeJson(response, 200, {
    pact
  });
}

async function handleAdminQueue(request, url, response) {
  const session = await requireSession(request, response, 'Sign in with Privy before reading the indexed admin queue.');
  if (!session) {
    return;
  }

  const address = normalizeAddress(session.address || '');
  const protocol = await readProtocolSnapshot(address);
  if (!protocol.isAdmin && !protocol.isArbiter) {
    writeJson(response, 403, {
      error: 'Admin or arbiter access is required.'
    });
    return;
  }

  const limit = parseLimit(url, 50);
  const pacts = await listAdminQueuePacts(limit, protocol, address);
  writeJson(response, 200, {
    protocol,
    pacts
  });
}

async function handleUsernameResolve(url, response) {
  const username = String(url.searchParams.get('username') || '').trim().toLowerCase();
  if (!username) {
    writeJson(response, 200, { address: zeroAddress });
    return;
  }

  let address = await addressByUsername(username);
  if (address === zeroAddress && hasUsernameRegistryConfigured()) {
    address = normalizeAddress(await resolveUsernameFromChain(username));
    if (address && address !== zeroAddress) {
      await run(`
          INSERT INTO usernames (address, username, username_hash, updated_at)
          VALUES (?, ?, '', ?)
          ON CONFLICT(address) DO UPDATE SET
            username = excluded.username,
            updated_at = excluded.updated_at
        `,
        [address, username, nowIso()]
      );
    }
  }

  writeJson(response, 200, {
    address: address || zeroAddress
  });
}

async function handleUsernameLookup(response, address) {
  const normalizedAddress = normalizeAddress(address);
  let username = await usernameByAddress(normalizedAddress);

  if (!username && hasUsernameRegistryConfigured()) {
    username = String(await readUsernameByAddressFromChain(normalizedAddress) || '').trim().toLowerCase();
    if (username) {
      await run(`
          INSERT INTO usernames (address, username, username_hash, updated_at)
          VALUES (?, ?, '', ?)
          ON CONFLICT(address) DO UPDATE SET
            username = excluded.username,
            updated_at = excluded.updated_at
        `,
        [normalizedAddress, username, nowIso()]
      );
    }
  }

  writeJson(response, 200, {
    username
  });
}

async function handleTime(response) {
  writeJson(response, 200, await getChainTimeSnapshot());
}

async function handleAuthNonce(request, response) {
  if (
    checkRateLimit(request, response, {
      scope: 'auth:nonce',
      limit: apiConfig.authNonceRateLimitMax,
      windowMs: apiConfig.authNonceRateLimitWindowMs,
      message: 'Too many wallet login challenges requested. Wait a moment and try again.'
    })
  ) {
    return;
  }

  const body = await readJsonBody(request);
  let challenge;
  try {
    challenge = await createNonceChallenge(body.address);
  } catch (error) {
    writeJson(response, 400, {
      error: error?.message || 'Could not create wallet sign-in challenge.'
    });
    return;
  }
  writeJson(response, 200, challenge);
}

async function handleAuthVerify(request, response) {
  if (
    checkRateLimit(request, response, {
      scope: 'auth:verify',
      limit: apiConfig.authVerifyRateLimitMax,
      windowMs: apiConfig.authVerifyRateLimitWindowMs,
      message: 'Too many wallet login attempts. Wait a moment and try again.'
    })
  ) {
    return;
  }

  const body = await readJsonBody(request);
  let session;
  try {
    session = await verifySignatureAndCreateSession({
      address: body.address,
      signature: body.signature,
      userAgent: request.headers['user-agent'] || ''
    });
  } catch (error) {
    writeJson(response, 401, {
      error: error?.message || 'Wallet sign-in could not be verified.'
    });
    return;
  }

  writeJson(
    response,
    200,
    {
      authenticated: true,
      address: session.address,
      expiresAt: session.expiresAt,
      sessionId: session.sessionId
    },
    {
      'Set-Cookie': createSessionCookie(session.sessionId, session.expiresAt)
    }
  );
}

async function handleAuthSession(request, response) {
  const session = await getSessionFromRequest(request);
  writeJson(response, 200, {
    authenticated: Boolean(session),
    address: session?.address || null,
    expiresAt: session?.expires_at || null
  });
}

async function handleAuthLogout(request, response) {
  const session = await getSessionFromRequest(request);
  if (session) {
    await destroySession(session.session_id);
  }

  writeJson(
    response,
    200,
    {
      authenticated: false
    },
    {
      'Set-Cookie': clearSessionCookie()
    }
  );
}

async function handleMessagesGet(url, response, pactId) {
  const address = normalizeAddress(url.searchParams.get('address') || '');
  const pact = await resolvePactAccessRecord(pactId);
  if (!pact) {
    writeJson(response, 404, {
      error: 'Pact not found.'
    });
    return;
  }

  const protocol = await readProtocolSnapshot(address);
  const allowed =
    isPactParticipant(address, pact) ||
    await addressIsParticipant(Number(pactId), address) ||
    protocol.isAdmin ||
    protocol.isArbiter;

  if (!allowed) {
    writeJson(response, 403, {
      error: 'Pact participant or arbiter access is required.',
      messages: [],
      requiresParticipantAccess: true
    });
    return;
  }

  writeJson(response, 200, {
    messages: await listPactMessages(Number(pactId), apiConfig.maxMessagesPerPact)
  });
}

async function handleMessagesPost(request, response, pactId) {
  if (
    checkRateLimit(request, response, {
      scope: 'messages:post',
      limit: apiConfig.messagePostRateLimitMax,
      windowMs: apiConfig.messagePostRateLimitWindowMs,
      message: 'Pact chat is receiving messages too quickly. Wait a moment and try again.'
    })
  ) {
    return;
  }

  const session = await requireSession(
    request,
    response,
    'Sign in with Privy before posting to pact chat.'
  );
  if (!session) {
    return;
  }

  const body = await readJsonBody(request);
  const authorAddress = normalizeAddress(session.address || '');
  if (!authorAddress) {
    await destroySession(session.session_id);
    writeJson(
      response,
      401,
      {
        error: 'Sign in with Privy before posting to pact chat.'
      },
      {
        'Set-Cookie': clearSessionCookie()
      }
    );
    return;
  }

  let protocol;
  try {
    protocol = await readProtocolSnapshot(authorAddress);
  } catch (error) {
    writeJson(response, 503, {
      error: 'Protocol reads are temporarily unavailable. Try again in a moment.'
    });
    return;
  }

  const pact = await resolvePactAccessRecord(pactId);
  if (!pact) {
    writeJson(response, 404, {
      error: 'Pact not found.'
    });
    return;
  }

  const allowed =
    isPactParticipant(authorAddress, pact) ||
    await addressIsParticipant(Number(pactId), authorAddress) ||
    protocol.isAdmin ||
    protocol.isArbiter;

  if (!allowed) {
    writeJson(response, 403, {
      error: 'Only pact participants or arbiters can post in this chat.'
    });
    return;
  }

  const message = String(body.body || '').trim().slice(0, apiConfig.maxCommentLength);
  if (!message) {
    writeJson(response, 400, {
      error: 'A message is required.'
    });
    return;
  }

  const id = crypto.randomUUID();
  const createdAt = nowIso();
  await run(`
      INSERT INTO pact_messages (id, pact_id, author_address, body, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    [id, Number(pactId), authorAddress, message, createdAt]
  );

  writeJson(response, 201, {
    message: {
      id,
      pact_id: Number(pactId),
      author_address: authorAddress,
      body: message,
      created_at: createdAt,
      updated_at: '',
      deleted_at: ''
    }
  });
}

async function handleEvidenceHistory(url, response, pactId) {
  const address = normalizeAddress(url.searchParams.get('address') || '');
  const pact = await getPactAccessRecord(Number(pactId));
  if (!pact) {
    writeJson(response, 404, {
      error: 'Pact not found.'
    });
    return;
  }

  const protocol = await readProtocolSnapshot(address);
  const isOpenPact = normalizeAddress(pact.counterparty_address) === zeroAddress;
  const allowed =
    isOpenPact ||
    await addressIsParticipant(Number(pactId), address) ||
    protocol.isAdmin ||
    protocol.isArbiter;

  if (!allowed) {
    writeJson(response, 403, {
      error: 'Pact participant or arbiter access is required.',
      evidence: [],
      requiresParticipantAccess: true
    });
    return;
  }

  writeJson(response, 200, {
    evidence: await listPactEvidence(Number(pactId))
  });
}

async function storeEvidenceRecord({
  pactId,
  participantAddress,
  uri,
  source,
  contentHashSha256 = '',
  mimeType = '',
  sizeBytes = 0,
  originalName = ''
}) {
  const createdAt = nowIso();
  await run(`
      INSERT INTO pact_evidence (
        pact_id,
        participant_address,
        evidence_uri,
        source,
        content_hash_sha256,
        mime_type,
        size_bytes,
        original_name,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pact_id, participant_address, evidence_uri) DO UPDATE SET
        source = excluded.source,
        content_hash_sha256 = excluded.content_hash_sha256,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        original_name = excluded.original_name,
        updated_at = excluded.updated_at
    `,
    [
      pactId,
      normalizeAddress(participantAddress),
      uri,
      source,
      contentHashSha256,
      mimeType,
      Number(sizeBytes || 0),
      originalName,
      createdAt,
      createdAt
    ]
  );
}

async function assertEvidenceUploadAllowed({ pactId, address }) {
  const pact = await getPactAccessRecord(pactId);
  if (!pact) {
    const error = new Error('Pact not found.');
    error.statusCode = 404;
    throw error;
  }

  const protocol = await readProtocolSnapshot(address);
  const allowed =
    await addressIsParticipant(pactId, address) ||
    protocol.isAdmin ||
    protocol.isArbiter;

  if (!allowed) {
    const error = new Error('Only pact participants or arbiters can store evidence metadata.');
    error.statusCode = 403;
    throw error;
  }

  return pact;
}

async function handleEvidenceUpload(request, response) {
  if (
    checkRateLimit(request, response, {
      scope: 'evidence:upload',
      limit: apiConfig.evidenceMetadataRateLimitMax,
      windowMs: apiConfig.evidenceMetadataRateLimitWindowMs,
      message: 'Evidence uploads are being submitted too quickly. Wait a moment and try again.'
    })
  ) {
    return;
  }

  let form;
  try {
    const rawBody = await readRawBody(
      request,
      Math.max(apiConfig.maxEvidenceVideoBytes, apiConfig.maxEvidenceImageBytes) + 1024 * 1024
    );
    form = parseMultipartFormData(request, rawBody);
  } catch (error) {
    writeJson(response, 400, {
      error: error?.message || 'Upload request is invalid.'
    });
    return;
  }

  const pactId = Number(form.fields.pactId || 0);
  const uploaderAddress = normalizeAddress(form.fields.address || '');
  const file = form.files.find((entry) => entry.fieldName === 'file') || form.files[0];
  if (!pactId || !file) {
    writeJson(response, 400, {
      error: 'A pact ID and evidence file are required.'
    });
    return;
  }

  if (!uploaderAddress) {
    writeJson(response, 400, {
      error: 'Connect your wallet before uploading evidence.'
    });
    return;
  }

  try {
    await assertEvidenceUploadAllowed({ pactId, address: uploaderAddress });
    const upload = await processAndUploadEvidenceFile({
      pactId,
      uploaderAddress,
      file
    });

    await storeEvidenceRecord({
      pactId,
      participantAddress: uploaderAddress,
      uri: upload.url,
      source: upload.source,
      contentHashSha256: upload.contentHashSha256,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      originalName: upload.name
    });

    writeJson(response, 201, {
      evidence: upload
    });
  } catch (error) {
    const message = error?.message || 'Evidence upload failed.';
    const statusCode = error?.statusCode || (/ffmpeg|storage|Supabase S3|configured/i.test(message) ? 503 : 400);
    writeJson(response, statusCode, {
      error: message
    });
  }
}

async function handleEvidenceMetadata(request, response) {
  if (
    checkRateLimit(request, response, {
      scope: 'evidence:metadata',
      limit: apiConfig.evidenceMetadataRateLimitMax,
      windowMs: apiConfig.evidenceMetadataRateLimitWindowMs,
      message: 'Evidence metadata is being submitted too quickly. Wait a moment and try again.'
    })
  ) {
    return;
  }

  const body = await readJsonBody(request);
  const pactId = Number(body.pactId || 0);
  const participantAddress = normalizeAddress(body.address || '');
  if (!pactId) {
    writeJson(response, 400, {
      error: 'A pact ID is required.'
    });
    return;
  }

  if (!participantAddress) {
    writeJson(response, 400, {
      error: 'Connect your wallet before storing evidence metadata.'
    });
    return;
  }

  try {
    await assertEvidenceUploadAllowed({ pactId, address: participantAddress });
  } catch (error) {
    writeJson(response, error?.statusCode || 403, {
      error: error?.message || 'Only pact participants or arbiters can store evidence metadata.'
    });
    return;
  }

  const uri = String(body.uri || '').trim();
  if (!uri) {
    writeJson(response, 400, {
      error: 'An evidence URL is required.'
    });
    return;
  }

  await storeEvidenceRecord({
    pactId,
    participantAddress,
    uri,
    source: String(body.source || 'supabase-storage'),
    contentHashSha256: String(body.contentHashSha256 || ''),
    mimeType: String(body.mimeType || ''),
    sizeBytes: Number(body.sizeBytes || 0),
    originalName: String(body.originalName || '')
  });

  writeJson(response, 201, {
    ok: true
  });
}

async function handleAnalyzeEvidence(request, response, pactId) {
  const body = await readJsonBody(request);
  const session = await getSessionFromRequest(request);
  const requesterAddress = normalizeAddress(session?.address || body.address || '');
  if (!requesterAddress) {
    writeJson(response, 400, { error: 'Connect your wallet before requesting AI analysis.' });
    return;
  }

  const pact = await getPactAccessRecord(Number(pactId));
  if (!pact) {
    writeJson(response, 404, { error: 'Pact not found.' });
    return;
  }

  const protocol = await readProtocolSnapshot(requesterAddress);
  const allowed =
    await addressIsParticipant(Number(pactId), requesterAddress) ||
    protocol.isAdmin ||
    protocol.isArbiter;
  if (!allowed) {
    writeJson(response, 403, { error: 'Only pact participants or arbiters can request AI evidence analysis.' });
    return;
  }

  const evidenceRecords = await listPactEvidence(Number(pactId));
  if (!evidenceRecords || evidenceRecords.length === 0) {
    writeJson(response, 400, { error: 'No evidence available to analyze.' });
    return;
  }

  const latestImage =
    evidenceRecords.find((record) => normalizeAddress(record.participant_address) === requesterAddress && isImageEvidenceRecord(record)) ||
    evidenceRecords.find((record) => isImageEvidenceRecord(record));

  if (!latestImage) {
    writeJson(response, 400, { error: 'Upload an eFootball result screenshot before asking AI to analyze the winner.' });
    return;
  }

  try {
    if (String(pact.event_type || '').toLowerCase() === 'efootball') {
      const { creatorUsername, counterpartyUsername } = await getEfootballUsernameAliases(pact);
      const aiResult = await analyzeEfootballScreenshot({
        pact,
        evidenceRecord: latestImage,
        creatorUsername,
        counterpartyUsername
      });

      writeJson(response, 200, {
        winner: aiResult.winnerAddress,
        winnerAddress: aiResult.winnerAddress,
        evidenceAnalyzed: latestImage.evidence_uri,
        analysis: aiResult
      });
      return;
    }

    writeJson(response, 400, { error: 'AI winner detection is currently enabled for eFootball pacts only.' });
  } catch (error) {
    console.error('Evidence analysis failed:', error);
    const message = error?.message || 'Analysis failed.';
    const statusCode = /not configured|OPENAI_API_KEY/i.test(message) ? 503 : 500;
    writeJson(response, statusCode, { error: message });
  }
}

async function requestHandler(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${apiConfig.host}:${apiConfig.port}`}`);
  const corsHeaders = getCorsHeaders(request);

  // Inject CORS headers into every response automatically
  const originalWriteHead = response.writeHead.bind(response);
  response.writeHead = (statusCode, headers = {}) => originalWriteHead(statusCode, { ...corsHeaders, ...headers });

  // Handle CORS preflight for all routes
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/api/health/startup') {
      await respondWithHealth(response);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/time/chain') {
      await handleTime(response);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/dashboard') {
      await handleDashboard(url, response);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/pacts/open') {
      await handleOpenPacts(url, response);
      return;
    }

    if (request.method === 'GET' && /^\/api\/pacts\/\d+$/.test(url.pathname)) {
      await handlePactDetail(url, response, url.pathname.split('/').pop());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/queue') {
      await handleAdminQueue(request, url, response);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/usernames/resolve') {
      await handleUsernameResolve(url, response);
      return;
    }

    if (request.method === 'GET' && /^\/api\/usernames\/address\/0x[a-fA-F0-9]{40}$/.test(url.pathname)) {
      await handleUsernameLookup(response, url.pathname.split('/').pop());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/nonce') {
      await handleAuthNonce(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/verify') {
      await handleAuthVerify(request, response);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/session') {
      await handleAuthSession(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      await handleAuthLogout(request, response);
      return;
    }

    if (request.method === 'GET' && /^\/api\/pacts\/\d+\/messages$/.test(url.pathname)) {
      await handleMessagesGet(url, response, url.pathname.split('/')[3]);
      return;
    }

    if (request.method === 'GET' && /^\/api\/pacts\/\d+\/evidence$/.test(url.pathname)) {
      await handleEvidenceHistory(url, response, url.pathname.split('/')[3]);
      return;
    }

    if (request.method === 'POST' && /^\/api\/pacts\/\d+\/messages$/.test(url.pathname)) {
      await handleMessagesPost(request, response, url.pathname.split('/')[3]);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/evidence/upload') {
      await handleEvidenceUpload(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/evidence/metadata') {
      await handleEvidenceMetadata(request, response);
      return;
    }

    if (request.method === 'POST' && /^\/api\/pacts\/\d+\/analyze-evidence$/.test(url.pathname)) {
      await handleAnalyzeEvidence(request, response, url.pathname.split('/')[3]);
      return;
    }

    writeJson(response, 404, { error: 'Route not found.' }, corsHeaders);
  } catch (error) {
    console.error('API request failed', {
      method: request.method,
      path: url.pathname,
      error: error?.message || error
    });
    writeJson(response, 500, { error: error?.message || 'Unexpected API error.' }, corsHeaders);
  }
}

async function warmDatabaseAndStartWorkers() {
  try {
    await ensureSyncState('core', apiConfig.contractStartBlocks.core);
    await ensureSyncState('usernames', apiConfig.contractStartBlocks.usernames);
    await getDatabase();
  } catch (error) {
    console.error('Startup database warmup failed:', error?.message || error);
  }

  if (apiConfig.embedIndexer) {
    startIndexerLoop().catch((error) => {
      console.error('Embedded StakeWithFriends indexer stopped:', error);
    });
  }

  startKeeperLoop().catch((error) => {
    console.error('Embedded StakeWithFriends autonomous keeper stopped:', error);
  });
}

const server = http.createServer(requestHandler);
server.listen(apiConfig.port, apiConfig.host, () => {
  console.log(`StakeWithFriends API listening on http://${apiConfig.host}:${apiConfig.port}`);
});

warmDatabaseAndStartWorkers();
