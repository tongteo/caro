'use strict';

let engine = null;
let initialization = null;
let activeSearch = null;
let startupError = null;
let nnueLoaded = false;

const postStatus = (detail) => self.postMessage({ type: 'status', detail });
const engineURL = (path) => new URL(path, self.location.href).href;

async function checkedFetch(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Không tải được tài nguyên Rapfi (${response.status}).`);
  return response;
}

function receiveStdout(value) {
  const line = String(value).trim();
  if (!line) return;
  if (/mix9svq nnue: load weight from/i.test(line)) nnueLoaded = true;
  if (line.startsWith('ERROR')) {
    const message = line.replace(/^ERROR\s*/, '') || 'Lỗi nội bộ Rapfi';
    if (activeSearch) activeSearch.error = message;
    else startupError = message;
    return;
  }
  if (!activeSearch) return;
  const coordinate = line.match(/^(\d+),(\d+)$/);
  if (coordinate) {
    activeSearch.result = { col: Number(coordinate[1]), row: Number(coordinate[2]) };
    return;
  }
  const candidate = line.match(/^(?:MESSAGE REALTIME BEST|INFO BESTLINE)\s+(\d+),(\d+)/);
  if (candidate) {
    self.postMessage({ type: 'candidate', id: activeSearch.id, cell: { col: Number(candidate[1]), row: Number(candidate[2]) } });
  }
}

function supportsSIMD() {
  try {
    return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));
  } catch (_) { return false; }
}

async function initialize() {
  postStatus('Đang kiểm tra engine và weights phát hành 250615…');
  const manifest = await (await checkedFetch(engineURL('manifest.json'))).json();
  const variantName = supportsSIMD() && manifest.variants.simd ? 'simd' : 'scalar';
  const variant = manifest.variants[variantName];
  if (!variant) throw new Error('Thiếu bản WASM phù hợp với trình duyệt.');
  let completed = 0;
  const parts = await Promise.all(manifest.data.chunks.map(async (chunk) => {
    const bytes = new Uint8Array(await (await checkedFetch(engineURL(chunk.file))).arrayBuffer());
    if (bytes.byteLength !== chunk.size) throw new Error('Tệp weights tải chưa đầy đủ.');
    completed += bytes.byteLength;
    postStatus(`Đang tải weights NNUE · ${Math.round(completed / manifest.data.size * 100)}%`);
    return bytes;
  }));
  const packageBytes = new Uint8Array(manifest.data.size);
  let offset = 0;
  for (const part of parts) {
    packageBytes.set(part, offset);
    offset += part.byteLength;
  }
  parts.length = 0;
  if (manifest.data.sha256 && self.crypto && crypto.subtle) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', packageBytes))).map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hash !== manifest.data.sha256) throw new Error('Kiểm tra toàn vẹn weights không thành công.');
  }
  postStatus(`Đang khởi tạo Rapfi ${variantName === 'simd' ? 'SIMD' : 'tương thích'} và nạp NNUE…`);
  const wasmBinary = new Uint8Array(await (await checkedFetch(engineURL(variant.wasm))).arrayBuffer());
  self.importScripts(engineURL(variant.script));
  engine = await self.Rapfi({
    locateFile: (path) => engineURL(path),
    wasmBinary,
    wasmMemory: new WebAssembly.Memory({ initial: 1024, maximum: 8192 }),
    getPreloadedPackage: () => packageBytes.buffer,
    onReceiveStdout: receiveStdout,
    onReceiveStderr: (value) => {
      const line = String(value).trim();
      if (/abort|failed|cannot|not found/i.test(line)) startupError = line;
    },
    onAbort: (reason) => { startupError = String(reason); },
    onExit: (code) => {
      if (code) self.postMessage({ type: 'error', message: `Rapfi dừng với mã ${code}.` });
    },
  });
  engine.sendCommand('RELOADCONFIG /config.toml');
  engine.sendCommand('INFO RULE 0');
  engine.sendCommand('INFO THREAD_NUM 1');
  engine.sendCommand('INFO HASH_SIZE 16384');
  engine.sendCommand('INFO PONDERING 0');
  engine.sendCommand('INFO SWAPABLE 0');
  engine.sendCommand('START 15');
  postStatus('Đang kiểm tra NNUE bằng một thế cờ khởi tạo…');
  engine.sendCommand('INFO TIMEOUT_TURN 100');
  engine.sendCommand('INFO SHOW_DETAIL 0');
  engine.sendCommand('BOARD\n7,7,2\nDONE');
  engine.sendCommand('START 15');
  engine.sendCommand('INFO SHOW_DETAIL 3');
  if (startupError) throw new Error(startupError);
  if (!nnueLoaded) throw new Error('Chưa xác nhận được weights NNUE; engine đã dừng để tránh dùng AI thay thế.');
  self.postMessage({ type: 'ready', variant: variantName });
}

function search(message) {
  if (!engine) throw new Error('Engine chưa sẵn sàng.');
  if (!Array.isArray(message.moves) || ![1, 2].includes(message.player)) throw new Error('Vị trí bàn cờ không hợp lệ.');
  const timeout = Math.max(100, Math.min(60000, Math.round(Number(message.timeoutMs) || 1000)));
  activeSearch = { id: message.id, result: null, error: null };
  engine.sendCommand(`INFO TIMEOUT_TURN ${timeout}`);
  engine.sendCommand('INFO TIMEOUT_MATCH 1000000000');
  engine.sendCommand('INFO TIME_LEFT 1000000000');
  const position = message.moves.map((move) => {
    if (!Number.isInteger(move.col) || !Number.isInteger(move.row) || move.col < 0 || move.col > 14 || move.row < 0 || move.row > 14 || ![1, 2].includes(move.player)) throw new Error('Tọa độ nước đi không hợp lệ.');
    return `${move.col},${move.row},${move.player === message.player ? 1 : 2}`;
  });
  engine.sendCommand(`BOARD\n${position.join('\n')}\nDONE`);
  const finished = activeSearch;
  activeSearch = null;
  if (finished.error) throw new Error(finished.error);
  if (!finished.result) throw new Error('Rapfi chưa trả về tọa độ nước đi.');
  self.postMessage({ type: 'result', id: message.id, result: finished.result });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      initialization = initialization || initialize();
      await initialization;
    } else if (data.type === 'think') {
      if (!initialization) throw new Error('Engine chưa được khởi tạo.');
      await initialization;
      search(data);
    }
  } catch (error) {
    activeSearch = null;
    self.postMessage({ type: 'error', id: data.id, message: error.message || String(error) });
  }
};
