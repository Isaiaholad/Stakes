import { Link } from 'react-router-dom';
import ConfigBanner from '../components/ConfigBanner.jsx';
import ConnectCard from '../components/ConnectCard.jsx';
import ConnectionStatusCard from '../components/ConnectionStatusCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ReadStatusNote from '../components/ReadStatusNote.jsx';
import AdminPactSection from '../features/admin/AdminPactSection.jsx';
import {
  AdminHeroCard,
  AdminProtocolStatsCard,
  AdminSearchCard,
  AdminStatusBreakdownCard,
  AdminTopStats
} from '../features/admin/AdminOverviewCards.jsx';
import { useAdminPage } from '../features/admin/useAdminPage.js';

export default function AdminPage() {
  const vm = useAdminPage();

  if (!vm.configured) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
        <EmptyState
          title="Admin tools need configured contracts"
          body="Set the deployed contract addresses first, then reconnect the admin wallet."
        />
      </div>
    );
  }

  if (!vm.address) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
        <ConnectCard compact />
        <EmptyState
          title="Connect an admin or arbiter wallet"
          body="This screen unlocks for wallets that currently hold the protocol's on-chain admin or arbiter role."
        />
      </div>
    );
  }

  if (vm.protocolQuery.isLoading && !vm.protocolQuery.data) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
        <EmptyState
          title="Checking admin access"
          body="Reading your live protocol roles from chain before unlocking the admin dashboard."
        />
      </div>
    );
  }

  if (vm.protocolQuery.error && !vm.protocolQuery.data) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
        <ConnectionStatusCard
          error={vm.protocolQuery.error}
          fallbackTitle="Could not verify admin access"
          onRetry={() => vm.protocolQuery.refetch()}
        />
      </div>
    );
  }

  if (!vm.hasAdminAccess) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
        <EmptyState
          title="Admin access restricted"
          body="This wallet does not currently hold the protocol's admin or arbiter role."
          action={
            <Link to="/" className="rounded-full bg-ink px-4 py-3 text-sm font-semibold text-sand">
              Return home
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ConfigBanner />

      {(vm.pactsQuery.error && !vm.hasPactData) || (vm.protocolQuery.error && !vm.hasProtocolData) ? (
        <ConnectionStatusCard
          error={vm.pactsQuery.error || vm.protocolQuery.error}
          fallbackTitle="Could not load admin tools"
          onRetry={() => {
            vm.pactsQuery.refetch();
            vm.protocolQuery.refetch();
          }}
        />
      ) : null}

      {vm.hasPactData ? <ReadStatusNote query={vm.pactsQuery} label="Admin pacts" /> : null}
      {vm.hasProtocolData ? <ReadStatusNote query={vm.protocolQuery} label="Protocol roles" /> : null}

      <AdminHeroCard />

      <AdminTopStats
        hasProtocolData={vm.hasProtocolData}
        hasPactData={vm.hasPactData}
        protocol={vm.protocol}
        searchedPacts={vm.searchedPacts}
        unresolvedCount={vm.unresolvedPacts.length}
        disputeCount={vm.groups.disputes.length}
      />

      <AdminProtocolStatsCard
        hasPactData={vm.hasPactData}
        hasProtocolData={vm.hasProtocolData}
        protocol={vm.protocol}
        protocolExposure={vm.protocolExposure}
        groups={vm.groups}
        creatorProofCount={vm.creatorProofCount}
        counterpartyProofCount={vm.counterpartyProofCount}
        disputedCount={vm.disputedPacts.length}
        address={vm.address}
      />

      <AdminStatusBreakdownCard hasPactData={vm.hasPactData} stageCounts={vm.stageCounts} />
      <AdminSearchCard searchValue={vm.searchValue} setSearchValue={vm.setSearchValue} />

      <AdminPactSection
        title="Unresolved: Disputes and conflicts"
        body="Disputed pacts and mismatched declarations land here first, with inline dispute and resolution actions."
        hasPactData={vm.hasPactData}
        pacts={vm.groups.disputes}
        emptyTitle="No disputes or conflicts"
        emptyBody="Disputed pacts and conflicting declarations will appear here."
        renderMode="admin"
        searchValue={vm.searchValue}
        protocolSymbol={vm.protocol.symbol || 'USDC'}
        resolutionRefs={vm.resolutionRefs}
        setResolutionRefForPact={vm.setResolutionRefForPact}
        settleMutation={vm.settleMutation}
        mismatchDisputeMutation={vm.mismatchDisputeMutation}
        resolveWinnerMutation={vm.resolveWinnerMutation}
        resolveSplitMutation={vm.resolveSplitMutation}
        getDisputeTiming={vm.getDisputeTiming}
      />

      <AdminPactSection
        title="Unresolved: Lone settlement"
        body="Single declarations, expired result windows, and timed outcomes that still need settlement appear here."
        hasPactData={vm.hasPactData}
        pacts={vm.groups.loneSettlements}
        emptyTitle="No timed settlements pending"
        emptyBody="Single-declaration and no-declaration outcomes will appear here when they need action."
        renderMode="admin"
        searchValue={vm.searchValue}
        protocolSymbol={vm.protocol.symbol || 'USDC'}
        resolutionRefs={vm.resolutionRefs}
        setResolutionRefForPact={vm.setResolutionRefForPact}
        settleMutation={vm.settleMutation}
        mismatchDisputeMutation={vm.mismatchDisputeMutation}
        resolveWinnerMutation={vm.resolveWinnerMutation}
        resolveSplitMutation={vm.resolveSplitMutation}
        getDisputeTiming={vm.getDisputeTiming}
      />

      <AdminPactSection
        title="Unresolved: Active pacts"
        body="Joined pacts that are still live or currently inside the declaration flow appear here."
        hasPactData={vm.hasPactData}
        pacts={vm.groups.active}
        emptyTitle="No active pacts"
        emptyBody="Live events and open declaration windows will appear here."
        renderMode="active"
      />

      <AdminPactSection
        title="Other states: Pending"
        body="Open invites, pending acceptances, and acceptance timeouts appear here."
        hasPactData={vm.hasPactData}
        pacts={vm.groups.pending}
        emptyTitle="No pending pacts"
        emptyBody="Open and unaccepted pacts will appear here."
        renderMode="pending"
      />

      <AdminPactSection
        title="Other states: Resolved"
        body="Pacts that have already paid out and closed are grouped here."
        hasPactData={vm.hasPactData}
        pacts={vm.groups.resolved}
        emptyTitle="No resolved pacts yet"
        emptyBody="Resolved pacts will appear here once results have been settled on-chain."
        renderMode="resolved"
      />

      <AdminPactSection
        title="Other states: Cancelled"
        body="Cancelled and expired pacts are grouped here for auditability."
        hasPactData={vm.hasPactData}
        pacts={vm.groups.cancelled}
        emptyTitle="No cancelled pacts"
        emptyBody="Cancelled pacts will appear here."
        renderMode="cancelled"
      />

      <AdminPactSection
        title="All scanned pacts"
        body="A full feed of every pact returned to the admin dashboard, newest first."
        hasPactData={vm.hasPactData}
        pacts={vm.searchedPacts}
        emptyTitle="No pacts found"
        emptyBody="No pact records are available yet."
        renderMode="all"
        searchValue={vm.searchValue}
      />

      {vm.groups.other.length ? (
        <AdminPactSection
          title="Other states: Miscellaneous"
          body="Any pact state that does not fit the main buckets stays visible here instead of disappearing."
          hasPactData={vm.hasPactData}
          pacts={vm.groups.other}
          emptyTitle="No miscellaneous states"
          emptyBody="Miscellaneous pact states will appear here."
          renderMode="other"
        />
      ) : null}
    </div>
  );
}
