import { PaneHost } from '../../features/panes/PaneHost';
import { PrsPage } from '../../features/prs/PrsPage';
import { mountPage } from '../../lib/mount';

// The pane host: a review agent's report, and its terminal, open over the page.
mountPage(<><PrsPage /><PaneHost /></>);
