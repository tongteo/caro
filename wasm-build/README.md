# Rapfi 250615 browser WebAssembly build

Built from official Rapfi tag **250615**, commit `1be1551ced57e38d53ed58f6d74bf6f8b4bdc230`, using Emscripten 3.1.6 and CMake 4.4.4. Upstream repository: https://github.com/dotb1ue/rapfi. Submodule revisions: Gomocalc `87c7d707244aee54c5b87be7ba413646d6e2984e`; Networks `918b757a129258e9e765f77fe17d507c2bb1a60b`; Trainer `91f559a3a8ef9a4529d6ec177eef83cca6775517`.

## Build variants and compatibility changes

Both variants use Release, `NO_MULTI_THREADING=ON`, `NO_COMMAND_MODULES=ON`, `-O3 -DNDEBUG`, C++17, wasm `-fexceptions -flto`, modular factory name `Rapfi`, `ALLOW_MEMORY_GROWTH=1`, imported memory and a 2 MiB stack. SIMD uses `USE_WASM_SIMD=ON`; scalar uses `USE_WASM_SIMD=OFF`; relaxed SIMD is disabled. Outputs are `rapfi-single-simd128.js/.wasm/.data` and `rapfi-single.js/.wasm/.data`.

Compatibility changes are included in the corresponding source: old Emscripten `STACK_SIZE=2MB` changed to `TOTAL_STACK=2MB`; Closure disabled; `_main` removed from explicit exports while `gomocupLoopOnce` and `emscripten_force_exit` remain; thread-only member access in `ThreadPool::waitForIdle()` guarded by `MULTI_THREADING`; mix10's compile-time SCALAR prohibition removed so its existing scalar/vector abstraction can instantiate. The mix9svq evaluator and game/search algorithms are unchanged. The browser explicitly initializes the config through the protocol rather than relying on an exported C++ main.

## Released weights

Only three MEMFS preloads are required: `/config.toml`, `/model210901.bin`, `/mix9svqfreestyle_bsmix.bin.lz4`. The config selects `type="mix9svq"` and freestyle weights with absolute MEMFS paths. The two binary weights come from the official release archive https://github.com/dotb1ue/rapfi/releases/download/250615/Rapfi-engine.7z.

SHA-256 classical model: `2fa08cb15cf240d9533548c3e011b03d46809f6858362e97ee873d0632aa2015`. SHA-256 NNUE: `6bc0d1b0ff8e1d857f7f412923cd458f38f1a435087c91ae71fec3676c23ef62`.

## Rebuild

From the corresponding-source archive root, run `./build-wasm.sh`. It finds its adjacent `rapfi-source/` tree. Set `RAPFI_SOURCE`, `WASM_OUT`, `RAPFI_RELEASE_ARCHIVE`, or `JOBS` to override paths. The script downloads the official archive when weights are missing, extracts the two files and verifies their hashes. Dependencies: Emscripten 3.1.6, CMake, curl, sha256sum, Python with `py7zr` (`python3 -m pip install py7zr`), and Node for validation. In the development workspace, the same script is `wasm-build/build-wasm.sh`.

After building, run `node test-node.js build-wasm/final rapfi-single-simd128` and repeat with stem `rapfi-single`. The harness injects `wasmBinary` and `getPreloadedPackage()` data, explicitly sends `RELOADCONFIG /config.toml`, then runs protocol searches.

## Positive runtime validation

Both SIMD and scalar builds emitted `MESSAGE mix9svq nnue: load weight from /mix9svqfreestyle_bsmix.bin.lz4`, returned a legal reply to a one-stone position, and chose `4,7` to complete an immediate four-in-a-row win. NNUE load and forced-winning coordinates are mandatory assertions. Tests use freestyle rule 0, 300 ms turn timeout, 16384 KB hash, realtime detail level 3.

Rapfi creates its evaluator lazily on the first search, not merely on `START`. The browser therefore sends `RELOADCONFIG /config.toml`, runs a 100 ms warm-up search on a one-stone position, resets the board, and reports ready only after capturing the NNUE load diagnostic. It never silently substitutes a heuristic or classical-only evaluator. Real user searches send the selected `INFO TIMEOUT_TURN` value. Realtime best candidates use `MESSAGE REALTIME BEST x,y` and `INFO BESTLINE x,y ...`; coordinates are column,row.

## Licensing

Rapfi is GPL-3.0-or-later, without warranty. The corresponding-source archive contains the modified engine source, external dependency sources, GPL/AUTHORS files, preload config and reproducible build/test scripts, excluding Git history, generated binaries and weight blobs. Released weights are distributed separately under the Networks CC0 license. See the included licenses and upstream notices.
