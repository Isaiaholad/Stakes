import { useQuery } from '@tanstack/react-query';
import ChallengeCard from '../components/ChallengeCard.jsx';
import ConfigBanner from '../components/ConfigBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ReadStatusNote from '../components/ReadStatusNote.jsx';
import { useProtocolReadiness } from '../hooks/useProtocolReadiness.js';
import { isProtocolConfigured } from '../lib/contracts.js';
import { readOpenPacts } from '../lib/pacts.js';

const explorePactLimit = 18;

export default function JoinPage() {
  const configured = isProtocolConfigured();
  const readiness = useProtocolReadiness();
  const query = useQuery({
    queryKey: ['explore-pacts', explorePactLimit],
    queryFn: () =>
      readOpenPacts('', {
        limit: explorePactLimit,
        preferIndexed: readiness.canRead
      }),
    enabled: configured,
    refetchInterval: 60_000
  });

  if (!configured) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
      </div>
    );
  }

  const openPacts = Array.isArray(query.data) ? query.data : [];
  const isFeedLoading = query.isLoading && !openPacts.length;

  return (
    <div className="space-y-5">
      <ConfigBanner />
      <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
        <p className="font-display text-3xl text-ink">Explore open pacts</p>
        <p className="mt-2 text-sm text-slate/70">
          Public open pacts are available as seen you can also review and join them from there
        </p>
      </section>

      {query.error && !query.data ? (
        <section className="rounded-[28px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-glow">
          <p className="font-semibold">Open pact feed is delayed</p>
          <p className="mt-2">
            StakeWithFriends could not refresh the indexed open-pact feed right now. Try again in a moment.
          </p>
        </section>
      ) : null}

      {query.data ? <ReadStatusNote query={query} label="Open pact feed" /> : null}

      <section className="space-y-3">
        {isFeedLoading ? (
          <div className="rounded-[28px] border border-dashed border-slate/15 bg-white/70 px-5 py-6 text-sm text-slate/65">
            Loading open pacts...
          </div>
        ) : openPacts.length ? (
          openPacts.map((pact) => <ChallengeCard key={pact.id} challenge={pact} />)
        ) : (
          <EmptyState
            title="No open pacts right now"
            body="Public invites will show up here as soon as someone creates one."
          />
        )}
      </section>
    </div>
  );
}
