#!/usr/bin/env python3
from pathlib import Path
import hashlib
import json
import shutil
import tarfile

ROOT = Path(__file__).resolve().parent
SITE = ROOT / 'site'
ENGINE = SITE / 'engine'
SOURCE = SITE / 'source'
BUILT = ROOT / 'build-wasm' / 'final'
REPO = ROOT / 'rapfi-source'
BUILD = ROOT / 'wasm-build'
ENGINE.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)

for stem in ['rapfi-single-simd128', 'rapfi-single']:
    for suffix in ['.js', '.wasm']:
        shutil.copy2(BUILT / (stem + suffix), ENGINE / (stem + suffix))
data = (BUILT / 'rapfi-single-simd128.data').read_bytes()
assert data == (BUILT / 'rapfi-single.data').read_bytes(), 'WASM variants must use identical preload data'
for old in ENGINE.glob('weights-*.bin'):
    old.unlink()
chunks = []
for index, offset in enumerate(range(0, len(data), 4 * 1024 * 1024)):
    payload = data[offset:offset + 4 * 1024 * 1024]
    filename = f'weights-{index + 1:02d}.bin'
    (ENGINE / filename).write_bytes(payload)
    chunks.append({'file': filename, 'size': len(payload)})
manifest = {
    'release': '250615',
    'sourceCommit': '1be1551ced57e38d53ed58f6d74bf6f8b4bdc230',
    'data': {'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'chunks': chunks},
    'variants': {
        'simd': {'script': 'rapfi-single-simd128.js', 'wasm': 'rapfi-single-simd128.wasm'},
        'scalar': {'script': 'rapfi-single.js', 'wasm': 'rapfi-single.wasm'},
    },
    'weights': {'name': 'mix9svqfreestyle_bsmix.bin.lz4', 'sha256': '6bc0d1b0ff8e1d857f7f412923cd458f38f1a435087c91ae71fec3676c23ef62'},
}
(ENGINE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')

stage = BUILD / 'source-stage-final'
if stage.exists():
    shutil.rmtree(stage)
(stage / 'rapfi-source').mkdir(parents=True)
shutil.copytree(REPO / 'Rapfi', stage / 'rapfi-source' / 'Rapfi', ignore=shutil.ignore_patterns('.git', 'build', '__pycache__'))
for name in ['Copying.txt', 'AUTHORS']:
    shutil.copy2(REPO / name, stage / 'rapfi-source' / name)
network = stage / 'rapfi-source' / 'Networks'
(network / 'wasm-freestyle').mkdir(parents=True)
for name in ['LICENSE', 'wasm_preloads.txt']:
    shutil.copy2(REPO / 'Networks' / name, network / name)
shutil.copy2(REPO / 'Networks' / 'wasm-freestyle' / 'config.toml', network / 'wasm-freestyle' / 'config.toml')
for name in ['README.md', 'build-wasm.sh', 'test-node.js']:
    shutil.copy2(BUILD / name, stage / name)
(stage / 'build-wasm.sh').chmod(0o755)
archive = BUILD / 'rapfi-250615-wasm-corresponding-source.tar.gz'
with tarfile.open(archive, 'w:gz') as tar:
    for path in sorted(stage.iterdir()):
        tar.add(path, arcname=path.name)
shutil.copy2(archive, SOURCE / archive.name)
for src, dst in [(BUILD / 'README.md', 'BUILD.md'), (BUILD / 'build-wasm.sh', 'build-wasm.sh'), (BUILD / 'test-node.js', 'test-node.js'), (REPO / 'Copying.txt', 'GPL-3.0.txt'), (REPO / 'AUTHORS', 'AUTHORS.txt'), (REPO / 'Networks' / 'LICENSE', 'WEIGHTS-CC0.txt')]:
    shutil.copy2(src, SOURCE / dst)

files = [p for p in SITE.rglob('*') if p.is_file()]
assert len(files) <= 1000
assert all(p.stat().st_size <= 5 * 1024 * 1024 for p in files), 'Temporary static assets must be <=5MiB each'
print(f'Packaged {len(files)} public site assets; data={len(data)} bytes in {len(chunks)} chunks; source={archive.stat().st_size} bytes.')
print('Largest assets:')
for path in sorted(files, key=lambda p: p.stat().st_size, reverse=True)[:6]:
    print(path.relative_to(SITE), path.stat().st_size)
