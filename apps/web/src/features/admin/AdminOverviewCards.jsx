import { Shield } from 'lucide-react';
import StatTile from '../../components/StatTile.jsx';
import { formatToken, shortenAddress } from '../../lib/formatters.js';
import AdminSectionCard from './AdminSectionCard.jsx';

export function AdminHeroCard() {
  return (
    <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
      <div className="flex items-start gap-3">
        <div className="rounded-[22px] bg-ink p-3 text-sand">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate/50">Admin</p>
          <h1 className="mt-2 font-display text-3xl text-ink">Protocol control</h1>
          <p className="mt-2 text-sm text-slate/70">
            Every scanned pact is listed by state here. Unresolved pacts are grouped first, and admin or arbiter actions can be completed inline.
          </p>
        </div>
      </div>
    </section>
  );
}

export function AdminTopStats({ hasProtocolData, hasPactData, protocol, searchedPacts, unresolvedCount, disputeCount }) {
  return (
    <section className="grid grid-cols-2 gap-3">
      <StatTile label="Protocol" value={hasProtocolData ? (protocol.paused ? 'Paused' : 'Live') : '...'} />
      <StatTile label="All pacts" value={hasPactData ? searchedPacts.length : '...'} accent="bg-white text-ink" />
      <StatTile label="Unresolved" value={hasPactData ? unresolvedCount : '...'} accent="bg-mint/25 text-emerald-900" />
      <StatTile label="Disputes" value={hasPactData ? disputeCount : '...'} accent="bg-coral text-white" />
    </section>
  );
}

export function AdminProtocolStatsCard({
  hasPactData,
  hasProtocolData,
  protocol,
  protocolExposure,
  groups,
  creatorProofCount,
  counterpartyProofCount,
  disputedCount,
  address
}) {
  return (
    <AdminSectionCard title="Protocol stats" body="A compact live snapshot of the pact system this admin wallet is supervising.">
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Exposure" value={hasPactData ? formatToken(protocolExposure, protocol.symbol || 'USDC') : '...'} accent="bg-ink text-sand" />
        <StatTile label="Active" value={hasPactData ? groups.active.length : '...'} accent="bg-mint/25 text-emerald-900" />
        <StatTile label="Lone settlement" value={hasPactData ? groups.loneSettlements.length : '...'} accent="bg-sand text-ink" />
        <StatTile label="Pending" value={hasPactData ? groups.pending.length : '...'} accent="bg-sand text-ink" />
        <StatTile label="Resolved" value={hasPactData ? groups.resolved.length : '...'} accent="bg-coral text-white" />
        <StatTile label="Cancelled" value={hasPactData ? groups.cancelled.length : '...'} accent="bg-white text-ink" />
      </div>
      <div className="grid gap-3">
        <div className="rounded-[24px] border border-slate/10 bg-sand/65 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate/55">Dispute proof coverage</p>
          <p className="mt-2 text-sm text-slate/75">
            Creator proofs: <strong className="text-ink">{hasPactData ? creatorProofCount : '...'}</strong> of{' '}
            <strong className="text-ink">{hasPactData ? disputedCount : '...'}</strong>
          </p>
          <p className="mt-1 text-sm text-slate/75">
            Counterparty proofs: <strong className="text-ink">{hasPactData ? counterpartyProofCount : '...'}</strong> of{' '}
            <strong className="text-ink">{hasPactData ? disputedCount : '...'}</strong>
          </p>
        </div>
        <div className="rounded-[24px] border border-slate/10 bg-sand/65 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate/55">Connected admin</p>
          <p className="mt-2 text-sm font-semibold text-ink">{shortenAddress(address)}</p>
          <p className="mt-1 text-sm text-slate/70">
            {hasProtocolData
              ? `Role status: ${
                  protocol.isAdmin ? 'Admin connected' : protocol.isArbiter ? 'Arbiter connected' : 'Role missing'
                }`
              : 'Checking role access...'}
          </p>
        </div>
      </div>
    </AdminSectionCard>
  );
}

export function AdminStatusBreakdownCard({ hasPactData, stageCounts }) {
  return (
    <AdminSectionCard title="All pact statuses" body="Every scanned pact is counted here by its current stage.">
      <div className="flex flex-wrap gap-2">
        {hasPactData ? (
          stageCounts.length ? (
            stageCounts.map(([stage, count]) => (
              <div key={stage} className="rounded-full border border-slate/10 bg-sand px-3 py-2 text-sm text-ink">
                <span className="font-semibold">{stage}</span>
                <span className="ml-2 text-slate/60">{count}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate/70">No pact status data yet.</p>
          )
        ) : (
          <p className="text-sm text-slate/70">Loading pact status breakdown...</p>
        )}
      </div>
    </AdminSectionCard>
  );
}

export function AdminSearchCard({ searchValue, setSearchValue }) {
  return (
    <section className="rounded-[32px] bg-white/80 p-5 shadow-glow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-display text-2xl text-ink">Find pacts</p>
          <p className="text-sm text-slate/70">Search by pact ID, title, username, wallet, raw status, or stage.</p>
        </div>
        <label className="block sm:w-72">
          <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate/55">Search</span>
          <input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Pact ID, title, stage, or wallet"
            className="w-full rounded-[22px] border border-slate/10 bg-sand px-4 py-3 text-sm outline-none placeholder:text-slate/40"
          />
        </label>
      </div>
    </section>
  );
}
