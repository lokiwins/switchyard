import { queryClient } from './query';

/** Something changed on the server: everything the page shows is looked at again now, rather than at its next poll. */
export const announceChange = (): Promise<void> => queryClient.invalidateQueries();
