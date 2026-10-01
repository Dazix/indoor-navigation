import type { MapNode } from '../types/map';
import { AUTO_MATCH, meanEmbedding, meanTileEmbeddings, pickAutoMatch, rankMatches } from './visionMatcher';

export interface ConfusedPair {
  /** Node whose held-out view was being recognised. */
  expectedId: string;
  /** Node that won instead. */
  predictedId: string;
  count: number;
}

/** What the scanner would do with each held-out view if it saw it as a single frame. */
export interface AutoConfirmStats {
  /** Confirmed without asking, and right. */
  right: number;
  /** Confirmed without asking, but the wrong place. These are the costly ones. */
  wrong: number;
  /** Not strong or not clear enough, so the user would be asked. */
  asked: number;
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
  /** Outcome of the scanner's automatic confirmation rule (`AUTO_MATCH`) over the held-out views. */
  auto: AutoConfirmStats;
}

export interface ConfusabilityOptions {
  /** Remove the map-wide mean before comparing, as the scanner does. Default true. */
  centered?: boolean;
}

/** Accumulates the held-out results of one analysis, node by node. */
function startAnalysis(nodes: Record<string, MapNode>, { centered = true }: ConfusabilityOptions) {
  const center = centered ? meanEmbedding(nodes) : null;
  const tileCenters = centered ? meanTileEmbeddings(nodes) : null;
  const pairs = new Map<string, ConfusedPair>();
  const auto: AutoConfirmStats = { right: 0, wrong: 0, asked: 0 };
  let total = 0;
  let correct = 0;
  let marginSum = 0;
  let skippedNodes = 0;

  return {
    /** Nodes with at least two views; a node's only view cannot be held out. */
    testable: Object.values(nodes).filter((node) => {
      if (node.embeddings.length === 1) skippedNodes++;
      return node.embeddings.length >= 2;
    }),

    test(node: MapNode) {
      for (const sample of node.embeddings) {
        const rest: Record<string, MapNode> = {
          ...nodes,
          [node.id]: { ...node, embeddings: node.embeddings.filter((s) => s !== sample) },
        };
        const ranked = rankMatches(sample.vector, rest, {
          limit: 2,
          center,
          heading: sample.headingDeg,
          tiles: sample.tiles,
          tileCenters,
        });
        const [top, second] = ranked;
        total++;
        marginSum += top ? top.score - (second?.score ?? 0) : 0;

        const confirmed = pickAutoMatch(ranked, AUTO_MATCH);
        if (!confirmed) auto.asked++;
        else if (confirmed.node.id === node.id) auto.right++;
        else auto.wrong++;

        if (!top || top.node.id === node.id) {
          if (top) correct++;
          continue;
        }
        const key = `${node.id}>${top.node.id}`;
        const pair = pairs.get(key) ?? { expectedId: node.id, predictedId: top.node.id, count: 0 };
        pair.count++;
        pairs.set(key, pair);
      }
    },

    report(): ConfusabilityReport {
      return {
        total,
        accuracy: total === 0 ? 0 : correct / total,
        meanMargin: total === 0 ? 0 : marginSum / total,
        confused: [...pairs.values()].sort((a, b) => b.count - a.count),
        skippedNodes,
        auto,
      };
    },
  };
}

/**
 * Leave-one-out check of the learned views: every view is held out in turn and matched against the
 * rest of the map. Shows how well the places can be told apart and which pairs get mixed up, i.e.
 * where a QR marker is needed. A node's only view cannot be held out, since the node would be left
 * untrained.
 */
export function analyzeConfusability(
  nodes: Record<string, MapNode>,
  options: ConfusabilityOptions = {},
): ConfusabilityReport {
  const run = startAnalysis(nodes, options);
  for (const node of run.testable) run.test(node);
  return run.report();
}

/** Lets the browser paint and handle input between two chunks of work. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * `analyzeConfusability` for a big map: gives the page back to the browser after every node, so the
 * UI keeps responding, and reports progress as a share 0–1. Resolves to null when `isCancelled`
 * turns true, so a closed dialog stops the work.
 */
export async function analyzeConfusabilityAsync(
  nodes: Record<string, MapNode>,
  options: ConfusabilityOptions = {},
  { onProgress, isCancelled }: { onProgress?: (share: number) => void; isCancelled?: () => boolean } = {},
): Promise<ConfusabilityReport | null> {
  const run = startAnalysis(nodes, options);
  for (const [i, node] of run.testable.entries()) {
    if (isCancelled?.()) return null;
    run.test(node);
    onProgress?.((i + 1) / run.testable.length);
    await nextTask();
  }
  return isCancelled?.() ? null : run.report();
}
