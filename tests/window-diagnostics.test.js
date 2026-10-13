const assert = require('assert');
const { EventEmitter } = require('events');
const { PassThrough, Writable } = require('stream');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'WindowDiagnostics.js');
const source = fs.readFileSync(sourcePath, 'utf8');

// Exercise the real process/stream lifecycle without Windows or changing any window state.
function createHarness(platform = 'win32', spawnFails = false) {
  const logs = [];
  const writes = [];
  const timers = new Map();
  const spawns = [];
  let now = 1000;
  let timerId = 0;
  let killed = 0;
  const window = new EventEmitter();
  Object.assign(window, {
    id: 7, isDestroyed: () => false, isAlwaysOnTop: () => true,
    isFocused: () => false, isVisible: () => true, isMinimized: () => false,
    isMaximized: () => false, isFullScreen: () => false,
    getBounds: () => ({ x: 10, y: 20, width: 86, height: 234 }),
    getNativeWindowHandle: () => Buffer.from([42, 0, 0, 0, 0, 0, 0, 0])
  });
  for (const method of ['moveTop', 'setAlwaysOnTop', 'focus', 'show', 'hide', 'setBounds']) {
    window[method] = () => assert.fail(`Diagnostics must not call ${method}`);
  }
  const child = new EventEmitter();
  child.stdin = new Writable({ write(chunk, encoding, done) { writes.push(chunk.toString()); done(); } });
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { killed++; };
  const schedule = (callback, delay, repeat) => {
    const id = ++timerId;
    timers.set(id, { callback, delay, repeat });
    return id;
  };
  const host = vm.createContext({
    require: (name) => name === 'child_process' ? { spawn: (...args) => {
      spawns.push(args);
      if (spawnFails) throw new Error('spawn failed');
      return child;
    } } : require(name),
    module: { exports: {} }, __dirname: path.dirname(sourcePath), Buffer,
    process: { platform, arch: 'x64', versions: { electron: 'test' }, env: { SystemRoot: 'C:\\Windows' } },
    Date: { now: () => now },
    setTimeout: (callback, delay) => schedule(callback, delay, false),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearInterval: (id) => timers.delete(id)
  });
  vm.runInContext(source, host, { filename: sourcePath });
  host.module.exports.startWindowDiagnostics(window, () => true, (line) => logs.push(line));
  const runTimers = (repeat) => {
    for (const [id, timer] of Array.from(timers)) {
      if (timer.repeat !== repeat) continue;
      if (!repeat) timers.delete(id);
      timer.callback();
    }
  };
  return {
    window, child, logs, writes, timers, spawns, killed: () => killed,
    tick: (elapsed = 1000) => { now += elapsed; runTimers(true); },
    timeout: () => runTimers(false),
    reply: (state) => child.stdout.write(JSON.stringify({ sampledAt: String(now), state }) + '\n')
  };
}

const nativeState = (topmost = true) => ({
  own: { hwnd: '42', topmost, pid: 10 },
  foreground: { hwnd: '99', topmost: false, pid: 20, processName: 'example' },
  overlapCandidatesAbove: [], overlapCount: 0, scanTruncated: false
});

const tests = [
  ['native changes without Electron events are logged; identical samples are limited', () => {
    const h = createHarness();
    h.reply(nativeState());
    const count = h.logs.length;
    h.tick();
    h.reply(nativeState());
    assert.strictEqual(h.logs.length, count);
    h.tick();
    h.reply(nativeState(false));
    assert(h.logs[h.logs.length - 1].includes('"alwaysOnTop":true'));
    assert(h.logs[h.logs.length - 1].includes('"topmost":false'));
    const changed = h.logs.length;
    h.tick(60000);
    h.reply(nativeState(false));
    assert.strictEqual(h.logs.length, changed + 1);
    h.window.emit('closed');
  }],
  ['a slow helper has only one request in flight and cannot block window events', () => {
    const h = createHarness();
    h.tick();
    h.tick();
    h.window.emit('blur');
    assert.deepStrictEqual(h.writes, ['42\n']);
    assert(h.logs.some((line) => line.includes('reason: blur')));
    h.timeout();
    assert.strictEqual(h.killed(), 1);
    assert(h.logs.some((line) => line.includes('query timed out')));
    h.tick();
    assert.strictEqual(h.spawns.length, 1, 'Do not repeatedly spawn a failing helper');
    assert(h.logs[h.logs.length - 1].includes('nativeStatus: unavailable'));
    h.window.emit('closed');
  }],
  ['UTF-8 JSON split across chunks preserves the covering process information', () => {
    const h = createHarness();
    const state = nativeState();
    state.overlapCandidatesAbove = [{ pid: 30, topmost: false, processName: '예시' }];
    state.overlapCount = 1;
    const data = Buffer.from(JSON.stringify({ sampledAt: 'test', state }) + '\n');
    const split = data.indexOf(Buffer.from('예시')) + 1;
    h.child.stdout.write(data.subarray(0, split));
    h.child.stdout.write(data.subarray(split));
    assert(h.logs[h.logs.length - 1].includes('"processName":"예시"'));
    h.window.emit('closed');
  }],
  ['helper failure is one line and leaves Electron event diagnostics running', () => {
    const h = createHarness();
    h.child.stderr.write('first line\nsecond line\r\n');
    h.child.emit('error', new Error('access denied\nextra'));
    h.child.emit('close', 1, null);
    h.child.stdin.emit('error', new Error('pipe closed'));
    const warnings = h.logs.filter((line) => line.includes('native unavailable'));
    assert.strictEqual(warnings.length, 1);
    assert(!/[\r\n]/.test(warnings[0]));
    h.window.emit('restore');
    assert(h.logs[h.logs.length - 1].includes('reason: restore'));
    h.window.emit('closed');
  }],
  ['closing a window cancels polling and the helper without a false failure', () => {
    const h = createHarness();
    h.window.emit('closed');
    assert.strictEqual(h.timers.size, 0);
    assert.strictEqual(h.killed(), 1);
    assert.strictEqual(h.window.listenerCount('blur'), 0);
    h.child.emit('close', 0, null);
    h.child.stdin.emit('error', new Error('closed'));
    assert(!h.logs.some((line) => line.includes('native unavailable')));
  }],
  ['missing PowerShell does not prevent window diagnostics from starting', () => {
    const h = createHarness('win32', true);
    h.window.emit('focus');
    assert(h.logs.some((line) => line.includes('spawn failed')));
    assert(h.logs[h.logs.length - 1].includes('reason: focus'));
    h.window.emit('closed');
  }],
  ['non-Windows platforms use Electron diagnostics without a helper', () => {
    const h = createHarness('linux');
    assert.strictEqual(h.spawns.length, 0);
    h.window.emit('hide');
    assert(h.logs[h.logs.length - 1].includes('nativeStatus: unsupported'));
    h.window.emit('closed');
  }]
];

for (const [name, test] of tests) {
  test();
  console.log(`PASS ${name}`);
}
