// Downloads the MobileNet v2 (alpha 0.5, 224px) TF.js graph model that
// @tensorflow-models/mobilenet uses by default and vendors it into public/,
// so the app can run fully offline and without depending on TF Hub redirects.
// Model license: Apache 2.0 (Google).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const HUB_URL = 'https://tfhub.dev/google/imagenet/mobilenet_v2_050_224/classification/2';
const OUT_DIR = join(import.meta.dirname, '..', 'public', 'models', 'mobilenet_v2_050');

async function download(name) {
  const res = await fetch(`${HUB_URL}/${name}?tfjs-format=file`);
  if (!res.ok) throw new Error(`GET ${name} failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

await mkdir(OUT_DIR, { recursive: true });

const modelJson = await download('model.json');
await writeFile(join(OUT_DIR, 'model.json'), modelJson);

const manifest = JSON.parse(modelJson.toString('utf8')).weightsManifest ?? [];
const shards = manifest.flatMap((group) => group.paths);
for (const shard of shards) {
  const data = await download(shard);
  await writeFile(join(OUT_DIR, shard), data);
  console.log(`  ${shard} (${(data.length / 1024).toFixed(0)} kB)`);
}

console.log(`MobileNet v2 0.5 saved to ${OUT_DIR} (${shards.length} shards)`);
