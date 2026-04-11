import { Suspense, lazy, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import LoadingScreen from './components/LoadingScreen.jsx';
import { useWalletBootstrap } from './hooks/useWalletBootstrap.js';
import AppShell from './layouts/AppShell.jsx';

const LandingPage = lazy(() => import('./pages/LoginPage.jsx'));
const HomePage = lazy(() => import('./pages/HomePage.jsx'));
const CreatePactPage = lazy(() => import('./pages/CreateChallengePage.jsx'));
const PactPage = lazy(() => import('./pages/ChallengePage.jsx'));
const ExplorePage = lazy(() => import('./pages/JoinPage.jsx'));
const VaultPage = lazy(() => import('./pages/WalletPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'));

function isLocalDevHost() {
  if (typeof window === 'undefined') {
    return false;
  }

  return ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function LocalhostCacheReset() {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const hasServiceWorker = 'serviceWorker' in navigator;
    const hasCacheStorage = 'caches' in window;
    if (!hasServiceWorker && !hasCacheStorage) {
      return undefined;
    }

    let cancelled = false;

    async function resetLocalCaches() {
      const registrations = hasServiceWorker ? await navigator.serviceWorker.getRegistrations() : [];
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));

      if (hasCacheStorage) {
        const cacheKeys = await window.caches.keys();
        await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey).catch(() => false)));
      }

      if (cancelled) {
        return;
      }

      const reloadKey = 'stakewithfriends-localhost-cache-reset-v1';
      if (registrations.length > 0 && !window.sessionStorage.getItem(reloadKey)) {
        window.sessionStorage.setItem(reloadKey, '1');
        window.location.reload();
      }
    }

    resetLocalCaches().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

function UpdateBanner() {
  const { needRefresh, updateServiceWorker } = useRegisterSW();

  if (!needRefresh[0]) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => updateServiceWorker(true)}
      className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-full bg-coral px-4 py-3 text-sm font-semibold text-white shadow-glow"
    >
      New version available. Tap to refresh.
    </button>
  );
}

export default function App() {
  useWalletBootstrap();
  const localhost = isLocalDevHost();

  return (
    <>
      {localhost ? <LocalhostCacheReset /> : <UpdateBanner />}
      <Suspense fallback={<LoadingScreen label="Opening your on-chain pact board..." />}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="create" element={<CreatePactPage />} />
            <Route path="pact/:id" element={<PactPage />} />
            <Route path="explore" element={<ExplorePage />} />
            <Route path="vault" element={<VaultPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="connect" element={<LandingPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
