import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Flag, Link2, Shield, Sparkles, Trophy, Upload, Wallet } from 'lucide-react';
import ConnectCard from '../components/ConnectCard.jsx';
import EvidenceExamples from '../components/EvidenceExamples.jsx';
import { shortenAddress } from '../lib/formatters.js';
import { dismissOnboarding } from '../lib/onboarding.js';
import { useWalletStore } from '../store/useWalletStore.js';

const steps = [
  {
    title: 'Sign in once',
    body: 'Use Privy or a wallet extension so your pacts, chat, vault, and uploads stay tied to one identity.',
    icon: Sparkles
  },
  {
    title: 'Set your profile',
    body: 'Your wallet and username help friends recognize you before they accept a pact.',
    icon: Shield
  },
  {
    title: 'Fund the USDC vault',
    body: 'Deposit Arc Testnet USDC into your vault so stakes can be reserved before a match starts.',
    icon: Wallet
  },
  {
    title: 'Create or join a pact',
    body: 'Pick the game, stake, match window, and whether it is a private challenge or open invite.',
    icon: Flag
  },
  {
    title: 'Submit match evidence',
    body: 'eFootball uses a clear final-result screenshot. Chess asks both players to submit a verified Chess.com or Lichess game URL copied from the result/share screen.',
    icon: Upload
  },
  {
    title: 'Settle securely',
    body: 'Matching verified results settle automatically. Conflicting verified results move into dispute/admin review.',
    icon: Trophy
  }
];

const checklist = [
  'Sign in with Privy or connect a wallet.',
  'Get Arc Testnet USDC from the faucet.',
  'Deposit USDC into your vault.',
  'Create a pact or browse open pacts.',
  'For eFootball, upload a clean result screenshot after play.',
  'For Chess.com or Lichess, both players copy and submit the shared game URL from the result page.'
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const address = useWalletStore((state) => state.address);

  const handleFinish = () => {
    dismissOnboarding();
    navigate('/');
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[34px] bg-ink p-6 text-sand shadow-glow">
        <p className="inline-flex rounded-full bg-sand/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-coral">
          Quick start
        </p>
        <h1 className="mt-4 font-display text-4xl leading-tight">Play first. Escrow keeps it fair.</h1>
        <p className="mt-3 text-sm leading-6 text-sand/70">
          StakesWithFriends helps competitive players lock USDC, play on external games, submit proof, and settle results with an AI result check.
        </p>
        <div className="mt-5 grid gap-3">
          <Link to="/create" className="rounded-full bg-coral px-5 py-4 text-center text-sm font-semibold text-white">
            Create pact
          </Link>
          <Link to="/explore" className="rounded-full border border-sand/20 px-5 py-4 text-center text-sm font-semibold text-sand">
            Browse open pacts
          </Link>
        </div>
      </section>

      {address ? (
        <section className="rounded-[28px] border border-emerald-200 bg-mint/20 p-5 shadow-glow">
          <p className="text-sm font-semibold text-emerald-900">Wallet ready</p>
          <p className="mt-2 text-sm text-slate/75">
            You are connected as <span className="font-semibold text-ink">{shortenAddress(address)}</span>. Next, fund your vault or start a pact.
          </p>
          <Link to="/vault" className="mt-4 inline-flex rounded-full bg-ink px-4 py-3 text-sm font-semibold text-sand">
            Fund vault
          </Link>
        </section>
      ) : (
        <ConnectCard compact />
      )}

      <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
        <p className="font-display text-3xl text-ink">How the flow works</p>
        <p className="mt-2 text-sm leading-6 text-slate/70">
          The app does not host the match. It holds funds, tracks the pact, and helps verify the final result.
        </p>
        <div className="mt-5 grid gap-3">
          {steps.map((step, index) => {
            const Icon = step.icon;

            return (
              <article key={step.title} className="rounded-[24px] border border-slate/10 bg-sand/70 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-[18px] bg-white p-3 text-coral">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate/45">Step {index + 1}</p>
                    <p className="mt-1 font-semibold text-ink">{step.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate/70">{step.body}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <EvidenceExamples description="These examples are redacted, but they show the kind of final-result screens and result context that make verification easier." />

      <section className="rounded-[32px] border border-amber-200 bg-amber-50/85 p-5 shadow-glow">
        <div className="flex items-start gap-3">
          <div className="rounded-[18px] bg-white p-3 text-amber-700">
            <Link2 className="h-5 w-5" />
          </div>
          <div>
            <p className="font-display text-3xl text-ink">Chess evidence is a game URL</p>
            <p className="mt-2 text-sm leading-6 text-amber-950">
              Chess pacts support Chess.com and Lichess URL verification from both players. After the game ends, each player opens the final result page, taps or clicks the platform Share button, copies the game URL, then pastes it into StakesWithFriends on the pact result page.
            </p>
            <div className="mt-4 grid gap-3 text-sm text-amber-950">
              <div className="rounded-[20px] bg-white/75 px-4 py-3">
                <span className="font-semibold">Chess.com:</span> use the shared game link, for example <span className="font-mono text-xs">chess.com/game/...</span> or <span className="font-mono text-xs">chess.com/game/live/...</span>
              </div>
              <div className="rounded-[20px] bg-white/75 px-4 py-3">
                <span className="font-semibold">Lichess:</span> use the game link, for example <span className="font-mono text-xs">lichess.org/...</span>
              </div>
              <div className="rounded-[20px] bg-white/75 px-4 py-3">
                StakesWithFriends checks locked usernames, locked colors, and pact timing. Matching verified URLs settle automatically; conflicting verified URLs move into dispute/admin review.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
        <p className="font-display text-3xl text-ink">Ready checklist</p>
        <div className="mt-4 space-y-3">
          {checklist.map((item) => (
            <div key={item} className="flex items-start gap-3 rounded-[20px] bg-sand/75 px-4 py-3 text-sm text-slate/75">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-3">
          <button
            type="button"
            onClick={handleFinish}
            className="rounded-full bg-coral px-5 py-4 text-sm font-semibold text-white"
          >
            Finish guide
          </button>
          <div className="grid grid-cols-2 gap-3">
            <Link to="/vault" className="rounded-full bg-sand px-4 py-3 text-center text-sm font-semibold text-ink">
              Fund vault
            </Link>
            <Link to="/explore" className="rounded-full bg-ink px-4 py-3 text-center text-sm font-semibold text-sand">
              Open feed
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
