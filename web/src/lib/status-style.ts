import type { CSSProperties } from 'react';

type StatusStyle = CSSProperties & { '--status'?: string };

/**
 * A tracker status's colour, for a pill to draw itself in. React sets it
 * through the style object, which the page's CSP allows, unlike a style attribute.
 */
export const statusStyle = (color?: string | null): StatusStyle | undefined => (color ? { '--status': color } : undefined);
