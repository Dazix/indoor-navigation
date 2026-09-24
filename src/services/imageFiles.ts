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
