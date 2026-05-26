import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zeroAddress } from 'viem';
import {
  determineChessGameOutcome,
  determineLichessGameOutcome,
  parseChessComGameId,
  verifyChessComGameResult,
  verifyChessPlatformGameResult
} from '../src/chessCom.js';

const creator = '0x00000000000000000000000000000000000000c1';
const counterparty = '0x00000000000000000000000000000000000000c2';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

function buildGame(overrides = {}) {
  return {
    url: 'https://www.chess.com/game/live/168982835114',
    pgn: '[UTCDate "2026.05.20"]\n[UTCTime "14:38:06"]\n[Termination "isco-olad won by checkmate"]',
    end_time: 1_779_288_605,
    time_control: '600',
    time_class: 'rapid',
    rated: false,
    white: {
      username: 'KOLADEKKT',
      result: 'checkmated'
    },
    black: {
      username: 'isco-olad',
      result: 'win'
    },
    ...overrides
  };
}

function buildPact(overrides = {}) {
  return {
    creator_address: creator,
    counterparty_address: counterparty,
    event_started_at: 1_779_288_000,
    event_end: 1_779_289_000,
    submission_deadline: 1_779_290_200,
    ...overrides
  };
}

function buildMetadata(overrides = {}) {
  return {
    creatorPlatformUsername: 'KOLADEKKT',
    counterpartyPlatformUsername: 'isco-olad',
    creatorColor: 'White',
    counterpartyColor: 'Black',
    ...overrides
  };
}

test('parseChessComGameId accepts common Chess.com shared game URLs', () => {
  assert.equal(parseChessComGameId('https://www.chess.com/game/169068995066'), '169068995066');
  assert.equal(parseChessComGameId('Check out this #chess game: https://www.chess.com/game/169068995066'), '169068995066');
  assert.equal(parseChessComGameId('https://www.chess.com/game/live/169068995066'), '169068995066');
  assert.equal(parseChessComGameId('169068995066'), '169068995066');
});

function buildLichessGame(overrides = {}) {
  return {
    id: '3Rx1HG6H',
    rated: true,
    variant: 'standard',
    speed: 'rapid',
    perf: 'rapid',
    createdAt: 1_775_743_611_339,
    lastMoveAt: 1_775_744_278_960,
    status: 'mate',
    winner: 'black',
    players: {
      white: {
        user: {
          name: 'saintbernardlermite',
          id: 'saintbernardlermite'
        }
      },
      black: {
        user: {
          name: 'isaiaholad',
          id: 'isaiaholad'
        }
      }
    },
    pgn: '[Result "0-1"]\n[Termination "Normal"]',
    ...overrides
  };
}

test('verifyChessComGameResult maps a verified Chess.com URL to the winning pact address', async () => {
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    return jsonResponse({ games: String(url).includes('/2026/05') ? [buildGame()] : [] });
  };

  const result = await verifyChessComGameResult({
    pact: buildPact(),
    metadata: buildMetadata(),
    gameUrl: 'https://www.chess.com/game/live/168982835114',
    fetchImpl
  });

  assert.equal(result.winnerAddress, counterparty);
  assert.equal(result.winnerUsername, 'isco-olad');
  assert.equal(result.winningColor, 'Black');
  assert.equal(result.whiteResult, 'checkmated');
  assert.equal(result.blackResult, 'win');
  assert.equal(result.source, 'chess.com-archive');
  assert.ok(fetchCalls.some((url) => String(url).includes('/player/koladekkt/games/2026/05')));
});

test('verifyChessComGameResult returns zero address for draw results', async () => {
  const fetchImpl = async () =>
    jsonResponse({
      games: [
        buildGame({
          white: { username: 'KOLADEKKT', result: 'agreed' },
          black: { username: 'isco-olad', result: 'agreed' }
        })
      ]
    });

  const result = await verifyChessComGameResult({
    pact: buildPact(),
    metadata: buildMetadata(),
    gameUrl: 'https://www.chess.com/game/live/168982835114',
    fetchImpl
  });

  assert.equal(result.winnerAddress, zeroAddress);
  assert.equal(result.result, 'split');
});

test('verifyChessComGameResult rejects games with mismatched locked colors', async () => {
  const fetchImpl = async () => jsonResponse({ games: [buildGame()] });

  await assert.rejects(
    verifyChessComGameResult({
      pact: buildPact(),
      metadata: buildMetadata({ creatorColor: 'Black', counterpartyColor: 'White' }),
      gameUrl: 'https://www.chess.com/game/live/168982835114',
      fetchImpl
    }),
    /colors do not match/i
  );
});

