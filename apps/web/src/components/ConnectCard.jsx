import { Link } from 'react-router-dom';
import { QrCode, Wallet } from 'lucide-react';
import { useWalletStore } from '../store/useWalletStore.js';

export default function ConnectCard({ compact = false }) {
  const connectInjected = useWalletStore((state) => state.connectInjected);
  const connectWalletConnect = useWalletStore((state) => state.connectWalletConnect);
  const connector = useWalletStore((state) => state.connector);
  const status = useWalletStore((state) => state.status);
  const error = useWalletStore((state) => state.error);
  const providerReady = useWalletStore((state) => state.providerReady);
  const injectedReady = useWalletStore((state) => state.injectedReady);
  const walletConnectReady = useWalletStore((state) => state.walletConnectReady);
  const isConnecting = status === 'connecting';

  return (
    <section className={`rounded-[32px] ${compact ? 'bg-white/85 p-5' : 'bg-ink p-6 text-sand'} shadow-glow`}>
      <div className="flex items-start gap-4">
        <div className={`rounded-[24px] p-3 ${compact ? 'bg-ink text-sand' : 'bg-sand/10 text-coral'}`}>
          <Wallet className="h-6 w-6" />
        </div>
        <div>
          <p className={`font-display ${compact ? 'text-2xl text-ink' : 'text-3xl'}`}>Connect a Web3 wallet</p>
          <p className={`mt-2 text-sm ${compact ? 'text-slate/70' : 'text-sand/70'}`}>
            StakeWithFriends uses direct wallet auth and a simple on-chain escrow flow.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        <button
          type="button"
          onClick={connectInjected}
          disabled={!injectedReady || isConnecting}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-4 text-base font-semibold ${
            compact ? 'bg-ink text-sand' : 'bg-coral text-white'
          } disabled:opacity-60`}
        >
          <Wallet className="h-5 w-5" />
          {isConnecting && connector !== 'walletconnect' ? 'Connecting browser wallet...' : 'Browser wallet'}
        </button>
        <button
          type="button"
          onClick={connectWalletConnect}
          disabled={!walletConnectReady || isConnecting}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-full border px-5 py-4 text-base font-semibold ${
            compact ? 'border-ink/10 bg-white text-ink' : 'border-white/20 bg-white/10 text-white'
          } disabled:opacity-60`}
        >
          <QrCode className="h-5 w-5" />
          {isConnecting && connector === 'walletconnect' ? 'Opening WalletConnect...' : 'WalletConnect QR'}
        </button>
      </div>

      {!providerReady ? (
        <p className={`mt-3 text-sm ${compact ? 'text-slate/70' : 'text-sand/70'}`}>
          No wallet route is ready yet. Install an injected wallet or add `VITE_WALLETCONNECT_PROJECT_ID` for QR-based connections.
        </p>
      ) : null}
      {walletConnectReady ? (
        <p className={`mt-3 text-sm ${compact ? 'text-slate/70' : 'text-sand/70'}`}>
          WalletConnect lets you scan from a mobile wallet instead of opening this PWA inside one.
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-rose-500">{error}</p> : null}
      {!compact ? (
        <Link to="/explore" className="mt-4 inline-block text-sm text-sand/80 underline underline-offset-4">
          Browse open pacts first
        </Link>
      ) : null}
    </section>
  );
}
