import type { ReactNode } from 'react';

/** One of a page's panels: a heading, what goes beside it, then its body. `id` names its heading, for the panel's label. */
export function Panel({ id, title, head, hidden, panelId, className, children }: {
  id: string;
  title: string;
  head?: ReactNode;
  hidden?: boolean;
  panelId?: string;
  /** More classes for the panel, e.g. a page's own layout. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className ? `panel ${className}` : 'panel'} id={panelId} aria-labelledby={id} hidden={hidden}>
      <div className="panel-head">
        <h2 id={id}>{title}</h2>
        {head}
      </div>
      {children}
    </section>
  );
}
