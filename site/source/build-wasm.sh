#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ -d "$HERE/rapfi-source/Rapfi" ]]; then ROOT="$HERE"; else ROOT="$(cd "$HERE/.." && pwd)"; fi
SRC="${RAPFI_SOURCE:-$ROOT/rapfi-source}"
OUT="${WASM_OUT:-$ROOT/build-wasm/final}"
WEIGHTS="$SRC/Networks/wasm-freestyle"
ARCHIVE="${RAPFI_RELEASE_ARCHIVE:-$ROOT/.release-250615/Rapfi-engine.7z}"
RELEASE_URL="https://github.com/dotb1ue/rapfi/releases/download/250615/Rapfi-engine.7z"
mkdir -p "$WEIGHTS" "$OUT"
if [[ ! -f "$WEIGHTS/model210901.bin" || ! -f "$WEIGHTS/mix9svqfreestyle_bsmix.bin.lz4" ]]; then
  python3 -c 'import py7zr' 2>/dev/null || { echo 'Install extraction dependency first: python3 -m pip install py7zr' >&2; exit 1; }
  if [[ ! -f "$ARCHIVE" ]]; then
    mkdir -p "$(dirname "$ARCHIVE")"
    curl -fL --retry 2 "$RELEASE_URL" -o "$ARCHIVE"
  fi
  python3 - "$ARCHIVE" "$WEIGHTS" <<'PY'
import sys, py7zr
with py7zr.SevenZipFile(sys.argv[1], mode='r') as archive:
    archive.extract(path=sys.argv[2], targets=['model210901.bin', 'mix9svqfreestyle_bsmix.bin.lz4'])
PY
fi
printf '%s  %s\n' 2fa08cb15cf240d9533548c3e011b03d46809f6858362e97ee873d0632aa2015 "$WEIGHTS/model210901.bin" | sha256sum -c -
printf '%s  %s\n' 6bc0d1b0ff8e1d857f7f412923cd458f38f1a435087c91ae71fec3676c23ef62 "$WEIGHTS/mix9svqfreestyle_bsmix.bin.lz4" | sha256sum -c -
cat > "$SRC/Networks/wasm_preloads.txt" <<'PRELOADS'
wasm-freestyle/config.toml@/config.toml
wasm-freestyle/model210901.bin@/model210901.bin
wasm-freestyle/mix9svqfreestyle_bsmix.bin.lz4@/mix9svqfreestyle_bsmix.bin.lz4
PRELOADS
cat > "$WEIGHTS/config.toml" <<'CONFIG'
[requirement]
min_version = [0,43,1]
[general]
reload_config_each_move = false
clear_hash_after_config_loaded = false
default_thread_num = 1
message_mode = "normal"
coord_conversion_mode = "none"
default_candidate_range = "square3_line4"
memory_reserved_mb = 0
default_tt_size_kb = 32768
[model]
binary_file = "/model210901.bin"
[model.evaluator]
type = "mix9svq"
draw_black_winrate = 0.5
draw_ratio = 1.0
[[model.evaluator.weights]]
weight_file = "/mix9svqfreestyle_bsmix.bin.lz4"
CONFIG
for spec in 'simd ON' 'scalar OFF'; do
  read -r name simd <<<"$spec"
  b="$ROOT/build-wasm/cmake-$name"
  emcmake cmake -S "$SRC/Rapfi" -B "$b" -DCMAKE_BUILD_TYPE=Release -DNO_MULTI_THREADING=ON -DNO_COMMAND_MODULES=ON -DUSE_WASM_SIMD="$simd" -DUSE_WASM_SIMD_RELAXED=OFF -DCMAKE_CXX_FLAGS_RELEASE='-O3 -DNDEBUG'
  cmake --build "$b" --parallel "${JOBS:-4}"
  stem=rapfi-single; [[ "$name" == simd ]] && stem=rapfi-single-simd128
  cp "$b/$stem.js" "$b/$stem.wasm" "$b/$stem.data" "$OUT/"
done
