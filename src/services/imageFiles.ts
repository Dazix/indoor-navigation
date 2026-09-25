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

/**
 * Reads an uploaded floor plan as a data URL. SVGs are kept as-is; raster images larger than
 * MAX_EDGE_PX are downscaled and re-encoded as WebP (JPEG where WebP encoding is unsupported).
 */
export async function readFloorPlanFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Image is larger than 20 MB');
  if (file.type === 'image/svg+xml') return readAsDataUrl(file);

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1024 * 1024) return await readAsDataUrl(file);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return await readAsDataUrl(file);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const webp = canvas.toDataURL('image/webp', 0.85);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
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
