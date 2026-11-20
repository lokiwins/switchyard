import type { StylesheetJson } from 'cytoscape';
import { KINDS } from './model';

/*
 * Cytoscape draws on a canvas, so its colours are read from the page's tokens
 * (and again when the theme changes). It only reads hex, rgb() and hsl(), and
 * themes use oklch(): a one-pixel canvas converts them.
 */

let probe: CanvasRenderingContext2D | null = null;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A colour token as rgb() or rgba(), whatever syntax the theme wrote it in. */
function rgbOf(name: string): string {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!probe) return css(name);
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = css(name);
  probe.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = probe.getImageData(0, 0, 1, 1).data;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

export function graphStyle(): StylesheetJson {
  const kindStyles = Object.entries(KINDS).map(([kind, { color }]) => ({ selector: `node.${kind}`, style: { 'background-color': rgbOf(color) } }));
  return [
    {
      selector: 'node',
      style: {
        width: 'data(size)', height: 'data(size)', label: 'data(label)',
        'font-size': 10, 'min-zoomed-font-size': 7, color: rgbOf('--gray-700'),
        'text-valign': 'bottom', 'text-margin-y': 4, 'text-wrap': 'ellipsis', 'text-max-width': '160',
        'border-width': 1, 'border-color': rgbOf('--surface'),
      },
    },
    ...kindStyles,
    { selector: 'node.session', style: { shape: 'round-rectangle', 'font-weight': 700, 'font-size': 12 } },
    { selector: 'node.compaction', style: { shape: 'diamond' } },
    { selector: 'node.prompt', style: { shape: 'round-rectangle' } },
    { selector: 'node.out-of-context', style: { opacity: 0.35 } },
    { selector: 'edge', style: { width: 'mapData(count, 1, 20, 1, 4)', 'line-color': rgbOf('--gray-200'), 'curve-style': 'haystack', opacity: 0.8 } },
    {
      selector: 'edge.next',
      style: { width: 2, 'line-color': rgbOf('--graph-prompt'), 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'target-arrow-color': rgbOf('--graph-prompt') },
    },
    { selector: 'edge.edit, edge.write', style: { 'line-color': rgbOf('--graph-file') } },
    { selector: '.faded', style: { opacity: 0.12 } },
    { selector: 'node:selected', style: { 'border-width': 3, 'border-color': rgbOf('--accent') } },
    { selector: '.kind-hidden', style: { display: 'none' } },
  ];
}
