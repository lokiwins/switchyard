/*
 * The graph's data, apart from drawing (public/graph-model.js, tested in node),
 * typed for the page.
 */
import * as model from '../../../../public/graph-model.js';
import type { ElementDefinition } from 'cytoscape';

export interface GraphNode {
  id: string;
  kind: string;
  label: string;
  detail?: string | null;
  group?: string | null;
  uses: number;
  inContext: boolean;
  tokens?: number;
  liveTokens?: number;
}
export interface GraphEdge { source: string; target: string }
export interface SessionGraph {
  title?: string | null;
  cwd?: string | null;
  compactions: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export interface ShareRow { kind: string; name: string; tokens: number; share: number }
export interface Connection { id: string; kind: string; label: string; text: string }

export const KINDS = model.KINDS as Record<string, { name: string; color: string }>;
export const formatTokens = model.formatTokens as (tokens: number) => string;
export const formatShare = model.formatShare as (share: number) => string;
export const layoutSteps = model.layoutSteps as (nodes: number) => number;
export const kindCounts = model.kindCounts as (graph: SessionGraph) => Record<string, number>;
export const nodeConnections = model.nodeConnections as (graph: SessionGraph, id: string) => Connection[];
export const tokenBreakdown = model.tokenBreakdown as (graph: SessionGraph) => { total: number; reported: boolean; session: number; rows: ShareRow[] };
export const toElements = model.toElements as (graph: SessionGraph) => (ElementDefinition & { classes: string[] })[];
export const diffElements = model.diffElements as (current: ElementDefinition[], next: SessionGraph) =>
  { add: ElementDefinition[]; remove: string[]; update: (ElementDefinition & { classes: string[] })[] };
