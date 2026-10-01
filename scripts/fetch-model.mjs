// Downloads a MobileNet v2 (224px) TF.js graph model and vendors it into public/models/, so the app
// can run fully offline. Usage: `npm run fetch-model` (alpha 0.5, the default) or
// `npm run fetch-model -- 1.0`. The folders match src/services/embeddingModels.ts.
// Model license: Apache 2.0 (Google).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MODELS = {
  // The model @tensorflow-models/mobilenet uses by default; served by TF Hub.
  0.5: {
    dir: 'mobilenet_v2_050',
    url: (name) =>
      `https://tfhub.dev/google/imagenet/mobilenet_v2_050_224/classification/2/${name}?tfjs-format=file`,
  },
  // TF Hub no longer serves this one; the tfjs-models bucket does.
  '1.0': {
    dir: 'mobilenet_v2_100',
    url: (name) => `https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224/${name}`,
  },
};

const alpha = process.argv[2] ?? '0.5';
const model = MODELS[alpha];
if (!model) {
  console.error(`Unknown alpha "${alpha}". Use one of: ${Object.keys(MODELS).join(', ')}`);
  process.exit(1);
}
const OUT_DIR = join(import.meta.dirname, '..', 'public', 'models', model.dir);

async function download(name) {
  const res = await fetch(model.url(name));
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

console.log(`MobileNet v2 ${alpha} saved to ${OUT_DIR} (${shards.length} shards)`);
