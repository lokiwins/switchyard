import { PaneHost } from '../../features/panes/PaneHost';
import { TasksPage } from '../../features/tasks/TasksPage';
import { mountPage } from '../../lib/mount';

mountPage(<><TasksPage /><PaneHost /></>);
