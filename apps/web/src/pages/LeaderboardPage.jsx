import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crown, Flame, RefreshCcw, ShieldCheck, Trophy } from 'lucide-react';
import EmptyState from '../components/EmptyState.jsx';
import ReadStatusNote from '../components/ReadStatusNote.jsx';
import { readLeaderboard } from '../lib/pacts.js';
import { useWalletStore } from '../store/useWalletStore.js';

const leaderboardLimit = 50;
const presetGames = ['eFootball', 'Chess'];

function formatWinRate(value) {
  const numericValue = Number(value || 0);
  return `${Math.round(numericValue * 100)}%`;
}

function formatRecord(entry) {
  return `${Number(entry?.wins || 0)}-${Number(entry?.losses || 0)}-${Number(entry?.splits || 0)}`;
}

function formatRank(rank) {
  if (Number(rank) === 1) {
    return '#1';
  }

  return `#${Number(rank || 0)}`;
}

function gameLabel(value) {
  return value === 'all' ? 'Overall' : value;
}

function StatPill({ label, value, accent = false }) {
  return (
    <div className={`rounded-2xl px-3 py-2 ${accent ? 'bg-ink text-sand' : 'bg-white/70 text-slate/75'}`}>
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-1 font-display text-xl">{value}</p>
    </div>
  );
}

function TopPlayerCard({ player }) {
  if (!player) {
    return null;
  }

  return (
    <section className="relative overflow-hidden rounded-[34px] bg-ink p-5 text-sand shadow-glow">
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-coral/35 blur-2xl" />
      <div className="absolute -bottom-12 left-6 h-28 w-28 rounded-full bg-mint/25 blur-2xl" />
      <div className="relative flex items-start gap-4">
        <div className="rounded-[24px] bg-coral p-4 text-white shadow-glow">
          <Crown className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sand/65">Current leader</p>
          <p className="mt-2 truncate font-display text-3xl">{player.displayName}</p>
          <p className="mt-1 text-sm text-sand/70">
            {player.favoriteGame} specialist with {formatRecord(player)} record
          </p>
        </div>
      </div>
      <div className="relative mt-5 grid grid-cols-3 gap-3">
        <StatPill label="XP" value={player.points} accent />
        <StatPill label="Win rate" value={formatWinRate(player.winRate)} />
        <StatPill label="Streak" value={`${player.currentStreak}W`} />
      </div>
    </section>
  );
}

function MyRankCard({ player }) {
  if (!player) {
    return null;
  }

  return (
    <section className="rounded-[28px] border border-mint/40 bg-mint/20 p-4 text-emerald-950 shadow-glow">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-white/80 p-3">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">My rank</p>
          <p className="mt-1 font-display text-2xl">
            {formatRank(player.rank)} · {player.points} XP
          </p>
          <p className="text-sm opacity-75">
            {formatRecord(player)} record, {formatWinRate(player.winRate)} win rate, {player.evidenceCount} evidence uploads
          </p>
        </div>
      </div>
    </section>
  );
}

