import type { Capabilities } from '../lib/types';
import { buttonClass } from './Button';

const EDITOR_LABELS: Record<string, string> = { vscode: 'VS Code', 'vscode-insiders': 'VS Code Insiders', cursor: 'Cursor', windsurf: 'Windsurf' };

/** Open a folder in the configured editor: a plain link, handled by the editor's URL scheme. */
export function EditorLink({ path, caps }: { path: string; caps: Capabilities | undefined }) {
  const scheme = caps?.editorScheme;
  if (!scheme) return null;
  const url = `${scheme}://file${path.split('/').map(encodeURIComponent).join('/')}`;
  return <a className={buttonClass({ variant: 'action' })} href={url} title={`Open in ${EDITOR_LABELS[scheme] ?? scheme}`}>Code</a>;
}