test('verifyChessComGameResult allows a game that starts shortly after the match window and ends before submission deadline', async () => {
  const fetchImpl = async () =>
    jsonResponse({
      games: [
        buildGame({
          pgn: '[UTCDate "2026.05.21"]\n[UTCTime "12:49:36"]\n[Termination "Hazzi010 won on time"]',
          end_time: 1_779_367_881,
          white: {
            username: 'Hazzi010',
            result: 'win'
          },
          black: {
            username: 'isco-olad',
            result: 'timeout'
          }
        })
      ]
    });

  const result = await verifyChessComGameResult({
    pact: buildPact({
      creator_address: creator,
      counterparty_address: counterparty,
      event_started_at: 1_779_367_357,
      event_end: 1_779_367_657,
      submission_deadline: 1_779_368_857
    }),
    metadata: buildMetadata({
      creatorPlatformUsername: 'Hazzi010',
      counterpartyPlatformUsername: 'isco-olad',
      creatorColor: 'White',
      counterpartyColor: 'Black'
    }),
    gameUrl: 'https://www.chess.com/game/live/168982835114',
    fetchImpl
  });

  assert.equal(result.winnerAddress, creator);
  assert.equal(result.winnerUsername, 'Hazzi010');
  assert.equal(result.gameStartedAt, '2026-05-21T12:49:36.000Z');
  assert.equal(result.gameEndedAt, '2026-05-21T12:51:21.000Z');
});

test('verifyChessComGameResult rejects games that start too long after the match window', async () => {
  const fetchImpl = async () =>
    jsonResponse({
      games: [
        buildGame({
          pgn: '[UTCDate "2026.05.21"]\n[UTCTime "12:53:00"]\n[Termination "Hazzi010 won on time"]',
          end_time: 1_779_368_100,
          white: {
            username: 'Hazzi010',
            result: 'win'
          },
          black: {
            username: 'isco-olad',
            result: 'timeout'
          }
        })
      ]
    });

  await assert.rejects(
    verifyChessComGameResult({
      pact: buildPact({
        event_started_at: 1_779_367_357,
        event_end: 1_779_367_657,
        submission_deadline: 1_779_368_857
      }),
      metadata: buildMetadata({
        creatorPlatformUsername: 'Hazzi010',
        counterpartyPlatformUsername: 'isco-olad',
        creatorColor: 'White',
        counterpartyColor: 'Black'
      }),
      gameUrl: 'https://www.chess.com/game/live/168982835114',
      fetchImpl
    }),
    /started too long after/i
  );
});

test('verifyChessPlatformGameResult maps a verified Lichess URL to the winning pact address', async () => {
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    return jsonResponse(buildLichessGame());
  };

  const result = await verifyChessPlatformGameResult({
    pact: buildPact({
      event_started_at: 1_775_743_500,
      event_end: 1_775_744_400,
      submission_deadline: 1_775_745_600
    }),
    metadata: buildMetadata({
      platform: 'lichess',
      creatorPlatformUsername: 'saintbernardlermite',
      counterpartyPlatformUsername: 'isaiaholad',
      creatorColor: 'White',
      counterpartyColor: 'Black'
    }),
    gameUrl: 'https://lichess.org/3Rx1HG6H',
    fetchImpl
  });

  assert.equal(result.winnerAddress, counterparty);
  assert.equal(result.winnerUsername, 'isaiaholad');
  assert.equal(result.winningColor, 'Black');
  assert.equal(result.source, 'lichess-export');
  assert.equal(result.gameUrl, 'https://lichess.org/3Rx1HG6H');
  assert.ok(fetchCalls.some((url) => String(url).includes('/game/export/3Rx1HG6H')));
});

test('determineLichessGameOutcome returns split for Lichess draw statuses', () => {
  assert.deepEqual(
    determineLichessGameOutcome({ status: 'draw', winner: null }),
    { result: 'split', winningColor: '', resultCode: 'draw' }
  );
});

test('determineChessGameOutcome handles unknown result codes conservatively', () => {
  assert.deepEqual(
    determineChessGameOutcome({
      white: { result: 'unknown' },
      black: { result: 'unknown' }
    }),
    { result: 'unknown', winningColor: '', resultCode: 'unknown:unknown' }
  );
});
