import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';

import { router } from './router';
import './index.css';

/**
 * `refetchOnWindowFocus` is left on deliberately. It is what answers the brief's
 * "a folder is deleted while someone is viewing it" case: returning to the tab refetches,
 * the API answers `410 Gone`, and the client renders the deleted state instead of a stale
 * tree (decision #11).
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element in index.html.');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
