import { toast } from '../stores/toast';
import { Button } from './Button';

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
    <Button type="button" variant="icon" title={`Copy: ${title ?? text}`} aria-label={`Copy ${label} command`} onClick={copy}>
      <span className="mr-[3px] opacity-70" aria-hidden="true">⧉</span>
      {label}
    </Button>
  );
}
