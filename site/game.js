(() => {
  'use strict';

  const SIZE = 15;
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const GRID_HALF = 5;
  const GRID_STEP = (GRID_HALF * 2) / (SIZE - 1);
  const SURFACE_Y = 0.405;
  const stageHost = document.getElementById('stage');
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const el = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const colorFor = (player) => player === BLACK ? 'Đen' : 'Trắng';
  let app, camera, renderer, raycaster, boardTop, piecesGroup, hoverStone, thinkingGroup, thinkingRing, thinkingDot;
  let mode = 'local';
  let humanColor = BLACK;
  let botsPaused = false;
  let roundToken = 0;
  let aiSerial = Promise.resolve();
  let engineState = 'idle';
  let engineDetail = 'NNUE Mix9svq · phát hành 250615 · chạy trên thiết bị';
  let timeoutTurn = 1000;
  let thinkingCell = { col: 7, row: 7 };
  let turn = BLACK;
  let moves = [];
  let gameOver = false;
  let winnerLine = [];
  let aiThinking = false;
  let aiTimer = 0;
  let hoverCell = null;
  let scores = { black: 0, white: 0, draws: 0 };
  let zoom = 1.05;
  let orbitAngle = 0;
  let orbitElevation = 0.72;
  const cameraRadius = 16.2;
  const cameraTarget = new THREE.Vector3(0, 0.15, 0);
  const pointerMap = new Map();
  let gesture = null;
  let pinchDistance = 0;
  let orbitStart = null;
  let lastRender = 0;

  try { scores = { ...scores, ...JSON.parse(localStorage.getItem('caro3d-score') || '{}') }; } catch (_) {}
  try { timeoutTurn = clamp(Number(localStorage.getItem('caro3d-timeout-turn')) || 1000, 100, 60000); } catch (_) {}
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isAITurn = () => !gameOver && (mode === 'bots' || (mode === 'cpu' && turn !== humanColor));
  const canHumanPlay = () => !gameOver && !aiThinking && !isAITurn();
  const rapfi = window.RapfiClient ? new window.RapfiClient((state, detail) => {
    engineState = state;
    engineDetail = detail;
    updateEngineUI();
    if (state === 'ready' || state === 'error') updateUI();
    if (state === 'ready') scheduleAI();
    requestRender();
  }) : null;
  if (!window.THREE || !THREE.WebGLRenderer) {
    showError('Không tải được thư viện 3D. Hãy kiểm tra kết nối rồi tải lại trang.');
    return;
  }

  function showError(message) {
    const loading = el('stage-loading');
    loading.textContent = message;
    loading.style.padding = '24px';
    loading.style.textAlign = 'center';
  }

  function saveScores() {
    try { localStorage.setItem('caro3d-score', JSON.stringify(scores)); } catch (_) {}
  }

  function woodTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 1024, 1024);
    base.addColorStop(0, '#d9a96c');
    base.addColorStop(.45, '#c99459');
    base.addColorStop(1, '#e0b77d');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 1024, 1024);
    let seed = 491;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < 220; i++) {
      const y = random() * 1024;
      const wave = random() * 20 + 2;
      const amplitude = random() * 6 + 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(250, y + Math.sin(i) * wave, 690, y + Math.cos(i * 1.3) * amplitude, 1024, y + Math.sin(i * .5) * wave);
      ctx.strokeStyle = i % 4 === 0 ? `rgba(91,48,21,${.025 + random() * .045})` : `rgba(255,236,192,${.025 + random() * .08})`;
      ctx.lineWidth = random() * 2.2 + .45;
      ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const x = 140 + i * 185 + random() * 35;
      const y = 160 + random() * 680;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1.8, .52);
      for (let r = 1; r <= 5; r++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 11, r * 5, random() * .12, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(99,55,25,${.035 + random() * .025})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      ctx.restore();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    return texture;
  }

  const textMaterials = new Map();
  function textMaterial(text, color) {
    const key = `${color}:${text}`;
    if (textMaterials.has(key)) return textMaterials.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = color;
    ctx.font = `750 ${String(text).length > 2 ? 58 : 76}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(text), 64, 67);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
    textMaterials.set(key, material);
    return material;
  }

  function addBoardLabel(text, x, z) {
    const label = new THREE.Mesh(new THREE.PlaneGeometry(.34, .34), textMaterial(text, '#56351e'));
    label.rotation.x = -Math.PI / 2;
    label.position.set(x, SURFACE_Y + .025, z);
    app.add(label);
  }

  function makeBoard() {
    const wood = woodTexture();
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(11.65, 1.18, 11.65),
      new THREE.MeshStandardMaterial({ color: 0x70401f, roughness: .44, metalness: .03 })
    );
    base.position.y = -.23;
    base.castShadow = true;
    base.receiveShadow = true;
    base.userData.kind = 'base';
    app.add(base);

    boardTop = new THREE.Mesh(
      new THREE.BoxGeometry(11.43, .075, 11.43),
      new THREE.MeshStandardMaterial({ map: wood, color: 0xffffff, roughness: .73, metalness: .015 })
    );
    boardTop.position.y = .36;
    boardTop.receiveShadow = true;
    boardTop.castShadow = true;
    boardTop.userData.kind = 'top';
    app.add(boardTop);

    const trim = new THREE.MeshStandardMaterial({ color: 0x925d32, roughness: .52, metalness: .025 });
    const lip = new THREE.Mesh(new THREE.BoxGeometry(11.52, .035, 11.52), trim);
    lip.position.y = .325;
    lip.receiveShadow = true;
    app.add(lip);

    const lineMat = new THREE.MeshStandardMaterial({ color: 0x503019, roughness: .82, metalness: 0 });
    const lineHeight = .013;
    for (let index = 0; index < SIZE; index++) {
      const pos = -GRID_HALF + GRID_STEP * index;
      const vertical = new THREE.Mesh(new THREE.BoxGeometry(.018, lineHeight, GRID_HALF * 2), lineMat);
      vertical.position.set(pos, SURFACE_Y + .007, 0);
      vertical.receiveShadow = true;
      app.add(vertical);
      const horizontal = new THREE.Mesh(new THREE.BoxGeometry(GRID_HALF * 2, lineHeight, .018), lineMat);
      horizontal.position.set(0, SURFACE_Y + .007, pos);
      horizontal.receiveShadow = true;
      app.add(horizontal);
    }

    const starMat = new THREE.MeshStandardMaterial({ color: 0x533119, roughness: .75 });
    const starGeo = new THREE.CylinderGeometry(.052, .052, .018, 16);
    [3, 7, 11].forEach((row) => [3, 7, 11].forEach((col) => {
      const star = new THREE.Mesh(starGeo, starMat);
      star.position.set(-GRID_HALF + col * GRID_STEP, SURFACE_Y + .016, -GRID_HALF + row * GRID_STEP);
      app.add(star);
    }));
    for (let index = 0; index < SIZE; index++) {
      const position = -GRID_HALF + index * GRID_STEP;
      addBoardLabel(String.fromCharCode(65 + index), position, -5.42);
      addBoardLabel(String.fromCharCode(65 + index), position, 5.42);
      addBoardLabel(index + 1, -5.42, position);
      addBoardLabel(index + 1, 5.42, position);
    }

    thinkingGroup = new THREE.Group();
    thinkingRing = new THREE.Mesh(new THREE.TorusGeometry(.43, .022, 10, 64), new THREE.MeshBasicMaterial({ color: 0xffd991, transparent: true, opacity: .85, depthWrite: false }));
    thinkingRing.rotation.x = -Math.PI / 2;
    thinkingGroup.add(thinkingRing);
    const outer = new THREE.Mesh(new THREE.TorusGeometry(.56, .012, 8, 64), new THREE.MeshBasicMaterial({ color: 0xffd991, transparent: true, opacity: .3, depthWrite: false }));
    outer.rotation.x = -Math.PI / 2;
    thinkingGroup.add(outer);
    thinkingDot = new THREE.Mesh(new THREE.SphereGeometry(.055, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffedba }));
    thinkingGroup.add(thinkingDot);
    thinkingGroup.visible = false;
    app.add(thinkingGroup);
  }

  function updateCamera() {
    if (!camera) return;
    const horizontal = cameraRadius * Math.cos(orbitElevation);
    camera.position.set(
      cameraTarget.x + Math.sin(orbitAngle) * horizontal,
      cameraTarget.y + Math.sin(orbitElevation) * cameraRadius,
      cameraTarget.z + Math.cos(orbitAngle) * horizontal
    );
    camera.lookAt(cameraTarget);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    el('zoom-value').textContent = `${Math.round(zoom * 100)}%`;
    requestRender();
  }

  function requestRender() {
    if (!renderer || !app) return;
    if (lastRender) return;
    lastRender = requestAnimationFrame((time) => {
      lastRender = 0;
      const animating = aiThinking && engineState === 'ready';
      if (thinkingGroup) {
        thinkingGroup.visible = animating;
        if (animating) {
          const phase = reducedMotion ? 0 : time * .005;
          thinkingGroup.position.set(-GRID_HALF + thinkingCell.col * GRID_STEP, SURFACE_Y + .045, -GRID_HALF + thinkingCell.row * GRID_STEP);
          thinkingRing.scale.setScalar(1 + Math.sin(phase) * .12);
          thinkingRing.material.opacity = .68 + Math.sin(phase) * .23;
          thinkingDot.position.set(Math.cos(phase) * .56, .035, Math.sin(phase) * .56);
        }
      }
      renderer.render(app, camera);
      if (animating && !reducedMotion) requestRender();
    });
  }

  function changeZoom(amount) {
    zoom = clamp(zoom + amount, .76, 2.05);
    updateCamera();
  }

  function resetView() {
    zoom = 1.05;
    orbitAngle = 0;
    orbitElevation = .72;
    updateCamera();
  }

  function cellAt(clientX, clientY) {
    if (!renderer || !boardTop) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const point = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(point, camera);
    const hit = raycaster.intersectObject(boardTop, false)[0];
    if (!hit) return null;
    const colF = (hit.point.x + GRID_HALF) / GRID_STEP;
    const rowF = (hit.point.z + GRID_HALF) / GRID_STEP;
    const col = Math.round(colF);
    const row = Math.round(rowF);
    if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return null;
    if (Math.hypot(colF - col, rowF - row) > .58) return null;
    return { col, row };
  }

  function updateHover(cell) {
    if (cell?.col === hoverCell?.col && cell?.row === hoverCell?.row) return;
    hoverCell = cell;
    if (!piecesGroup || !hoverStone) return;
    if (hoverStone.parent) hoverStone.parent.remove(hoverStone);
    if (hoverCell && canHumanPlay() && board[hoverCell.row][hoverCell.col] === EMPTY) {
      hoverStone.material = turn === BLACK ? blackGhost : whiteGhost;
      hoverStone.position.set(-GRID_HALF + hoverCell.col * GRID_STEP, SURFACE_Y + .15, -GRID_HALF + hoverCell.row * GRID_STEP);
      piecesGroup.add(hoverStone);
    }
    requestRender();
  }

  const stoneGeometry = new THREE.SphereGeometry(.29, 32, 24);
  const blackMaterial = new THREE.MeshPhysicalMaterial({ color: 0x151c26, roughness: .19, metalness: .28, clearcoat: .82, clearcoatRoughness: .15 });
  const whiteMaterial = new THREE.MeshPhysicalMaterial({ color: 0xf1e8d8, roughness: .22, metalness: .025, clearcoat: .6, clearcoatRoughness: .18 });
  const blackGhost = new THREE.MeshStandardMaterial({ color: 0x222b39, roughness: .25, transparent: true, opacity: .55 });
  const whiteGhost = new THREE.MeshStandardMaterial({ color: 0xfff5dd, roughness: .25, transparent: true, opacity: .62 });
  const lastRingGeometry = new THREE.TorusGeometry(.39, .018, 10, 48);
  const lastRingMaterial = new THREE.MeshStandardMaterial({ color: 0xf0c477, emissive: 0x6d3f0c, emissiveIntensity: .35, roughness: .38 });
  const winRingMaterial = new THREE.MeshStandardMaterial({ color: 0x8ce0c9, emissive: 0x155c4b, emissiveIntensity: .6, roughness: .3 });
  const numberGeometry = new THREE.PlaneGeometry(.38, .38);

  function drawPieces() {
    if (!piecesGroup) return;
    while (piecesGroup.children.length) piecesGroup.remove(piecesGroup.children[0]);
    const winning = new Set(winnerLine.map((point) => `${point.col},${point.row}`));
    const moveNumbers = new Map(moves.map((move, index) => [`${move.col},${move.row}`, index + 1]));
    const last = moves[moves.length - 1];
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const player = board[row][col];
        if (!player) continue;
        const stone = new THREE.Mesh(stoneGeometry, player === BLACK ? blackMaterial : whiteMaterial);
        stone.scale.y = .50;
        stone.position.set(-GRID_HALF + col * GRID_STEP, SURFACE_Y + .145, -GRID_HALF + row * GRID_STEP);
        stone.castShadow = true;
        stone.receiveShadow = true;
        stone.userData.kind = 'piece';
        piecesGroup.add(stone);
        const key = `${col},${row}`;
        const number = new THREE.Mesh(numberGeometry, textMaterial(moveNumbers.get(key), player === BLACK ? '#fff0cd' : '#322b24'));
        number.rotation.x = -Math.PI / 2;
        number.position.set(stone.position.x, SURFACE_Y + .302, stone.position.z);
        number.userData.kind = 'move-number';
        piecesGroup.add(number);
        if ((last && last.col === col && last.row === row) || winning.has(key)) {
          const ring = new THREE.Mesh(lastRingGeometry, winning.has(key) ? winRingMaterial : lastRingMaterial);
          ring.rotation.x = Math.PI / 2;
          ring.position.set(-GRID_HALF + col * GRID_STEP, SURFACE_Y + .018, -GRID_HALF + row * GRID_STEP);
          piecesGroup.add(ring);
        }
      }
    }
    if (hoverStone && hoverCell && canHumanPlay() && board[hoverCell.row][hoverCell.col] === EMPTY) {
      hoverStone.material = turn === BLACK ? blackGhost : whiteGhost;
      hoverStone.position.set(-GRID_HALF + hoverCell.col * GRID_STEP, SURFACE_Y + .15, -GRID_HALF + hoverCell.row * GRID_STEP);
      piecesGroup.add(hoverStone);
    }
    requestRender();
  }

  function lineFrom(row, col, player, dc, dr) {
    const line = [{ row, col }];
    for (const sign of [-1, 1]) {
      let c = col + dc * sign;
      let r = row + dr * sign;
      while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === player) {
        line.push({ row: r, col: c });
        c += dc * sign;
        r += dr * sign;
      }
    }
    return line;
  }

  function playerName(player) {
    if (mode === 'bots') return player === BLACK ? 'Rapfi Đen' : 'Rapfi Trắng';
    if (mode === 'cpu') return player === humanColor ? 'Bạn' : 'Rapfi';
    return player === BLACK ? 'Người chơi 1' : 'Người chơi 2';
  }

  function updateEngineUI() {
    const status = el('engine-status');
    if (!status) return;
    status.textContent = engineState === 'ready' ? 'Rapfi WASM · Sẵn sàng' : engineState === 'loading' ? 'Rapfi WASM · Đang tải' : engineState === 'error' ? 'Rapfi WASM · Cần tải lại' : 'Rapfi WASM · Chưa tải';
    status.dataset.state = engineState;
    el('engine-detail').textContent = engineState === 'ready' ? `${engineDetail} · ${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(timeoutTurn / 1000)} giây/nước` : engineDetail;
    el('engine-retry').hidden = engineState !== 'error';
  }

  function updateUI() {
    const botTurn = isAITurn();
    const activePlayer = gameOver ? 0 : turn;
    const paused = mode === 'bots' && botsPaused && !gameOver;
    el('turn-stone').className = `turn-stone${activePlayer === WHITE ? ' white' : ''}`;
    el('turn-label').textContent = gameOver ? (winnerLine.length ? 'TRẬN ĐẤU KẾT THÚC' : 'HÒA CỜ') : paused ? 'TẠM DỪNG' : aiThinking ? (engineState === 'ready' ? 'ĐANG SUY NGHĨ' : 'ĐANG CHUẨN BỊ ENGINE') : 'ĐẾN LƯỢT';
    el('turn-name').textContent = gameOver ? (winnerLine.length ? `Quân ${colorFor(turn).toLowerCase()} chiến thắng` : 'Không còn ô trống') : paused ? 'Trận tự đấu đang dừng' : aiThinking ? `${playerName(turn)} đang chọn nước` : `Quân ${colorFor(turn).toLowerCase()}`;
    el('turn-sub').textContent = gameOver ? 'Nhấn “Ván mới” để chơi tiếp' : paused ? 'Nhấn “Tiếp tục AI” để xem tiếp' : botTurn ? 'Rapfi · NNUE · tính toán trên thiết bị' : mode === 'cpu' ? `Bạn cầm quân ${colorFor(humanColor).toLowerCase()}` : playerName(turn);
    el('player-black').classList.toggle('active', activePlayer === BLACK);
    el('player-white').classList.toggle('active', activePlayer === WHITE);
    el('black-name').textContent = playerName(BLACK);
    el('white-name').textContent = playerName(WHITE);
    el('black-score').textContent = scores.black;
    el('white-score').textContent = scores.white;
    el('move-count').textContent = `${String(moves.length).padStart(2, '0')} nước`;
    el('undo-btn').disabled = moves.length === 0 || aiThinking || (mode === 'bots' && !botsPaused && !gameOver) || (mode === 'cpu' && humanColor === WHITE && moves.length === 1);
    for (const value of ['local', 'cpu', 'bots']) {
      el(`mode-${value}`).classList.toggle('active', mode === value);
      el(`mode-${value}`).setAttribute('aria-pressed', String(mode === value));
    }
    el('first-choice').hidden = mode !== 'cpu';
    el('first-human').setAttribute('aria-pressed', String(humanColor === BLACK));
    el('first-ai').setAttribute('aria-pressed', String(humanColor === WHITE));
    el('pause-btn').hidden = mode !== 'bots';
    el('pause-btn').textContent = botsPaused ? 'Tiếp tục AI' : 'Tạm dừng AI';
    el('pause-btn').disabled = gameOver;
    stageHost.dataset.aiThinking = String(aiThinking && engineState === 'ready');
    stageHost.dataset.mode = mode;
    const recent = moves.slice(-5).reverse();
    el('history').innerHTML = recent.length
      ? recent.map((move, index) => `<div class="history-item"><span class="history-left"><span class="history-number">${String(moves.length - index).padStart(2, '0')}</span><span class="history-color${move.player === WHITE ? ' white' : ''}"></span><span>${colorFor(move.player)} · ${String.fromCharCode(65 + move.col)}${move.row + 1}</span></span><span style="color:#a7aeb6">${move.player === BLACK ? '●' : '○'}</span></div>`).join('')
      : '<div class="history-empty">Chưa có nước đi nào.</div>';
    drawPieces();
  }

  function makeMove(col, row, player) {
    if (gameOver || player !== turn || !Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= SIZE || col < 0 || col >= SIZE || board[row][col] !== EMPTY) return false;
    board[row][col] = player;
    moves.push({ col, row, player });
    const winning = directions.map(([dc, dr]) => lineFrom(row, col, player, dc, dr)).find((line) => line.length >= 5);
    if (winning) {
      gameOver = true;
      winnerLine = winning;
      if (player === BLACK) scores.black++;
      else scores.white++;
      saveScores();
    } else if (moves.length === SIZE * SIZE) {
      gameOver = true;
      scores.draws++;
      saveScores();
    } else {
      turn = player === BLACK ? WHITE : BLACK;
    }
    hoverCell = null;
    updateUI();
    return true;
  }

  function playAt(col, row) {
    if (!canHumanPlay() || board[row][col] !== EMPTY) return;
    makeMove(col, row, turn);
    scheduleAI();
  }

  function cancelAITurn() {
    roundToken++;
    if (aiTimer) window.clearTimeout(aiTimer);
    aiTimer = 0;
    aiThinking = false;
  }

  function scheduleAI() {
    if (!isAITurn() || aiThinking || (mode === 'bots' && botsPaused) || engineState === 'error') return;
    const token = roundToken;
    const player = turn;
    aiThinking = true;
    thinkingCell = moves.length ? { col: moves[moves.length - 1].col, row: moves[moves.length - 1].row } : { col: 7, row: 7 };
    hoverCell = null;
    updateUI();
    aiTimer = window.setTimeout(() => {
      aiTimer = 0;
      aiSerial = aiSerial.catch(() => {}).then(async () => {
        if (token !== roundToken || !isAITurn() || turn !== player || (mode === 'bots' && botsPaused)) return;
        if (!rapfi) throw new Error('Không tải được bộ điều khiển Rapfi. Hãy tải lại trang.');
        const result = await rapfi.think(moves.map((move) => ({ ...move })), player, timeoutTurn, (cell) => {
          if (token !== roundToken || !aiThinking || cell.col < 0 || cell.col >= SIZE || cell.row < 0 || cell.row >= SIZE) return;
          thinkingCell = cell;
          requestRender();
        });
        if (token !== roundToken || !isAITurn() || turn !== player || (mode === 'bots' && botsPaused)) return;
        aiThinking = false;
        if (!makeMove(result.col, result.row, player)) throw new Error('Rapfi trả về một nước không hợp lệ. Hãy tải lại engine.');
        scheduleAI();
      }).catch((error) => {
        if (token !== roundToken) return;
        aiThinking = false;
        engineState = 'error';
        engineDetail = error.message || 'Không thể khởi chạy Rapfi WASM.';
        updateEngineUI();
        updateUI();
      });
    }, mode === 'bots' ? 360 : 80);
  }

  function preloadEngine() {
    if (mode === 'local' || !rapfi) return;
    rapfi.load().catch(() => {
      if (mode !== 'local' && aiThinking) {
        cancelAITurn();
        updateUI();
      }
    });
  }

  function setMode(value) {
    if (mode === value) return;
    mode = value;
    resetRound();
    preloadEngine();
  }

  function setFirstPlayer(value) {
    if (humanColor === value) return;
    humanColor = value;
    resetRound();
  }

  function togglePause() {
    if (mode !== 'bots' || gameOver) return;
    cancelAITurn();
    botsPaused = !botsPaused;
    updateUI();
    scheduleAI();
  }

  function updateTimeout() {
    const input = el('timeout-turn');
    timeoutTurn = Math.round(clamp(Number(input.value) || 1000, 100, 60000));
    input.value = timeoutTurn;
    try { localStorage.setItem('caro3d-timeout-turn', String(timeoutTurn)); } catch (_) {}
    updateEngineUI();
  }

  function resetRound() {
    cancelAITurn();
    for (let row = 0; row < SIZE; row++) board[row].fill(EMPTY);
    moves = [];
    turn = BLACK;
    gameOver = false;
    botsPaused = false;
    winnerLine = [];
    hoverCell = null;
    updateUI();
    scheduleAI();
  }

  function undoMove() {
    if (el('undo-btn').disabled) return;
    cancelAITurn();
    if (gameOver) {
      if (winnerLine.length) {
        const last = moves[moves.length - 1];
        if (last.player === BLACK) scores.black = Math.max(0, scores.black - 1);
        else scores.white = Math.max(0, scores.white - 1);
      } else if (moves.length === SIZE * SIZE) scores.draws = Math.max(0, scores.draws - 1);
      saveScores();
    }
    do {
      const move = moves.pop();
      if (!move) break;
      board[move.row][move.col] = EMPTY;
      turn = moves.length % 2 ? WHITE : BLACK;
    } while (mode === 'cpu' && moves.length && turn !== humanColor);
    gameOver = false;
    winnerLine = [];
    hoverCell = null;
    if (mode === 'bots') botsPaused = true;
    updateUI();
    scheduleAI();
  }

  function pointerDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function attachInteractions() {
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Bàn caro 3D. Chạm giao điểm để đặt quân, kéo để xoay và chụm hai ngón để phóng to.');

    canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      if (pointerMap.size === 1) {
        gesture = 'tap';
        orbitStart = { x: event.clientX, y: event.clientY, angle: orbitAngle, elevation: orbitElevation };
      } else if (pointerMap.size >= 2) {
        gesture = 'pinch';
        const points = [...pointerMap.values()];
        pinchDistance = pointerDistance(points[0], points[1]);
      }
    });

    canvas.addEventListener('pointermove', (event) => {
      const active = pointerMap.get(event.pointerId);
      if (active) {
        active.x = event.clientX;
        active.y = event.clientY;
        if (pointerMap.size >= 2) {
          const points = [...pointerMap.values()];
          const distance = pointerDistance(points[0], points[1]);
          if (pinchDistance > 0 && distance > 0) {
            zoom = clamp(zoom * (distance / pinchDistance), .76, 2.05);
            updateCamera();
          }
          pinchDistance = distance;
          gesture = 'pinch';
          return;
        }
        if (gesture === 'tap' && Math.hypot(event.clientX - active.startX, event.clientY - active.startY) > 8) gesture = 'orbit';
        if (gesture === 'orbit' && orbitStart) {
          orbitAngle = orbitStart.angle - (event.clientX - orbitStart.x) * .006;
          orbitElevation = clamp(orbitStart.elevation + (event.clientY - orbitStart.y) * .0045, .36, 1.28);
          updateCamera();
        }
        return;
      }
      if (event.pointerType !== 'touch' && !pointerMap.size) updateHover(cellAt(event.clientX, event.clientY));
    });

    const finishPointer = (event) => {
      const active = pointerMap.get(event.pointerId);
      if (!active) return;
      const shouldPlay = gesture === 'tap' && pointerMap.size === 1 && Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < 9;
      if (shouldPlay) {
        const cell = cellAt(event.clientX, event.clientY);
        if (cell) playAt(cell.col, cell.row);
      }
      pointerMap.delete(event.pointerId);
      if (!pointerMap.size) {
        gesture = null;
        orbitStart = null;
        pinchDistance = 0;
      }
      if (event.pointerType !== 'touch') updateHover(cellAt(event.clientX, event.clientY));
    };
    canvas.addEventListener('pointerup', finishPointer);
    canvas.addEventListener('pointercancel', finishPointer);
    canvas.addEventListener('pointerleave', (event) => {
      if (!pointerMap.size && event.pointerType !== 'touch') updateHover(null);
    });
    stageHost.addEventListener('wheel', (event) => {
      event.preventDefault();
      changeZoom(event.deltaY < 0 ? .08 : -.08);
    }, { passive: false });

    el('zoom-in').addEventListener('click', () => changeZoom(.12));
    el('zoom-out').addEventListener('click', () => changeZoom(-.12));
    el('zoom-reset').addEventListener('click', resetView);
  }

  function setup() {
    try {
      app = new THREE.Scene();
      app.background = new THREE.Color(0x191a19);
      camera = new THREE.PerspectiveCamera(37, stageHost.clientWidth / stageHost.clientHeight, .1, 100);
      renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
      renderer.setSize(stageHost.clientWidth, stageHost.clientHeight, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.14;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.inset = '0';
      stageHost.appendChild(renderer.domElement);
      raycaster = new THREE.Raycaster();

      app.add(new THREE.HemisphereLight(0xf4f4ff, 0x62401f, 2.2));
      const keyLight = new THREE.DirectionalLight(0xffe5be, 3.1);
      keyLight.position.set(-6, 12, 8);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1536, 1536);
      keyLight.shadow.camera.left = -9;
      keyLight.shadow.camera.right = 9;
      keyLight.shadow.camera.top = 10;
      keyLight.shadow.camera.bottom = -9;
      keyLight.shadow.bias = -.00025;
      keyLight.shadow.normalBias = .035;
      app.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xb7d5ff, 1.05);
      fillLight.position.set(7, 7, -6);
      app.add(fillLight);

      piecesGroup = new THREE.Group();
      piecesGroup.name = 'Caro pieces';
      app.add(piecesGroup);
      hoverStone = new THREE.Mesh(stoneGeometry, blackGhost);
      hoverStone.scale.y = .5;
      makeBoard();
      updateCamera();
      attachInteractions();

      const resizeObserver = new ResizeObserver(() => {
        if (!renderer) return;
        const width = stageHost.clientWidth;
        const height = stageHost.clientHeight;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        requestRender();
      });
      resizeObserver.observe(stageHost);
      el('stage-loading').remove();
      updateUI();
    } catch (error) {
      console.error('3D board initialization failed', error);
      showError('Thiết bị chưa khởi tạo được bàn cờ 3D. Hãy tải lại trang hoặc thử trình duyệt khác.');
    }
  }

  for (const value of ['local', 'cpu', 'bots']) el(`mode-${value}`).addEventListener('click', () => setMode(value));
  el('first-human').addEventListener('click', () => setFirstPlayer(BLACK));
  el('first-ai').addEventListener('click', () => setFirstPlayer(WHITE));
  el('pause-btn').addEventListener('click', togglePause);
  el('timeout-turn').value = timeoutTurn;
  el('timeout-turn').addEventListener('change', updateTimeout);
  el('engine-retry').addEventListener('click', () => {
    cancelAITurn();
    if (rapfi) rapfi.retry();
    engineState = 'idle';
    engineDetail = 'Đang chuẩn bị lại Rapfi và weights phát hành…';
    updateEngineUI();
    updateUI();
    preloadEngine();
    scheduleAI();
  });
  el('undo-btn').addEventListener('click', undoMove);
  el('reset-btn').addEventListener('click', resetRound);
  el('new-btn').addEventListener('click', resetRound);
  updateEngineUI();
  updateUI();
  setup();
})();
