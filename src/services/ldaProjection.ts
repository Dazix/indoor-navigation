import type { MapNode } from '../types/map';
import type { MatchResult } from '../types/vision';
import { centeredCosineSimilarity, headingFactor, TILE_COUNT } from './visionMatcher';

/**
 * Linear discriminant analysis over the learned views of a map. The vectors of a frozen network say
 * what is in the picture, and most of what varies between two views of one place (angle, light,
 * people) is not what tells the places apart. LDA finds the directions along which the places differ
 * most compared to how much a place differs from itself, and the matcher then compares views in that
 * small space. It is trained in the browser from the stored vectors, so no rescan is needed.
 */

/** Variance added to the diagonal so a degenerate covariance can still be factored. */
const RIDGE = 1e-8;
/** Imported maps are untrusted: bigger vectors or more places than this are not trained on (cost grows with the cube of the size). */
const MAX_DIMENSIONS = 1024;
const MAX_PLACES = 200;
/** Directions whose discriminant ratio is below this share of the best one are noise. */
const MIN_EIGENVALUE_SHARE = 1e-6;

interface ProjectedView {
  z: number[];
  thumbnail: string | null;
  headingDeg: number | undefined;
}

export interface LdaModel {
  /** Mean feature vector subtracted before projecting. */
  mean: number[];
  /** Projection directions, one row each. */
  basis: number[][];
  /** Mean of the projected training views, removed before comparing (like `meanEmbedding`). */
  center: number[];
  /** Projected views by node id. */
  views: Map<string, ProjectedView[]>;
}

/** Whole-frame vector followed by the tile vectors, or null when a view has no tiles. */
export function ldaFeatures(
  vector: readonly number[],
  tiles: readonly (readonly number[])[] | null | undefined,
): number[] | null {
  if (!tiles || tiles.length !== TILE_COUNT || vector.length === 0) return null;
  return [...vector, ...tiles.flat()];
}

/** Row `i` of a symmetric matrix kept in a flat array of size n×n. */
const at = (m: Float64Array, n: number, i: number, j: number) => m[i * n + j] as number;

/**
 * Covariance of one class with shrinkage towards the diagonal (Ledoit–Wolf on standardized features),
 * since a class has far fewer views than the vector has dimensions.
 */
function shrunkClassCovariance(rows: readonly number[][], mean: readonly number[]): Float64Array {
  const n = rows.length;
  const d = mean.length;
  const scale = new Array<number>(d).fill(0);
  for (const row of rows)
    for (let j = 0; j < d; j++)
      scale[j] = (scale[j] as number) + ((row[j] as number) - (mean[j] as number)) ** 2;
  for (let j = 0; j < d; j++) scale[j] = Math.sqrt((scale[j] as number) / n) || 1;

  const z = rows.map((row) =>
    Float64Array.from(row, (v, j) => (v - (mean[j] as number)) / (scale[j] as number)),
  );
  const s = new Float64Array(d * d);
  let fourth = 0;
  for (const zi of z) {
    let sq = 0;
    for (let j = 0; j < d; j++) {
      const a = zi[j] as number;
      sq += a * a;
      for (let k = j; k < d; k++) s[j * d + k] = (s[j * d + k] as number) + a * (zi[k] as number);
    }
    fourth += sq * sq;
  }
  let frobenius = 0;
  let trace = 0;
  for (let j = 0; j < d; j++) {
    for (let k = j; k < d; k++) {
      const v = (s[j * d + k] as number) / n;
      s[j * d + k] = v;
      s[k * d + j] = v;
      frobenius += (j === k ? 1 : 2) * v * v;
    }
    trace += s[j * d + j] as number;
  }
  const mu = trace / d;
  const delta = (frobenius - d * mu * mu) / d;
  const beta = Math.min((fourth / n - frobenius) / (d * n), delta);
  const alpha = delta <= 0 ? 0 : Math.max(0, beta / delta);

  const cov = new Float64Array(d * d);
  for (let j = 0; j < d; j++) {
    for (let k = 0; k < d; k++) {
      const shrunk = (1 - alpha) * (s[j * d + k] as number) + (j === k ? alpha * mu : 0);
      cov[j * d + k] = shrunk * (scale[j] as number) * (scale[k] as number);
    }
  }
  return cov;
}

