import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toast } from '../../components/Toast';
import { AgentsPage } from '../../features/agents/AgentsPage';
import { PaneHost } from '../../features/panes/PaneHost';
import { queryClient } from '../../lib/query';
import { followTerminalLook } from '../../lib/themes';
import '../../styles/app.css';

// The glass panes take the terminal colours, now and as they change.
followTerminalLook();

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AgentsPage />
      <PaneHost />
      <Toast />
    </QueryClientProvider>
  </StrictMode>,
);
