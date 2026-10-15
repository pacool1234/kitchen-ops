import {
  defineConfig,
  minimal2023Preset,
} from "@vite-pwa/assets-generator/config";

// Generates the PNG icons from public/icon.svg. Run once after changing the SVG:
//   pnpm --filter @kitchen-ops/web generate-pwa-assets
export default defineConfig({
  preset: minimal2023Preset,
  images: ["public/icon.svg"],
});
