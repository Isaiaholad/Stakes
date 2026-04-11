import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet } from 'react-router-dom';
import { LogOut, RefreshCcw, Shield } from 'lucide-react';
import BottomNav from '../components/BottomNav.jsx';
import ToastViewport from '../components/ToastViewport.jsx';
import { useLivePactInvalidation } from '../hooks/useLivePactInvalidation.js';
import { hasUsernameRegistryConfigured, isProtocolConfigured } from '../lib/contracts.js';
import { readProtocolSnapshot, readUsernameByAddress } from '../lib/pacts.js';
import { useToastStore } from '../store/useToastStore.js';
import { useWalletStore } from '../store/useWalletStore.js';

export default function AppShell() {
  const address = useWalletStore((state) => state.address);
  const disconnect = useWalletStore((state) => state.disconnect);
  const showToast = useToastStore((state) => state.showToast);
  const queryClient = useQueryClient();
  const [isResettingCache, setIsResettingCache] = useState(false);
  const configured = isProtocolConfigured();
  const usernameRegistryConfigured = hasUsernameRegistryConfigured();
  useLivePactInvalidation();
  const protocolQuery = useQuery({
    queryKey: ['protocol-role', address],
    queryFn: () => readProtocolSnapshot(address),
    enabled: Boolean(address) && configured,
    staleTime: 60_000
  });
  const isAdmin = Boolean(protocolQuery.data?.isAdmin || protocolQuery.data?.isArbiter);
  const usernameQuery = useQuery({
    queryKey: ['username', address],
    queryFn: () => readUsernameByAddress(address),
    enabled: Boolean(address) && configured && usernameRegistryConfigured
  });
  const connectedLabel = address
    ? usernameQuery.data
      ? `@${usernameQuery.data} is connected.`
      : 'Wallet connected.'
    : 'Connect a wallet to start a pact.';

  const handleResetAppCache = async () => {
    if (isResettingCache) {
      return;
    }

    setIsResettingCache(true);

    try {
      await queryClient.cancelQueries();
      queryClient.clear();

      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }

      if (typeof window !== 'undefined' && 'caches' in window) {
        const cacheKeys = await window.caches.keys();
        await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)));
      }

      showToast({
        variant: 'success',
        title: 'Resetting app cache',
        message: 'Cached app files were cleared. Reloading StakeWithFriends now.',
        duration: 1200
      });
      window.setTimeout(() => {
        window.location.reload();
      }, 700);
    } catch (error) {
      showToast({
        variant: 'error',
        title: 'Reset failed',
        message: error?.message || 'Could not clear the app cache right now.'
      });
      setIsResettingCache(false);
    }
  };

  return (
    <div className="app-surface min-h-screen bg-app pb-28">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 pb-4 pt-5">
        <div>
          <Link to="/" className="font-display text-2xl text-ink">
            StakeWithFriends
          </Link>
          <p className="text-sm text-slate/70">{connectedLabel}</p>
          {isAdmin ? (
            <Link
              to="/admin"
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-sand"
            >
              <Shield className="h-3.5 w-3.5" />
              Admin
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetAppCache}
            disabled={isResettingCache}
            className="rounded-full border border-slate/10 bg-white/80 p-3 text-slate/70 shadow-sm"
            aria-label="Reset app cache"
            title="Reset app cache"
          >
            <RefreshCcw className={`h-4 w-4 ${isResettingCache ? 'animate-spin' : ''}`} />
          </button>
          {address ? (
            <button
              type="button"
              onClick={disconnect}
              className="rounded-full border border-slate/10 bg-white/80 p-3 text-slate/70 shadow-sm"
              aria-label="Disconnect wallet"
              title="Disconnect wallet"
            >
              <LogOut className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-md px-4">
        <Outlet />
      </main>
      <ToastViewport />
      <BottomNav />
    </div>
  );
}
