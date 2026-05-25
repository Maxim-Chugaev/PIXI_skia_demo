import { defineConfig } from "vite";

/**
 * Конфиг Vite.
 * - `assetsInclude` заставляет Vite обрабатывать wasm-бинарь CanvasKit
 *   как ассет и выдавать хешированный URL, который мы передаём в
 *   `locateFile` CanvasKit.
 */
export default defineConfig({
  base: "./",
  assetsInclude: ["**/*.wasm"],
  build: {
    target: "es2020",
    sourcemap: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
});
