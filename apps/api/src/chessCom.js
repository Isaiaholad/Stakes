import { zeroAddress } from 'viem';

const chessComBaseUrl = 'https://api.chess.com/pub';
const lichessBaseUrl = 'https://lichess.org';
const chessComUserAgent = 'StakeWithFriendsBot/0.1 contact: isaiaholad@gmail.com';
const drawResultCodes = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);
const lichessDrawStatuses = new Set(['draw', 'stalemate']);
const chessMatchStartGraceSeconds = 5 * 60;

export function normalizeChessComUsername(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

export function normalizeChessPlatform(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  if (['lichess', 'lichess.org'].includes(normalized)) {
    return 'lichess';
  }
  if (['chess.com', 'chesscom', 'chess'].includes(normalized)) {
    return 'chess.com';
  }
  return '';
}

export function normalizeChessColor(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'white') {
    return 'White';
  }
  if (normalized === 'black') {
    return 'Black';
  }
  return '';
}

export function parseChessComGameId(value) {
  const match =
    String(value || '').match(/chess\.com\/game\/(?:live\/)?(\d+)/i) ||
    String(value || '').match(/^(\d+)$/);
  return match?.[1] || '';
}

export function parseLichessGameId(value) {
  const match = String(value || '').match(/lichess\.org\/(?:game\/export\/)?([a-zA-Z0-9]{8,12})/i) ||
    String(value || '').match(/^([a-zA-Z0-9]{8,12})$/);
  return match?.[1]?.slice(0, 8) || '';
}

export function normalizeChessComGameUrl(value) {
  const gameId = parseChessComGameId(value);
  return gameId ? `https://www.chess.com/game/live/${gameId}` : '';
}

export function normalizeLichessGameUrl(value) {
  const gameId = parseLichessGameId(value);
  return gameId ? `${lichessBaseUrl}/${gameId}` : '';
}

export function detectChessPlatformFromUrl(value) {
  const raw = String(value || '').trim();
  if (/lichess\.org/i.test(raw)) {
    return 'lichess';
  }
  if (/chess\.com/i.test(raw) || /^\d+$/.test(raw)) {
    return 'chess.com';
  }
  if (parseLichessGameId(raw)) {
    return 'lichess';
  }
  return '';
}

export function normalizeChessGameUrl(value, platform = '') {
  const normalizedPlatform = normalizeChessPlatform(platform) || detectChessPlatformFromUrl(value);
  if (normalizedPlatform === 'lichess') {
    return normalizeLichessGameUrl(value);
  }
  if (normalizedPlatform === 'chess.com') {
    return normalizeChessComGameUrl(value);
  }
  return '';
}

function monthKeyFromDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addMonthKeys(keys, date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  for (let index = 0; index < 3; index += 1) {
    keys.add(monthKeyFromDate(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1))));
  }
}

export function buildChessArchiveMonths(pact = {}) {
  const keys = new Set();
  const timestamps = [
    Number(pact.event_started_at || 0),
    Number(pact.event_end || 0),
    Number(pact.submission_deadline || 0)
  ].filter(Boolean);

  if (!timestamps.length) {
    addMonthKeys(keys, new Date());
    return [...keys].slice(-3);
  }

  for (const timestamp of timestamps) {
    addMonthKeys(keys, new Date(timestamp * 1000));
  }

  return [...keys].sort().slice(-6);
}

async function fetchChessArchive({ username, monthKey, fetchImpl = fetch }) {
  const [year, month] = String(monthKey).split('-');
  const response = await fetchImpl(`${chessComBaseUrl}/player/${encodeURIComponent(username)}/games/${year}/${month}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': chessComUserAgent
    }
  });

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`Chess.com archive lookup failed for @${username} (${response.status}).`);
  }

  const payload = await response.json();
  return Array.isArray(payload.games) ? payload.games : [];
}

async function findChessComGame({ creatorUsername, counterpartyUsername, gameUrl, pact, fetchImpl }) {
  const requestedGameId = parseChessComGameId(gameUrl);
  const archiveMonths = buildChessArchiveMonths(pact);
  const usernames = [...new Set([creatorUsername, counterpartyUsername].filter(Boolean))];

  for (const username of usernames) {
    for (const monthKey of archiveMonths) {
      const games = await fetchChessArchive({ username, monthKey, fetchImpl });
      const match = games.find((game) => parseChessComGameId(game?.url) === requestedGameId);
      if (match) {
        return match;
      }
    }
  }

  throw new Error('Chess.com could not find this game in the players’ public archives for the pact window.');
}

function parsePgnTag(pgn, tagName) {
  const escapedTagName = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(pgn || '').match(new RegExp(`\\[${escapedTagName}\\s+"([^"]*)"\\]`));
  return match?.[1] || '';
}

