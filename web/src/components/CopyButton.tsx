import { toast } from '../stores/toast';

const SHOWN_CHARS = 60;

/** Copies a command; marked with ⧉ so it reads as "copy", not "do". */
export function CopyButton({ label, text, title }: { label: string; text: string; title?: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied: ${text.length > SHOWN_CHARS ? `${text.slice(0, SHOWN_CHARS - 3)}…` : text}`);
    } catch {
      toast('Clipboard unavailable');
    }
  };
  return (
    <button type="button" className="btn btn-icon" title={`Copy: ${title ?? text}`} aria-label={`Copy ${label} command`} onClick={copy}>
      <span className="copy-icon" aria-hidden="true">⧉</span>
      {label}
    </button>
  );
}
