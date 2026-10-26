const fs = require('fs');
const path = require('path');
const base = process.argv[2] || '/workspace/caro-3d/build-wasm/final';
const stem = process.argv[3] || 'rapfi-single';
const logs = [];
const data = fs.readFileSync(path.join(base, stem + '.data'));
const Module = {
  wasmBinary: fs.readFileSync(path.join(base, stem + '.wasm')),
  getPreloadedPackage(_name, _size) { return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); },
  onReceiveStdout(s) { logs.push(s); console.log(s); },
  onReceiveStderr(s) { logs.push(s); console.error(s); },
};
(async () => {
  const app = await require(path.join(base, stem + '.js'))(Module);
  for (const cmd of ['RELOADCONFIG /config.toml','INFO RULE 0','START 15','INFO TIMEOUT_TURN 300','INFO HASH_SIZE 16384','INFO SHOW_DETAIL 3']) app.sendCommand(cmd);
  app.sendCommand('BOARD\n7,7,2\nDONE');
  app.sendCommand('START 15');
  app.sendCommand('BOARD\n5,7,1\n5,6,2\n6,7,1\n6,6,2\n7,7,1\n7,6,2\n8,7,1\n8,6,2\nDONE');
  const moves = logs.filter(x => /^\d+,\d+$/.test(x));
  const nnue = logs.filter(x => /mix9svq nnue: load weight from/i.test(x));
  if (!moves.length) throw new Error('No numeric move returned');
  if (!nnue.length) throw new Error('NNUE load was not positively confirmed');
  if (!['4,7', '9,7'].includes(moves.at(-1))) throw new Error('Forced winning move was not selected');
  console.log('VALIDATION ' + JSON.stringify({stem, numericMove: moves.at(-1), forcedWinAt: ['4,7','9,7'], nnueLoadLog: nnue.at(-1)}));
})().catch(e => { console.error(e); process.exitCode = 1; });
