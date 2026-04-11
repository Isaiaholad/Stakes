export default function LoadingScreen({ label = 'Syncing your wallet and challenge feed...' }) {
  return (
    <div className="app-surface flex min-h-screen items-center justify-center bg-app px-6">
      <div className="w-full max-w-sm rounded-[32px] border border-white/80 bg-white/85 p-8 text-center shadow-glow backdrop-blur">
        <div className="mx-auto mb-6 h-14 w-14 animate-pulse rounded-2xl bg-ink text-2xl font-bold text-sand grid place-items-center">
          SWF
        </div>
        <p className="font-display text-2xl text-ink">StakeWithFriends</p>
        <p className="mt-3 text-sm text-slate/80">{label}</p>
      </div>
    </div>
  );
}
