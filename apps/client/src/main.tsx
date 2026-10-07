/**
 * React Client Application - Main Entry Point
 * Modern Kayak-like travel booking interface
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import App from './App';
import RootErrorBoundary from './components/RootErrorBoundary';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
    },
  },
});

const routerMode = (import.meta.env.VITE_ROUTER_MODE as string | undefined)?.toLowerCase();
const useHashRouter = routerMode === 'hash';
const baseName = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/';

// Boot instrumentation to help diagnose blank screen issues
console.log('[client] boot start');
window.addEventListener('error', (e) => {
  console.error('[global error]', e.error || e.message || e);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled rejection]', e.reason);
});

const container = document.getElementById('root');
if (!container) {
  console.error('[client] root element not found');
  throw new Error('Failed to find the root element');
}
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {useHashRouter ? (
        <HashRouter>
          <RootErrorBoundary>
            <App />
          </RootErrorBoundary>
        </HashRouter>
      ) : (
        <BrowserRouter basename={baseName === '/' ? undefined : baseName}>
          <RootErrorBoundary>
            <App />
          </RootErrorBoundary>
        </BrowserRouter>
      )}
    </QueryClientProvider>
  </React.StrictMode>
);
console.log('[client] render invoked');
