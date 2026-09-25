/** Largest floor plan edge kept after upload; bigger images only bloat storage and exports. */
const MAX_EDGE_PX = 2048;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('File could not be read'));
    };
    reader.readAsDataURL(file);
  });
}

export interface FloorPlanImage {
  /** Data URL of the image. */
  src: string;
  /** Width / height of the image. */
  ratio: number;
}

function positive(v: string | undefined): number | null {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Width / height of an SVG document from its viewBox, else its width/height attributes. */
export function svgRatio(svg: string): number | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i
    .exec(root)?.[1]
    ?.trim()
    .split(/[\s,]+/);
  const vw = positive(viewBox?.[2]);
  const vh = positive(viewBox?.[3]);
  if (vw && vh) return vw / vh;
  const w = positive(/\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(root)?.[1]);
  const h = positive(/\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(root)?.[1]);
  return w && h ? w / h : null;
}

function loadImageRatio(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null);
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = src;
  });
}

/** Width / height of an image given by URL (data URL, absolute or already resolved asset URL). */
export async function imageRatio(src: string): Promise<number> {
  if (/^data:image\/svg\+xml|\.svg(\?|#|$)/i.test(src)) {
    try {
      const fromSvg = svgRatio(await (await fetch(src)).text());
      if (fromSvg) return fromSvg;
    } catch {
      // Fall back to the browser's intrinsic size below.
    }
  }
  return (await loadImageRatio(src)) ?? 1;
}

/**
 * Reads an uploaded floor plan as a data URL together with its aspect ratio. SVGs are kept as-is;
 * raster images larger than MAX_EDGE_PX are downscaled and re-encoded as WebP (JPEG where WebP
 * encoding is unsupported).
 */
export async function readFloorPlanFile(file: File): Promise<FloorPlanImage> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Image is larger than 20 MB');
  if (file.type === 'image/svg+xml') {
    const src = await readAsDataUrl(file);
    return { src, ratio: svgRatio(await file.text()) ?? (await loadImageRatio(src)) ?? 1 };
  }

  const bitmap = await createImageBitmap(file);
  try {
    const ratio = bitmap.width / bitmap.height;
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1024 * 1024) return { src: await readAsDataUrl(file), ratio };

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { src: await readAsDataUrl(file), ratio };
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const webp = canvas.toDataURL('image/webp', 0.85);
    return { src: webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85), ratio };
  } finally {
    bitmap.close();
  }
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

function clipboardFile(blob: Blob): File {
  return new File([blob], `pasted-floor-plan.${EXTENSIONS[blob.type] ?? 'img'}`, { type: blob.type });
}

/** First image among pasted files (a `paste` event's clipboardData.files), if any. */
export function pickImageFile(files: ArrayLike<File> | null | undefined): File | null {
  for (const file of Array.from(files ?? [])) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}

/**
 * Reads an image from the system clipboard (Async Clipboard API; the browser may ask for permission).
 * Throws a user-readable error when the API is missing, access is denied or there is no image.
 */
export async function readClipboardImage(): Promise<File> {
  if (typeof (navigator.clipboard as Clipboard | undefined)?.read !== 'function') {
    throw new Error('This browser cannot read images from the clipboard. Press Ctrl+V / ⌘V instead.');
  }
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error('Clipboard access was denied. Allow it, or press Ctrl+V / ⌘V instead.');
  }
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) return clipboardFile(await item.getType(type));
  }
  throw new Error('There is no image in the clipboard. Copy an image or a screenshot first.');
}
