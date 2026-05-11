import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Info, X } from 'lucide-react';
import { useToastStore } from '../store/useToastStore.js';

const variantMap = {
  success: {
    icon: CheckCircle2,
    shell: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    iconColor: 'text-emerald-600'
  },
  error: {
    icon: AlertCircle,
    shell: 'border-rose-200 bg-rose-50 text-rose-950',
    iconColor: 'text-rose-600'
  },
  info: {
    icon: Info,
    shell: 'border-slate/10 bg-white text-ink',
    iconColor: 'text-coral'
  }
};

export default function ToastViewport() {
  const toast = useToastStore((state) => state.toast);
  const hideToast = useToastStore((state) => state.hideToast);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      hideToast();
    }, toast.duration || 4500);

    return () => window.clearTimeout(timer);
  }, [hideToast, toast]);

  if (!toast) {
    return null;
  }

  const appearance = variantMap[toast.variant] || variantMap.info;
  const Icon = appearance.icon;
  const hasAction = Boolean(toast.actionHref);
  const shell = hasAction && toast.variant === 'success'
    ? 'border-white/10 bg-[#1d1d20] text-white shadow-[0_24px_80px_rgba(15,23,42,0.35)]'
    : appearance.shell;
  const iconShell = hasAction && toast.variant === 'success'
    ? 'rounded-full bg-emerald-500 p-1 text-white'
    : appearance.iconColor;

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-40 w-[calc(100%-2rem)] max-w-md -translate-x-1/2">
      <div className={`pointer-events-auto rounded-[28px] border px-5 py-5 shadow-glow ${shell}`}>
        <div className="flex items-start gap-4">
          <Icon className={`mt-0.5 h-6 w-6 shrink-0 ${iconShell}`} />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">{toast.title}</p>
            {toast.message ? <p className="mt-2 text-sm leading-5 opacity-85">{toast.message}</p> : null}
            {hasAction ? (
              <a
                href={toast.actionHref}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5 hover:shadow-sm"
              >
                {toast.actionLabel || 'View transaction'}
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
          </div>
          <button
            type="button"
            onClick={hideToast}
            className="rounded-full p-1 opacity-60 transition hover:opacity-100"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