function parseGameStartTime(game) {
  const date = parsePgnTag(game?.pgn, 'UTCDate');
  const time = parsePgnTag(game?.pgn, 'UTCTime') || parsePgnTag(game?.pgn, 'StartTime');
  if (!date || !time) {
    return 0;
  }

  const iso = `${date.replace(/\./g, '-')}T${time}Z`;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

function assertChessGameTiming({ platformLabel, gameStartTime, gameEndTime, pact }) {
  const pactStartedAt = Number(pact?.event_started_at || 0);
  const pactEventEnd = Number(pact?.event_end || 0);
  const pactSubmissionDeadline = Number(pact?.submission_deadline || 0);
  const latestAllowedStart = pactEventEnd ? pactEventEnd + chessMatchStartGraceSeconds : 0;
  if (pactStartedAt && gameEndTime && gameEndTime < pactStartedAt) {
    throw new Error(`This ${platformLabel} game ended before the pact match window started.`);
  }

  if (latestAllowedStart && gameStartTime && gameStartTime > latestAllowedStart) {
    throw new Error(`This ${platformLabel} game started too long after the pact match window ended.`);
  }

  if (pactSubmissionDeadline && gameEndTime && gameEndTime > pactSubmissionDeadline) {
    throw new Error(`This ${platformLabel} game ended after the pact result submission deadline.`);
  }
}

export function determineChessGameOutcome(game) {
  const whiteResult = String(game?.white?.result || '').toLowerCase();
  const blackResult = String(game?.black?.result || '').toLowerCase();

  if (whiteResult === 'win' && blackResult !== 'win') {
    return { result: 'winner', winningColor: 'White', resultCode: whiteResult };
  }

  if (blackResult === 'win' && whiteResult !== 'win') {
    return { result: 'winner', winningColor: 'Black', resultCode: blackResult };
  }

  if (drawResultCodes.has(whiteResult) && drawResultCodes.has(blackResult)) {
    return { result: 'split', winningColor: '', resultCode: whiteResult || blackResult };
  }

  return { result: 'unknown', winningColor: '', resultCode: `${whiteResult || 'unknown'}:${blackResult || 'unknown'}` };
}

export function determineLichessGameOutcome(game) {
  const winner = String(game?.winner || '').toLowerCase();
  const status = String(game?.status || '').toLowerCase();
  const pgnResult = parsePgnTag(game?.pgn, 'Result');

  if (winner === 'white') {
    return { result: 'winner', winningColor: 'White', resultCode: status || winner };
  }

  if (winner === 'black') {
    return { result: 'winner', winningColor: 'Black', resultCode: status || winner };
  }

  if (pgnResult === '1-0') {
    return { result: 'winner', winningColor: 'White', resultCode: status || pgnResult };
  }

  if (pgnResult === '0-1') {
    return { result: 'winner', winningColor: 'Black', resultCode: status || pgnResult };
  }

  if (lichessDrawStatuses.has(status) || pgnResult === '1/2-1/2') {
    return { result: 'split', winningColor: '', resultCode: status || pgnResult };
  }

  return { result: 'unknown', winningColor: '', resultCode: status || 'unknown' };
}

export async function verifyChessComGameResult({ pact, metadata, gameUrl, fetchImpl = fetch }) {
  const normalizedGameUrl = normalizeChessComGameUrl(gameUrl || metadata?.gameUrl);
  if (!normalizedGameUrl) {
    throw new Error('Paste a valid Chess.com game URL before verifying this chess result.');
  }

  const creatorUsername = normalizeChessComUsername(metadata?.creatorPlatformUsername);
  const counterpartyUsername = normalizeChessComUsername(metadata?.counterpartyPlatformUsername);
  const creatorColor = normalizeChessColor(metadata?.creatorColor);
  const counterpartyColor = normalizeChessColor(metadata?.counterpartyColor);

  if (!creatorUsername || !counterpartyUsername || !creatorColor || !counterpartyColor) {
    throw new Error('Chess.com usernames and locked colors must be saved for both players before URL verification.');
  }

  if (creatorUsername === counterpartyUsername) {
    throw new Error('Both chess players cannot use the same Chess.com username.');
  }

  if (creatorColor === counterpartyColor) {
    throw new Error('Both chess players cannot have the same color.');
  }

  const game = await findChessComGame({
    creatorUsername,
    counterpartyUsername,
    gameUrl: normalizedGameUrl,
    pact,
    fetchImpl
  });
  const whiteUsername = normalizeChessComUsername(game?.white?.username);
  const blackUsername = normalizeChessComUsername(game?.black?.username);
  const usernamesMatch =
    new Set([whiteUsername, blackUsername]).size === 2 &&
    [whiteUsername, blackUsername].includes(creatorUsername) &&
    [whiteUsername, blackUsername].includes(counterpartyUsername);

  if (!usernamesMatch) {
    throw new Error('The Chess.com game URL does not match both pact players.');
  }

  const creatorActualColor = whiteUsername === creatorUsername ? 'White' : 'Black';
  const counterpartyActualColor = whiteUsername === counterpartyUsername ? 'White' : 'Black';
  if (creatorActualColor !== creatorColor || counterpartyActualColor !== counterpartyColor) {
    throw new Error('The Chess.com game colors do not match the locked pact colors.');
  }

  const gameEndTime = Number(game.end_time || 0);
  const gameStartTime = parseGameStartTime(game);
  assertChessGameTiming({ platformLabel: 'Chess.com', gameStartTime, gameEndTime, pact });

  const outcome = determineChessGameOutcome(game);
  if (outcome.result === 'unknown') {
    throw new Error('Chess.com did not return a clear win or draw result for this game.');
  }

  const winnerAddress =
    outcome.result === 'split'
      ? zeroAddress
      : outcome.winningColor === creatorColor
        ? pact.creator_address
        : pact.counterparty_address;
  const winnerUsername =
    outcome.result === 'split'
      ? ''
      : outcome.winningColor === 'White'
        ? game.white.username
        : game.black.username;

  return {
    source: 'chess.com-archive',
    gameUrl: normalizedGameUrl,
    winnerAddress,
    result: outcome.result,
    winningColor: outcome.winningColor,
    winnerUsername,
    whiteUsername: game.white.username,
    blackUsername: game.black.username,
    whiteResult: game.white.result,
    blackResult: game.black.result,
    termination: parsePgnTag(game.pgn, 'Termination'),
    timeClass: game.time_class || '',
    timeControl: game.time_control || '',
    rated: Boolean(game.rated),
    gameStartedAt: gameStartTime ? new Date(gameStartTime * 1000).toISOString() : null,
    gameEndedAt: gameEndTime ? new Date(gameEndTime * 1000).toISOString() : null,
    confidence: 0.98,
    explanation:
      outcome.result === 'split'
        ? 'Chess.com verified a draw result for the locked usernames and colors.'
        : `Chess.com verified ${winnerUsername || outcome.winningColor} as winner for the locked usernames and colors.`
  };
}

async function fetchLichessGame({ gameUrl, fetchImpl = fetch }) {
  const gameId = parseLichessGameId(gameUrl);
  const response = await fetchImpl(
    `${lichessBaseUrl}/game/export/${encodeURIComponent(gameId)}?moves=false&pgnInJson=true&tags=true&clocks=false&evals=false&opening=true`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': chessComUserAgent
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Lichess game lookup failed (${response.status}).`);
  }

  return await response.json();
}

export async function verifyLichessGameResult({ pact, metadata, gameUrl, fetchImpl = fetch }) {
  const normalizedGameUrl = normalizeLichessGameUrl(gameUrl || metadata?.gameUrl);
  if (!normalizedGameUrl) {
    throw new Error('Paste a valid Lichess game URL before verifying this chess result.');
  }

  const creatorUsername = normalizeChessComUsername(metadata?.creatorPlatformUsername);
  const counterpartyUsername = normalizeChessComUsername(metadata?.counterpartyPlatformUsername);
  const creatorColor = normalizeChessColor(metadata?.creatorColor);
  const counterpartyColor = normalizeChessColor(metadata?.counterpartyColor);

  if (!creatorUsername || !counterpartyUsername || !creatorColor || !counterpartyColor) {
    throw new Error('Lichess usernames and locked colors must be saved for both players before URL verification.');
  }

  if (creatorUsername === counterpartyUsername) {
    throw new Error('Both chess players cannot use the same Lichess username.');
  }

  if (creatorColor === counterpartyColor) {
    throw new Error('Both chess players cannot have the same color.');
  }

  const game = await fetchLichessGame({ gameUrl: normalizedGameUrl, fetchImpl });
  const whiteUsername = normalizeChessComUsername(game?.players?.white?.user?.name || game?.players?.white?.user?.id || '');
  const blackUsername = normalizeChessComUsername(game?.players?.black?.user?.name || game?.players?.black?.user?.id || '');
  const usernamesMatch =
    new Set([whiteUsername, blackUsername]).size === 2 &&
    [whiteUsername, blackUsername].includes(creatorUsername) &&
    [whiteUsername, blackUsername].includes(counterpartyUsername);

  if (!usernamesMatch) {
    throw new Error('The Lichess game URL does not match both pact players.');
  }

  const creatorActualColor = whiteUsername === creatorUsername ? 'White' : 'Black';
  const counterpartyActualColor = whiteUsername === counterpartyUsername ? 'White' : 'Black';
  if (creatorActualColor !== creatorColor || counterpartyActualColor !== counterpartyColor) {
    throw new Error('The Lichess game colors do not match the locked pact colors.');
  }

  const gameStartTime = Math.floor(Number(game.createdAt || 0) / 1000);
  const gameEndTime = Math.floor(Number(game.lastMoveAt || 0) / 1000);
  assertChessGameTiming({ platformLabel: 'Lichess', gameStartTime, gameEndTime, pact });

  const outcome = determineLichessGameOutcome(game);
  if (outcome.result === 'unknown') {
    throw new Error('Lichess did not return a clear win or draw result for this game.');
  }

  const winnerAddress =
    outcome.result === 'split'
      ? zeroAddress
      : outcome.winningColor === creatorColor
        ? pact.creator_address
        : pact.counterparty_address;
  const winnerUsername =
    outcome.result === 'split'
      ? ''
      : outcome.winningColor === 'White'
        ? game.players?.white?.user?.name || game.players?.white?.user?.id || 'White'
        : game.players?.black?.user?.name || game.players?.black?.user?.id || 'Black';

  return {
    source: 'lichess-export',
    gameUrl: normalizedGameUrl,
    winnerAddress,
    result: outcome.result,
    winningColor: outcome.winningColor,
    winnerUsername,
    whiteUsername: game.players?.white?.user?.name || game.players?.white?.user?.id || '',
    blackUsername: game.players?.black?.user?.name || game.players?.black?.user?.id || '',
    whiteResult: outcome.winningColor === 'White' ? 'win' : outcome.result === 'split' ? 'draw' : 'loss',
    blackResult: outcome.winningColor === 'Black' ? 'win' : outcome.result === 'split' ? 'draw' : 'loss',
    termination: parsePgnTag(game.pgn, 'Termination') || game.status || '',
    timeClass: game.speed || game.perf || '',
    timeControl: game.clock ? `${game.clock.initial}+${game.clock.increment}` : '',
    rated: Boolean(game.rated),
    gameStartedAt: gameStartTime ? new Date(gameStartTime * 1000).toISOString() : null,
    gameEndedAt: gameEndTime ? new Date(gameEndTime * 1000).toISOString() : null,
    confidence: 0.98,
    explanation:
      outcome.result === 'split'
        ? 'Lichess verified a draw result for the locked usernames and colors.'
        : `Lichess verified ${winnerUsername || outcome.winningColor} as winner for the locked usernames and colors.`
  };
}

export async function verifyChessPlatformGameResult({ pact, metadata, gameUrl, fetchImpl = fetch }) {
  const platform = normalizeChessPlatform(metadata?.platform) || detectChessPlatformFromUrl(gameUrl || metadata?.gameUrl);
  if (platform === 'lichess') {
    return await verifyLichessGameResult({ pact, metadata, gameUrl, fetchImpl });
  }
  if (platform === 'chess.com') {
    return await verifyChessComGameResult({ pact, metadata, gameUrl, fetchImpl });
  }

  throw new Error('Paste a valid Chess.com or Lichess game URL before verifying this chess result.');
}
