import type { MapNode } from '../types/map';
import { meanEmbedding, rankMatches } from './visionMatcher';

export interface ConfusedPair {
  /** Node whose held-out view was being recognised. */
  expectedId: string;
  /** Node that won instead. */
  predictedId: string;
  count: number;
}

export interface ConfusabilityReport {
  /** Held-out views that were tried. */
  total: number;
  /** Share of them recognised as their own node, 0–1; 0 when `total` is 0. */
  accuracy: number;
  /** Average lead in percent points of the winner over the runner-up; small means near-ties. */
  meanMargin: number;
  /** Wrong recognitions, most frequent first. */
  confused: ConfusedPair[];
  /** Nodes with a single view, which cannot be tested (untrained nodes are not counted). */
  skippedNodes: number;
}

export interface ConfusabilityOptions {
  /** Remove the map-wide mean before comparing, as the scanner does. Default true. */
  centered?: boolean;
}

/**
 * Leave-one-out check of the learned views: every view is held out in turn and matched against the
 * rest of the map. Shows how well the places can be told apart and which pairs get mixed up, i.e.
 * where a QR marker is needed. A node's only view cannot be held out, since the node would be left
 * untrained.
 */
export function analyzeConfusability(
  nodes: Record<string, MapNode>,
  { centered = true }: ConfusabilityOptions = {},
): ConfusabilityReport {
  const center = centered ? meanEmbedding(nodes) : null;
  const pairs = new Map<string, ConfusedPair>();
  let total = 0;
  let correct = 0;
  let marginSum = 0;
  let skippedNodes = 0;

  for (const node of Object.values(nodes)) {
    if (node.embeddings.length < 2) {
      if (node.embeddings.length === 1) skippedNodes++;
      continue;
    }
    for (const sample of node.embeddings) {
      const rest: Record<string, MapNode> = {
        ...nodes,
        [node.id]: { ...node, embeddings: node.embeddings.filter((s) => s !== sample) },
      };
      const [top, second] = rankMatches(sample.vector, rest, { limit: 2, center });
      total++;
      marginSum += top ? top.score - (second?.score ?? 0) : 0;
      if (!top || top.node.id === node.id) {
        if (top) correct++;
        continue;
      }
      const key = `${node.id}>${top.node.id}`;
      const pair = pairs.get(key) ?? { expectedId: node.id, predictedId: top.node.id, count: 0 };
      pair.count++;
      pairs.set(key, pair);
    }
  }

  return {
    total,
    accuracy: total === 0 ? 0 : correct / total,
    meanMargin: total === 0 ? 0 : marginSum / total,
    confused: [...pairs.values()].sort((a, b) => b.count - a.count),
    skippedNodes,
  };
}
