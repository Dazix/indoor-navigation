import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    // Android crops maskable icons to a circle/squircle; fill the safe-zone padding with the brand colour.
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: { background: '#4f46e5' },
    },
  },
  images: ['public/favicon.svg'],
});
