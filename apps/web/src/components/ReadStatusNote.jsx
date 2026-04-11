import { Activity, Clock3, RefreshCcw, WifiOff } from 'lucide-react';
import { formatRelative } from '../lib/formatters.js';

const appearanceByTone = {
  neutral: 'border-slate/10 bg-white/75 text-slate/75',
  live: 'border-emerald-200 bg-mint/16 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-950'
};

function getStatus(query, label) {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const readSource = query.data?.__readMeta?.source || 'indexed';

  if (!online) {
    return {
      tone: 'warning',
      Icon: WifiOff,
      title: `${label} unavailable offline`,
      message: 'Your device appears to be offline, so StakeWithFriends cannot confirm fresh chain-backed reads right now.'
    };
  }

  if (query.isLoading && !query.data) {
    return {
      tone: 'neutral',
      Icon: Clock3,
      title: `${label} loading`,
      message:
        readSource === 'chain'
          ? 'Fetching a live direct-from-chain view of this data now.'
          : 'Fetching the latest indexed view of this data now.'
    };
  }

  if (query.error && query.data) {
    return {
      tone: 'warning',
      Icon: RefreshCcw,
      title: `${label} delayed`,
      message:
        readSource === 'chain'
          ? 'Showing the last successful direct chain snapshot while the app retries a fresher read in the background.'
          : 'Showing the last successful snapshot while the app retries a live refresh in the background.'
    };
  }

  if (query.isFetching && query.data) {
    return {
      tone: 'neutral',
      Icon: RefreshCcw,
      title: `${label} refreshing`,
      message:
        readSource === 'chain'
          ? 'You are seeing a recent direct chain snapshot while StakeWithFriends checks for a newer live update.'
          : 'You are seeing a recent snapshot while StakeWithFriends checks for a newer live update.'
    };
  }

  return {
    tone: 'live',
    Icon: Activity,
    title: `${label} live`,
    message: query.dataUpdatedAt
      ? readSource === 'chain'
        ? `Last refreshed ${formatRelative(query.dataUpdatedAt)} directly from chain while the indexed model catches up.`
        : `Last refreshed ${formatRelative(query.dataUpdatedAt)} from the indexed, chain-backed read model.`
      : readSource === 'chain'
        ? 'This view is reading directly from chain while the indexed model catches up.'
        : 'This view is synced from the indexed, chain-backed read model.'
  };
}

export default function ReadStatusNote({ query, label = 'Data' }) {
  if (!query) {
    return null;
  }

  const status = getStatus(query, label);
  const Icon = status.Icon;

  return (
    <div className={`rounded-[22px] border px-4 py-3 text-sm shadow-glow ${appearanceByTone[status.tone] || appearanceByTone.neutral}`}>
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-white/70 p-2">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-ink">{status.title}</p>
          <p className="mt-1 leading-6 opacity-85">{status.message}</p>
        </div>
      </div>
    </div>
  );
}
