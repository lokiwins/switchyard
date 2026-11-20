import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toast } from '../components/Toast';
import { queryClient } from './query';
import { followTerminalLook } from './themes';
import '../styles/app.css';

/** Draw a page into #root, with what every page has: the data cache, the toast, and panes in the terminal colours. */
export function mountPage(page: ReactNode): void {
  followTerminalLook();
  const root = document.getElementById('root');
  if (!root) throw new Error('The page has no #root');
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {page}
        <Toast />
      </QueryClientProvider>
    </StrictMode>,
  );
}
