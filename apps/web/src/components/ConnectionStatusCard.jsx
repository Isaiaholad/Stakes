import { AlertCircle, RefreshCcw, Wifi, WifiOff } from 'lucide-react';
import { getReadableAppError } from '../lib/appErrors.js';

const toneMap = {
  error: {
    shell: 'border-rose-200 bg-rose-50 text-rose-950',
    icon: AlertCircle,
    iconColor: 'text-rose-600',
    button: 'bg-rose-600 text-white'
  },
  warning: {
    shell: 'border-amber-200 bg-amber-50 text-amber-950',
    icon: WifiOff,
    iconColor: 'text-amber-600',
    button: 'bg-amber-500 text-white'
  },
  info: {
    shell: 'border-slate/10 bg-white text-ink',
    icon: Wifi,
    iconColor: 'text-coral',
    button: 'bg-ink text-sand'
  }
};

export default function ConnectionStatusCard({ error, fallbackTitle, onRetry }) {
  const status = getReadableAppError(error, fallbackTitle);
  const appearance = toneMap[status.tone] || toneMap.error;
  const Icon = appearance.icon;

  return (
    <section className={`rounded-[32px] border p-5 shadow-glow ${appearance.shell}`}>
      <div className="flex items-start gap-3">
        <div className={`rounded-2xl bg-white/70 p-3 ${appearance.iconColor}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl">{status.title}</p>
          <p className="mt-2 text-sm leading-6 opacity-85">{status.message}</p>
        </div>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className={`mt-4 inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold ${appearance.button}`}
        >
          <RefreshCcw className="h-4 w-4" />
          Try again
        </button>
      ) : null}
    </section>
  );
}