function LeaderboardRow({ player }) {
  const isPodium = Number(player.rank) <= 3;

  return (
    <article className="rounded-[26px] border border-white/70 bg-white/85 p-4 shadow-glow">
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl font-display text-lg ${
          isPodium ? 'bg-coral text-white' : 'bg-sand text-ink'
        }`}>
          {player.rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-display text-xl text-ink">{player.displayName}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate/50">
                Favorite: {player.favoriteGame}
              </p>
            </div>
            <div className="rounded-2xl bg-ink px-3 py-2 text-right text-sand">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-sand/60">XP</p>
              <p className="font-display text-xl">{player.points}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs text-slate/70">
            <div className="rounded-2xl bg-sand/80 px-2 py-2">
              <p className="font-semibold text-ink">{formatRecord(player)}</p>
              <p>W-L-S</p>
            </div>
            <div className="rounded-2xl bg-sand/80 px-2 py-2">
              <p className="font-semibold text-ink">{formatWinRate(player.winRate)}</p>
              <p>Win rate</p>
            </div>
            <div className="rounded-2xl bg-sand/80 px-2 py-2">
              <p className="font-semibold text-ink">{player.currentStreak}W</p>
              <p>Streak</p>
            </div>
            <div className="rounded-2xl bg-sand/80 px-2 py-2">
              <p className="font-semibold text-ink">{player.evidenceCount}</p>
              <p>Proofs</p>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function LeaderboardPage() {
  const address = useWalletStore((state) => state.address);
  const [selectedGame, setSelectedGame] = useState('all');
  const query = useQuery({
    queryKey: ['leaderboard', selectedGame, address, leaderboardLimit],
    queryFn: () =>
      readLeaderboard({
        game: selectedGame,
        limit: leaderboardLimit,
        address
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true
  });
  const leaderboard = query.data?.leaderboard || [];
  const topPlayer = leaderboard[0] || null;
  const gameTabs = useMemo(() => {
    const availableGames = query.data?.availableGames || [];
    return ['all', ...new Set([...presetGames, ...availableGames])];
  }, [query.data?.availableGames]);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[34px] bg-white/90 p-5 shadow-glow">
        <div className="flex items-start gap-4">
          <div className="rounded-[24px] bg-ink p-4 text-sand">
            <Trophy className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-3xl text-ink">Leaderboard</p>
            <p className="mt-2 text-sm leading-6 text-slate/70">
              Earn XP from completed pacts, wins, clean evidence, and active win streaks. Stake size only breaks ties.
            </p>
          </div>
        </div>
        <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {gameTabs.map((game) => {
            const active = selectedGame === game;
            return (
              <button
                key={game}
                type="button"
                onClick={() => setSelectedGame(game)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active ? 'bg-coral text-white shadow-glow' : 'bg-sand text-ink'
                }`}
              >
                {gameLabel(game)}
              </button>
            );
          })}
        </div>
      </section>

      {query.error && !query.data ? (
        <section className="rounded-[28px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-glow">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-white/80 p-2">
              <RefreshCcw className="h-4 w-4" />
            </div>
            <div>
              <p className="font-semibold">Leaderboard is warming up</p>
              <p className="mt-2 leading-6">
                The indexed ranking API is unavailable right now, so we are not falling back to slow live-chain scanning.
              </p>
              <button
                type="button"
                onClick={() => query.refetch()}
                className="mt-3 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-sand"
              >
                Retry
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {query.data ? <ReadStatusNote query={query} label="Leaderboard" /> : null}

      {query.isLoading && !leaderboard.length ? (
        <div className="rounded-[28px] border border-dashed border-slate/15 bg-white/70 px-5 py-6 text-sm text-slate/65">
          Ranking completed pacts...
        </div>
      ) : null}

      <TopPlayerCard player={topPlayer} />
      {address ? <MyRankCard player={query.data?.viewerRank} /> : null}

      {!query.isLoading && !leaderboard.length && !query.error ? (
        <EmptyState
          title="No completed pacts yet"
          body="Finish your first pact to enter the leaderboard. Wins, evidence, and streaks will move players up the board."
        />
      ) : null}

      <section className="space-y-3">
        {leaderboard.map((player) => (
          <LeaderboardRow key={player.address} player={player} />
        ))}
      </section>

      {leaderboard.length ? (
        <section className="rounded-[24px] bg-white/75 p-4 text-sm leading-6 text-slate/70 shadow-glow">
          <div className="flex gap-3">
            <div className="rounded-2xl bg-coral/10 p-2 text-coral">
              <Flame className="h-4 w-4" />
            </div>
            <p>
              Balanced XP v1: +20 for completed pacts, +60 for wins, +10 for splits, +10 for evidence, and up to +50 for active win streaks.
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
