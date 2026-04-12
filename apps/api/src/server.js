import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';
import { clearSessionCookie, createNonceChallenge, createSessionCookie, destroySession, getSessionFromRequest, verifySignatureAndCreateSession } from './auth.js';
import { getChainTimeSnapshot, readPactAccessFromChain, readProtocolSnapshot, readUsernameByAddressFromChain, readVaultSnapshot, resolveUsernameFromChain, zeroAddress } from './chain.js';
import { apiConfig, hasCoreContractsConfigured, hasUsernameRegistryConfigured, isAddressConfigured } from './config.js';
import { all, cleanupExpiredAuthRecords, ensureSyncState, get, getDatabase, nowIso, run } from './db.js';
import { startIndexerLoop } from './indexer.js';
import { startKeeperLoop } from './keeper.js';
import { addressByUsername, addressIsParticipant, getPactAccessRecord, getPactById, listAdminQueuePacts, listOpenPacts, listPactEvidence, listPactMessages, listRecentPacts, usernameByAddress } from './pacts.js';
import { consumeRateLimit, getRequestIp } from './rateLimit.js';

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
  const indexedRecord = getPactAccessRecord(Number(pactId));
  const chainRecord = await readPactAccessFromChain(Number(pactId)).catch(() => null);
  return chainRecord || indexedRecord;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1_000_000) {
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
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
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

function requireSession(request, response, message) {
  const session = getSessionFromRequest(request);
  if (!session) {
    writeJson(response, 401, {
      error: message
    });
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
    getDatabase();
    databaseOk = true;
  } catch {
    databaseOk = false;
  }

  const contractsConfigured = hasCoreContractsConfigured();
  const storageOk = Boolean(apiConfig.storageMode);
  const chainTime = contractsConfigured ? await getChainTimeSnapshot() : null;
  const syncRows = all(`SELECT * FROM sync_state ORDER BY sync_key ASC`);
  const indexedPactsCount = databaseOk ? Number(get(`SELECT COUNT(*) AS count FROM pacts`)?.count || 0) : 0;
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
  const protocol = await readProtocolSnapshot(address);
  const pacts = listRecentPacts(limit, protocol, address);

  writeJson(response, 200, {
    pacts
  });
}

async function handleOpenPacts(url, response) {
  const address = normalizeAddress(url.searchParams.get('address') || '');
  const limit = parseLimit(url, 18);
  const protocol = await readProtocolSnapshot(address);
  const pacts = listOpenPacts(limit, protocol, address);

  writeJson(response, 200, {
    pacts
  });
}

async function handlePactDetail(url, response, pactId) {
  const address = normalizeAddress(url.searchParams.get('address') || '');
  const protocol = await readProtocolSnapshot(address);
  const pact = getPactById(Number(pactId), protocol, address);

  if (!pact) {
    writeJson(response, 404, {
      error: 'Pact not found.'
    });
    return;
  }

  writeJson(response, 200, {
    pact
  });
}

async function handleAdminQueue(request, url, response) {
  const session = requireSession(request, response, 'Sign a wallet message before reading the indexed admin queue.');
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
  const pacts = listAdminQueuePacts(limit, protocol, address);
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

  let address = addressByUsername(username);
  if (address === zeroAddress && hasUsernameRegistryConfigured()) {
    address = normalizeAddress(await resolveUsernameFromChain(username));
    if (address && address !== zeroAddress) {
      run(
        `
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
  let username = usernameByAddress(normalizedAddress);

  if (!username && hasUsernameRegistryConfigured()) {
    username = String(await readUsernameByAddressFromChain(normalizedAddress) || '').trim().toLowerCase();
    if (username) {
      run(
        `
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
  const challenge = await createNonceChallenge(body.address);
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
  const session = await verifySignatureAndCreateSession({
    address: body.address,
    signature: body.signature,
    userAgent: request.headers['user-agent'] || ''
  });

  writeJson(
    response,
    200,
    {
      authenticated: true,
      address: session.address,
      expiresAt: session.expiresAt
    },
    {
      'Set-Cookie': createSessionCookie(session.sessionId, session.expiresAt)
    }
  );
}

async function handleAuthSession(request, response) {
  const session = getSessionFromRequest(request);
  writeJson(response, 200, {
    authenticated: Boolean(session),
    address: session?.address || null,
    expiresAt: session?.expires_at || null
  });
}

async function handleAuthLogout(request, response) {
  const session = getSessionFromRequest(request);
  if (session) {
    destroySession(session.session_id);
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
    addressIsParticipant(Number(pactId), address) ||
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
    messages: listPactMessages(Number(pactId), apiConfig.maxMessagesPerPact)
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

  const session = requireSession(
    request,
    response,
    'Sign a wallet message before posting to pact chat.'
  );
  if (!session) {
    return;
  }

  const body = await readJsonBody(request);
  const authorAddress = normalizeAddress(session.address || '');
  if (!authorAddress) {
    destroySession(session.session_id);
    writeJson(
      response,
      401,
      {
        error: 'Sign a wallet message before posting to pact chat.'
      },
      {
        'Set-Cookie': clearSessionCookie()
      }
    );
    return;
  }

  const protocol = await readProtocolSnapshot(authorAddress);
  const pact = await resolvePactAccessRecord(pactId);
  if (!pact) {
    writeJson(response, 404, {
      error: 'Pact not found.'
    });
    return;
  }

  const allowed =
    isPactParticipant(authorAddress, pact) ||
    addressIsParticipant(Number(pactId), authorAddress) ||
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
  run(
    `
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
  const pact = getPactAccessRecord(Number(pactId));
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
    addressIsParticipant(Number(pactId), address) ||
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
    evidence: listPactEvidence(Number(pactId))
  });
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

  const session = getSessionFromRequest(request);
  if (!session) {
    writeJson(response, 401, {
      error: 'Sign a wallet message before storing evidence metadata.'
    });
    return;
  }

  const body = await readJsonBody(request);
  const pactId = Number(body.pactId || 0);
  const pact = getPactAccessRecord(pactId);
  if (!pact) {
    writeJson(response, 404, {
      error: 'Pact not found.'
    });
    return;
  }

  const protocol = await readProtocolSnapshot(session.address);
  const allowed =
    addressIsParticipant(pactId, session.address) ||
    protocol.isAdmin ||
    protocol.isArbiter;

  if (!allowed) {
    writeJson(response, 403, {
      error: 'Only pact participants or arbiters can store evidence metadata.'
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

  const createdAt = nowIso();
  run(
    `
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
      VALUES (?, ?, ?, 'catbox-metadata', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pact_id, participant_address, evidence_uri) DO UPDATE SET
        content_hash_sha256 = excluded.content_hash_sha256,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        original_name = excluded.original_name,
        updated_at = excluded.updated_at
    `,
    [
      pactId,
      normalizeAddress(session.address),
      uri,
      String(body.contentHashSha256 || ''),
      String(body.mimeType || ''),
      Number(body.sizeBytes || 0),
      String(body.originalName || ''),
      createdAt,
      createdAt
    ]
  );

  writeJson(response, 201, {
    ok: true
  });
}

async function requestHandler(request, response) {
  cleanupExpiredAuthRecords();
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

    if (request.method === 'POST' && url.pathname === '/api/evidence/metadata') {
      await handleEvidenceMetadata(request, response);
      return;
    }

    writeJson(response, 404, { error: 'Route not found.' }, corsHeaders);
  } catch (error) {
    writeJson(response, 500, { error: error?.message || 'Unexpected API error.' }, corsHeaders);
  }
}

ensureSyncState('core', apiConfig.contractStartBlocks.core);
ensureSyncState('usernames', apiConfig.contractStartBlocks.usernames);
getDatabase();

const server = http.createServer(requestHandler);
server.listen(apiConfig.port, apiConfig.host, () => {
  console.log(`StakeWithFriends API listening on http://${apiConfig.host}:${apiConfig.port}`);
});

if (apiConfig.embedIndexer) {
  startIndexerLoop().catch((error) => {
    console.error('Embedded StakeWithFriends indexer stopped:', error);
  });
}

startKeeperLoop().catch((error) => {
  console.error('Embedded StakeWithFriends autonomous keeper stopped:', error);
});
