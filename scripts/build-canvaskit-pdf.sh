#!/usr/bin/env bash
# Сборка CanvasKit WASM с включённым Skia PDF backend (skia_enable_pdf=true).
#
# Требования: Docker.
# Результат копируется в public/canvaskit-pdf/:
#   canvaskit-pdf.js
#   canvaskit-pdf.wasm
#
# Основано на форке pushpagarwal/skia (ветка canvas-kit-pdf), где PDF API
# проброшен в JS: MakePDFDocument → beginPage → close → Uint8Array.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/canvaskit-pdf"
SKIA_REF="${SKIA_REF:-canvas-kit-pdf}"
SKIA_REPO="${SKIA_REPO:-https://github.com/pushpagarwal/skia.git}"

echo "→ Сборка CanvasKit PDF WASM в Docker (это может занять 20–40 мин)…"

docker run --rm \
  -v "$OUT:/out" \
  -e SKIA_REF="$SKIA_REF" \
  -e SKIA_REPO="$SKIA_REPO" \
  emscripten/emsdk:3.1.50 \
  bash -lc '
    set -euo pipefail
    apt-get update -qq && apt-get install -y -qq git python3 > /dev/null
    git clone --depth 1 --branch "$SKIA_REF" "$SKIA_REPO" /skia
    cd /skia
    python3 tools/git-sync-deps
    # В compile.sh по умолчанию skia_enable_pdf=false — включаем PDF.
    sed -i "s/skia_enable_pdf=false/skia_enable_pdf=true/" modules/canvaskit/compile.sh
    ./modules/canvaskit/compile.sh release no_skottie no_effects_deserialization
    mkdir -p /out
    cp out/canvaskit_wasm/canvaskit.js /out/canvaskit-pdf.js
    cp out/canvaskit_wasm/canvaskit.wasm /out/canvaskit-pdf.wasm
    # ESM-экспорт для Vite (CJS-модуль Emscripten по умолчанию без default export).
    grep -q "export default CanvasKitInit" /out/canvaskit-pdf.js || echo "export default CanvasKitInit;" >> /out/canvaskit-pdf.js
    echo "✓ WASM собран: /out/canvaskit-pdf.wasm"
  '

# Синхронизируем JS в src/vendor для Vite-бандла.
mkdir -p "$ROOT/src/vendor"
cp "$OUT/canvaskit-pdf.js" "$ROOT/src/vendor/canvaskit-pdf.js"

echo "✓ Готово: $OUT/canvaskit-pdf.{js,wasm}"
