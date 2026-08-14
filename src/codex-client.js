const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

class JsonLineDecoder {
  constructor(onError = () => {}) { this.buffer = ''; this.onError = onError; }
  push(chunk) {
    this.buffer += String(chunk);
    const messages = [];
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      try { messages.push(JSON.parse(line)); } catch (error) { this.onError(error); }
    }
    return messages;
  }
}

class CodexClient extends EventEmitter {
  constructor({ command = 'codex', spawnFn = spawn, timeoutMs = 15000 } = {}) {
    super(); this.command = command; this.spawnFn = spawnFn; this.timeoutMs = timeoutMs;
    this.nextId = 1; this.pending = new Map(); this.process = null; this.ready = null;
  }
  start() {
    if (this.ready) return this.ready;
    this.process = this.spawnFn(this.command, ['app-server', '--stdio'], { windowsHide: true });
    const decoder = new JsonLineDecoder(error => this.emit('warning', error));
    this.process.stdout.on('data', chunk => decoder.push(chunk).forEach(message => this.handleMessage(message)));
    this.process.stderr.on('data', chunk => this.emit('diagnostic', String(chunk)));
    this.process.on('error', error => this.failAll(error));
    this.process.on('exit', code => { this.failAll(new Error(`Codex app-server exited (${code ?? 'unknown'})`)); this.ready = null; this.process = null; });
    this.ready = this.request('initialize', { clientInfo: { name: 'throttle', title: 'Throttle', version: '0.1.4' }, capabilities: null }, true)
      .then(result => { this.send({ method: 'initialized', params: {} }); return result; });
    return this.ready;
  }
  send(message) {
    if (!this.process?.stdin?.writable) throw new Error('Codex app-server is not running');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }
  request(method, params = null, beforeReady = false) {
    const run = () => new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ method, id, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
    return beforeReady ? run() : this.start().then(run);
  }
  handleMessage(message) {
    if (message.id != null && this.pending.has(message.id)) {
      const item = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(item.timer);
      message.error ? item.reject(new Error(message.error.message || 'Codex request failed')) : item.resolve(message.result);
    } else if (message.method === 'account/rateLimits/updated') this.emit('rate-limits', message.params);
  }
  async getRateLimits() { return this.request('account/rateLimits/read'); }
  failAll(error) { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear(); }
  stop() { if (this.process) this.process.kill(); this.process = null; this.ready = null; }
}
module.exports = { JsonLineDecoder, CodexClient };