/** Lower Cholesky factor of a symmetric positive definite matrix, in place in a copy. */
function cholesky(a: Float64Array, n: number): Float64Array | null {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = at(a, n, i, j);
      for (let k = 0; k < j; k++) sum -= at(l, n, i, k) * at(l, n, j, k);
      if (i === j) {
        if (sum <= 0) return null;
        l[i * n + i] = Math.sqrt(sum);
      } else {
        l[i * n + j] = sum / at(l, n, j, j);
      }
    }
  }
  return l;
}

/** Solves (L Lᵀ) x = b. */
function choleskySolve(l: Float64Array, n: number, b: readonly number[]): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i] as number;
    for (let k = 0; k < i; k++) sum -= at(l, n, i, k) * (y[k] as number);
    y[i] = sum / at(l, n, i, i);
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i] as number;
    for (let k = i + 1; k < n; k++) sum -= at(l, n, k, i) * (x[k] as number);
    x[i] = sum / at(l, n, i, i);
  }
  return x;
}

/** Eigenvalues and eigenvectors (as columns of `vectors`) of a small symmetric matrix, by cyclic Jacobi rotations. */
function jacobiEigen(matrix: Float64Array, n: number): { values: number[]; vectors: Float64Array } {
  const a = Float64Array.from(matrix);
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += at(a, n, p, q) ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = at(a, n, p, q);
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (at(a, n, q, q) - at(a, n, p, p)) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = at(a, n, k, p);
          const akq = at(a, n, k, q);
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = at(a, n, p, k);
          const aqk = at(a, n, q, k);
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = at(v, n, k, p);
          const vkq = at(v, n, k, q);
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: Array.from({ length: n }, (_, i) => at(a, n, i, i)), vectors: v };
}

interface TrainingView {
  features: number[];
  sample: MapNode['embeddings'][number];
}

/**
 * Trains the projection on every learned view of the map, or returns null when it cannot or should
 * not be used: fewer than two places, no place with two views, or a trained place with no view that has
 * both whole-frame and tile vectors of the same size (older maps, another extractor) — the matcher then
 * falls back to plain cosine over the vectors.
 */
