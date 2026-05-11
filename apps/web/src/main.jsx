import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App.jsx';
import PrivyWalletBridge from './components/PrivyWalletBridge.jsx';
import { isTransientReadError } from './lib/appErrors.js';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (isTransientReadError(error)) {
          return failureCount < 3;
        }

        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000)
    }
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID || ''}
      config={{
        loginMethods: ['google', 'email', 'wallet'],
        embeddedWallets: {
          createOnLogin: 'users-without-wallets'
        },
        appearance: {
          theme: 'light',
          accentColor: '#ff6b4a',
          logo: '/icons/icon.svg'
        }
      }}
    >
      <PrivyWalletBridge />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </PrivyProvider>
  </React.StrictMode>
);
