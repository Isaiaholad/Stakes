import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import ChallengeCard from '../components/ChallengeCard.jsx';
import ConnectionStatusCard from '../components/ConnectionStatusCard.jsx';
import ConfigBanner from '../components/ConfigBanner.jsx';
import ConnectCard from '../components/ConnectCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ReadStatusNote from '../components/ReadStatusNote.jsx';
import StatTile from '../components/StatTile.jsx';
import { useProtocolReadiness } from '../hooks/useProtocolReadiness.js';
import { formatToken } from '../lib/formatters.js';
import { isProtocolConfigured } from '../lib/contracts.js';
import { readAllPacts, readVaultSnapshot } from '../lib/pacts.js';
import { useWalletStore } from '../store/useWalletStore.js';

const recentDashboardPactLimit = 12;

export default function HomePage() {
  const address = useWalletStore((state) => state.address);
  const configured = isProtocolConfigured();
  const readiness = useProtocolReadiness();

  const pactsQuery = useQuery({
    queryKey: ['pacts', address, recentDashboardPactLimit],
    queryFn: () =>
      readAllPacts(address, {
        limit: recentDashboardPactLimit,
        preferIndexed: readiness.canRead
      }),
    enabled: Boolean(address) && configured,
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true
  });

  const vaultQuery = useQuery({
    queryKey: ['vault', address],
    queryFn: () => readVaultSnapshot(address),
    enabled: Boolean(address) && configured,
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true
  });

  if (!configured) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
        <EmptyState
          title="Deploy or configure contracts first"
          body="Once the StakeWithFriends contracts are deployed and their addresses are set in `apps/web/.env`, this dashboard will load on-chain data."
        />
      </div>
    );
  }

  if (!address) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
        <ConnectCard compact />
        <EmptyState
          title="Pacts start with a wallet"
          body="Connect first, deposit USDC into the vault, then create or join a pact."
          action={
            <Link to="/explore" className="rounded-full bg-coral px-4 py-3 text-sm font-semibold text-white">
              Explore open pacts
            </Link>
          }
        />
      </div>
    );
  }

  const hasPactData = Boolean(pactsQuery.data);
  const hasVaultData = Boolean(vaultQuery.data);
  const pacts = pactsQuery.data || [];
  const vault = vaultQuery.data || {
    availableBalance: '0',
    reservedBalance: '0',
    symbol: 'USDC',
    isArbiter: false
  };
  const myPacts = pacts.filter((pact) => pact.participantRole !== 'viewer');
  const urgentPacts = myPacts.filter((pact) => pact.needsAction);
  const activePacts = myPacts.filter((pact) => ['Active', 'Result Submitted', 'Review Period', 'Ready To Finalize'].includes(pact.stage));
  const openPacts = pacts.filter((pact) => pact.stage === 'Open For Join');

  return (
    <div className="space-y-5">
      <ConfigBanner />
      <section className="grid grid-cols-2 gap-3">
        <StatTile label="Vault" value={hasVaultData ? formatToken(vault.availableBalance, vault.symbol) : '...'} />
        <StatTile label="Reserved" value={hasVaultData ? formatToken(vault.reservedBalance, vault.symbol) : '...'} accent="bg-coral text-white" />
        <StatTile label="My pacts" value={hasPactData ? myPacts.length : '...'} accent="bg-white text-ink" />
        <StatTile label="Open feed" value={hasPactData ? openPacts.length : '...'} accent="bg-mint/25 text-emerald-900" />
      </section>

      {((pactsQuery.error && !hasPactData) || (vaultQuery.error && !hasVaultData)) ? (
        <ConnectionStatusCard
          error={pactsQuery.error || vaultQuery.error}
          fallbackTitle="Could not load dashboard"
          onRetry={() => {
            pactsQuery.refetch();
            vaultQuery.refetch();
          }}
        />
      ) : null}

      {hasPactData ? <ReadStatusNote query={pactsQuery} label="Dashboard pact feed" /> : null}
      {hasVaultData ? <ReadStatusNote query={vaultQuery} label="Vault balances" /> : null}

      <section className="rounded-[32px] bg-white/80 p-5 shadow-glow">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-2xl text-ink">Live pacts</p>
            <p className="text-sm text-slate/70">The pacts that already have money on the line and are underway right now.</p>
          </div>
          <Link to="/vault" className="rounded-full bg-sand px-4 py-2 text-sm font-semibold text-ink">
            Fund vault
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {!hasPactData ? (
            <p className="text-sm text-slate/70">Loading active pacts...</p>
          ) : activePacts.length ? (
            activePacts.map((pact) => <ChallengeCard key={pact.id} challenge={pact} />)
          ) : (
            <p className="text-sm text-slate/70">Fund your vault, launch a challenge, or jump into an open pact to get a live match going.</p>
          )}
        </div>
      </section>

      <section className="rounded-[32px] bg-white/80 p-5 shadow-glow">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-2xl text-ink">Needs your action</p>
            <p className="text-sm text-slate/70">Only pacts that still need something from your wallet show up here.</p>
          </div>
          <Link to="/create" className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-sand">
            New pact
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {!hasPactData ? (
            <p className="text-sm text-slate/70">Loading recent pact activity...</p>
          ) : urgentPacts.length ? (
            urgentPacts.map((pact) => <ChallengeCard key={pact.id} challenge={pact} />)
          ) : (
            <EmptyState title="Nothing urgent" />
          )}
        </div>
      </section>
    </div>
  );
}
