import { ShieldCheck, Smartphone, Trophy } from 'lucide-react';
import ConnectCard from '../components/ConnectCard.jsx';
import ConfigBanner from '../components/ConfigBanner.jsx';

const points = [
  {
    icon: Trophy,
    title: 'Simple on-chain flow',
    body: 'Fund vault, create pact, join, declare winner, and resolve on-chain.'
  },
  {
    icon: Smartphone,
    title: 'Mobile and QR onboarding',
    body: 'Use an injected wallet in-browser or connect from a mobile wallet with WalletConnect.'
  },
  {
    icon: ShieldCheck,
    title: 'Wallet-native auth',
    body: 'Connect once and use your wallet as identity. Pact state, declarations, and resolution all stay on-chain.'
  }
];

export default function LoginPage() {
  return (
    <div className="space-y-5">
      <ConfigBanner />
      <ConnectCard />

      <div className="grid gap-3">
        {points.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-[28px] border border-white/80 bg-white/85 p-5 shadow-glow">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-coral/12 p-3 text-coral">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-display text-lg text-ink">{title}</p>
                <p className="mt-1 text-sm text-slate/75">{body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
