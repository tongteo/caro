(() => {
  'use strict';

  class RapfiClient {
    constructor(onState) {
      this.onState = onState;
      this.worker = null;
      this.ready = false;
      this.loading = null;
      this.pending = new Map();
      this.sequence = 0;
      this.startTimer = 0;
    }

    load() {
      if (this.ready) return Promise.resolve(this);
      if (this.loading) return this.loading;
      if (!window.Worker || !window.WebAssembly) {
        const error = new Error('Trình duyệt này chưa hỗ trợ WebAssembly và Web Worker. Chế độ 2 người vẫn dùng được.');
        this.onState('error', error.message);
        return Promise.reject(error);
      }
      this.onState('loading', 'Đang tải Rapfi và weights NNUE phát hành chính thức…');
      this.loading = new Promise((resolve, reject) => {
        this.resolveStart = resolve;
        this.rejectStart = reject;
      });
      const loading = this.loading;
      try {
        this.worker = new Worker(new URL('./engine/rapfi-worker.js', document.baseURI));
        this.worker.onmessage = ({ data }) => this.receive(data);
        this.worker.onerror = (event) => {
          event.preventDefault();
          this.fail(new Error(event.message || 'Không khởi tạo được Web Worker của Rapfi.'));
        };
        this.startTimer = window.setTimeout(() => this.fail(new Error('Tải engine quá lâu. Hãy kiểm tra kết nối rồi thử lại.')), 120000);
        this.worker.postMessage({ type: 'init' });
      } catch (error) {
        this.fail(error);
      }
      return loading;
    }

    receive(message) {
      if (message.type === 'status') {
        this.onState('loading', message.detail);
      } else if (message.type === 'ready') {
        window.clearTimeout(this.startTimer);
        this.ready = true;
        this.onState('ready', `NNUE Mix9svq · 250615 · ${message.variant === 'simd' ? 'WASM SIMD' : 'WASM tương thích'}`);
        if (this.resolveStart) this.resolveStart(this);
        this.resolveStart = this.rejectStart = null;
      } else if (message.type === 'candidate') {
        const request = this.pending.get(message.id);
        if (request && request.onCandidate) request.onCandidate(message.cell);
      } else if (message.type === 'result') {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        window.clearTimeout(request.timer);
        request.resolve(message.result);
      } else if (message.type === 'error') {
        this.fail(new Error(message.message || 'Rapfi không thể tính nước đi.'));
      }
    }

    async think(moves, player, timeoutMs, onCandidate) {
      await this.load();
      const id = ++this.sequence;
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => this.fail(new Error('Engine chưa trả lời sau thời gian cho phép. Hãy tải lại engine.')), Math.max(15000, timeoutMs + 12000));
        this.pending.set(id, { resolve, reject, timer, onCandidate });
        this.worker.postMessage({ type: 'think', id, moves, player, timeoutMs });
      });
    }

    fail(error) {
      window.clearTimeout(this.startTimer);
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.ready = false;
      if (this.rejectStart) this.rejectStart(error);
      this.resolveStart = this.rejectStart = null;
      this.loading = null;
      for (const request of this.pending.values()) {
        window.clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
      this.onState('error', error.message || String(error));
    }

    retry() {
      const error = new Error('Đang khởi tạo lại engine.');
      window.clearTimeout(this.startTimer);
      if (this.worker) this.worker.terminate();
      if (this.rejectStart) this.rejectStart(error);
      for (const request of this.pending.values()) {
        window.clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
      this.worker = null;
      this.ready = false;
      this.loading = null;
      this.resolveStart = this.rejectStart = null;
    }
  }

  window.RapfiClient = RapfiClient;
})();
