import { Link } from 'react-router-dom';
import { ExternalLink, LogOut, Sparkles, Wallet } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import { useWalletStore } from '../store/useWalletStore.js';
import { circleFaucetUrl } from '../lib/externalLinks.js';

export default function ConnectCard({ compact = false }) {
  const { ready: privyReady, authenticated, user, login, logout } = usePrivy();
  const connectInjected = useWalletStore((state) => state.connectInjected);
  const connector = useWalletStore((state) => state.connector);
  const status = useWalletStore((state) => state.status);
  const error = useWalletStore((state) => state.error);
  const injectedReady = useWalletStore((state) => state.injectedReady);
  const isConnecting = status === 'connecting';
  const privyLabel =
    user?.wallet?.address ||
    user?.email?.address ||
    user?.linkedAccounts?.find((account) => account.type === 'wallet' && account.address)?.address ||
    '';
  const shortPrivyLabel = privyLabel?.startsWith('0x')
    ? `${privyLabel.slice(0, 6)}...${privyLabel.slice(-4)}`
    : privyLabel;

  return (
    <section className={`rounded-[32px] ${compact ? 'bg-white/85 p-5' : 'bg-ink p-6 text-sand'} shadow-glow`}>
      <div className="flex items-start gap-4">
        <div className={`rounded-[24px] p-3 ${compact ? 'bg-ink text-sand' : 'bg-sand/10 text-coral'}`}>
          <Wallet className="h-6 w-6" />
        </div>
        <div>
          <p className={`font-display ${compact ? 'text-2xl text-ink' : 'text-3xl'}`}>Sign in to play</p>
          <p className={`mt-2 text-sm ${compact ? 'text-slate/70' : 'text-sand/70'}`}>
            Privy allows signup with Google account, email, or wallet so chat and uploads stay tied to one identity.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        <button
          type="button"
          onClick={authenticated ? logout : login}
          disabled={!privyReady}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-4 text-base font-semibold ${
            compact ? 'bg-coral text-white' : 'bg-sand text-ink'
          } disabled:opacity-60`}
        >
          {authenticated ? <LogOut className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
          {authenticated ? `Signed in${shortPrivyLabel ? ` as ${shortPrivyLabel}` : ''}` : 'Sign up / log in with Privy'}
        </button>
        <a
          href={circleFaucetUrl}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex w-full items-center justify-center gap-2 rounded-full border px-5 py-4 text-base font-semibold ${
            compact ? 'border-coral/25 bg-coral/10 text-coral' : 'border-sand/25 bg-sand/10 text-sand'
          }`}
        >
          Get Arc Testnet USDC
          <ExternalLink className="h-5 w-5" />
        </a>
        <button
          type="button"
          onClick={connectInjected}
          disabled={!injectedReady || isConnecting}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-4 text-base font-semibold ${
            compact ? 'bg-ink text-sand' : 'bg-coral text-white'
          } disabled:opacity-60`}
        >
          <Wallet className="h-5 w-5" />
          {isConnecting && connector !== 'walletconnect' ? 'Connecting wallet extension...' : 'Connect your wallet extension'}
        </button>
      </div>

      {authenticated ? (
        <p className={`mt-3 text-sm ${compact ? 'text-slate/70' : 'text-sand/70'}`}>
          Privy is active. Pact chat and result uploads will use this signed-in wallet session.
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