export function trainLda(nodes: Record<string, MapNode>): LdaModel | null {
  const classes: { node: MapNode; views: TrainingView[] }[] = [];
  let dims = 0;
  for (const node of Object.values(nodes)) {
    if (node.embeddings.length === 0 && !node.fingerprint) continue;
    const views: TrainingView[] = [];
    for (const sample of node.embeddings) {
      const features = ldaFeatures(sample.vector, sample.tiles);
      if (!features) continue;
      dims ||= features.length;
      if (features.length === dims) views.push({ features, sample });
    }
    if (views.length === 0) return null;
    classes.push({ node, views });
  }
  const total = classes.reduce((sum, c) => sum + c.views.length, 0);
  if (classes.length < 2 || classes.length > MAX_PLACES || dims > MAX_DIMENSIONS) return null;
  if (classes.every((c) => c.views.length < 2)) return null;

  const mean = new Array<number>(dims).fill(0);
  for (const c of classes)
    for (const v of c.views)
      for (let j = 0; j < dims; j++) mean[j] = (mean[j] as number) + (v.features[j] as number) / total;

  const within = new Float64Array(dims * dims);
  const between: number[][] = [];
  for (const c of classes) {
    const n = c.views.length;
    const classMean = new Array<number>(dims).fill(0);
    for (const v of c.views)
      for (let j = 0; j < dims; j++) classMean[j] = (classMean[j] as number) + (v.features[j] as number) / n;
    const weight = Math.sqrt(n / total);
    between.push(classMean.map((m, j) => weight * (m - (mean[j] as number))));
    if (n < 2) continue;
    const cov = shrunkClassCovariance(
      c.views.map((v) => v.features),
      classMean,
    );
    for (let i = 0; i < within.length; i++)
      within[i] = (within[i] as number) + ((cov[i] as number) * n) / total;
  }
  let trace = 0;
  for (let j = 0; j < dims; j++) trace += within[j * dims + j] as number;
  for (let j = 0; j < dims; j++)
    within[j * dims + j] = (within[j * dims + j] as number) + RIDGE * (trace / dims || 1);
  const factor = cholesky(within, dims);
  if (!factor) return null;

  // Between-class scatter is M Mᵀ, so its eigenproblem against the within-class one reduces to the
  // small matrix Mᵀ W⁻¹ M (one row per place).
  const solved = between.map((m) => choleskySolve(factor, dims, m));
  const c = classes.length;
  const small = new Float64Array(c * c);
  for (let i = 0; i < c; i++) {
    for (let k = 0; k < c; k++) {
      let dot = 0;
      for (let j = 0; j < dims; j++)
        dot += ((between[i] as number[])[j] as number) * ((solved[k] as Float64Array)[j] as number);
      small[i * c + k] = dot;
    }
  }
  const { values, vectors } = jacobiEigen(small, c);
  const order = values.map((value, i) => ({ value, i })).sort((a, b) => b.value - a.value);
  const best = order[0]?.value ?? 0;
  if (best <= 0) return null;
  const basis: number[][] = [];
  for (const { value, i } of order.slice(0, c - 1)) {
    if (value < best * MIN_EIGENVALUE_SHARE) break;
    // w = W⁻¹ M u, scaled so that wᵀ W w = 1
    const w = new Array<number>(dims).fill(0);
    for (let k = 0; k < c; k++) {
      const u = at(vectors, c, k, i);
      const col = solved[k] as Float64Array;
      for (let j = 0; j < dims; j++) w[j] = (w[j] as number) + u * (col[j] as number);
    }
    const norm = 1 / Math.sqrt(value);
    basis.push(w.map((x) => x * norm));
  }
  if (basis.length === 0) return null;

  const project = (features: readonly number[]) =>
    basis.map((row) => {
      let sum = 0;
      for (let j = 0; j < dims; j++)
        sum += (row[j] as number) * ((features[j] as number) - (mean[j] as number));
      return sum;
    });
  const views = new Map<string, ProjectedView[]>();
  const center = new Array<number>(basis.length).fill(0);
  for (const cls of classes) {
    views.set(
      cls.node.id,
      cls.views.map((v) => {
        const z = project(v.features);
        for (let j = 0; j < z.length; j++) center[j] = (center[j] as number) + (z[j] as number) / total;
        return { z, thumbnail: v.sample.thumbnail, headingDeg: v.sample.headingDeg };
      }),
    );
  }
  return { mean, basis, center, views };
}

/**
 * Scores every place of the model by its best-matching view in the projected space, best first, with
 * the same result shape as `rankMatches`. Null when the live frame has no tiles or does not fit the
 * model, so the caller can fall back.
 */
export function rankProjected(
  model: LdaModel,
  vector: readonly number[],
  tiles: readonly (readonly number[])[] | null,
  nodes: Record<string, MapNode>,
  heading: number | null = null,
): MatchResult[] | null {
  const features = ldaFeatures(vector, tiles);
  if (features?.length !== model.mean.length) return null;
  const z = model.basis.map((row) => {
    let sum = 0;
    for (let j = 0; j < features.length; j++)
      sum += (row[j] as number) * ((features[j] as number) - (model.mean[j] as number));
    return sum;
  });
  const results: MatchResult[] = [];
  for (const [id, views] of model.views) {
    const node = nodes[id];
    if (!node) continue;
    let best = 0;
    let thumbnail: string | null = null;
    for (const view of views) {
      const sim = centeredCosineSimilarity(z, view.z, model.center) * headingFactor(view.headingDeg, heading);
      if (sim > best) {
        best = sim;
        thumbnail = view.thumbnail;
      }
    }
    results.push({ node, score: Math.round(best * 100), thumbnail, boost: 0 });
  }
  return results.sort((a, b) => b.score - a.score);
}
