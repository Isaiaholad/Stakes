import ChallengeCard from '../../components/ChallengeCard.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import AdminPactCard from './AdminPactCard.jsx';
import AdminSectionCard from './AdminSectionCard.jsx';

export default function AdminPactSection({
  title,
  body,
  hasPactData,
  pacts,
  emptyTitle,
  emptyBody,
  renderMode = 'challenge',
  searchValue = '',
  protocolSymbol = 'USDC',
  resolutionRefs = {},
  setResolutionRefForPact,
  settleMutation,
  mismatchDisputeMutation,
  resolveWinnerMutation,
  resolveSplitMutation,
  getDisputeTiming
}) {
  return (
    <AdminSectionCard title={title} body={body}>
      {!hasPactData ? (
        <p className="text-sm text-slate/70">Loading {title.toLowerCase()}...</p>
      ) : pacts.length ? (
        pacts.map((pact) =>
          renderMode === 'admin' ? (
            <AdminPactCard
              key={`admin-${pact.id}`}
              pact={pact}
              protocolSymbol={protocolSymbol}
              resolutionRef={resolutionRefs[pact.id] || ''}
              setResolutionRefForPact={setResolutionRefForPact}
              settleMutation={settleMutation}
              mismatchDisputeMutation={mismatchDisputeMutation}
              resolveWinnerMutation={resolveWinnerMutation}
              resolveSplitMutation={resolveSplitMutation}
              getDisputeTiming={getDisputeTiming}
            />
          ) : (
            <ChallengeCard key={`${renderMode}-${pact.id}`} challenge={pact} />
          )
        )
      ) : (
        <EmptyState
          title={emptyTitle}
          body={searchValue ? 'Try a different pact ID, username, wallet, title, stage, or status.' : emptyBody}
        />
      )}
    </AdminSectionCard>
  );
}
