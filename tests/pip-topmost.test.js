const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(sourcePath, 'utf8');

// Run the real main-process handlers without opening windows or modifying runtime files.
function createHarness() {
  const logs = [];
  const topmostCalls = [];
  const ipc = new Map();
  let window;
  let recovery;
  let now = 100000;
  let raises = 0;
  class Clock extends Date {
    constructor() { super(now); }
    static now() { return now; }
  }
  class TestWindow extends EventEmitter {
    constructor(options) {
      super();
      window = this;
      this.topmost = options.alwaysOnTop;
      this.focused = false;
      this.minimized = false;
      this.visible = true;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.send = () => {};
    }
    setAlwaysOnTop(value) {
      topmostCalls.push(value);
      if (this.topmost !== value) {
        this.topmost = value;
        this.emit('always-on-top-changed', {}, value);
      }
    }
    isAlwaysOnTop() { return this.topmost; }
    isFocused() { return this.focused; }
    isMinimized() { return this.minimized; }
    isVisible() { return this.visible; }
    isDestroyed() { return this.destroyed; }
    getBounds() { return { x: 0, y: 0, width: 86, height: 234 }; }
    setMenu() {}
    loadFile() { return { catch() {} }; }
    moveTop() { raises++; }
    focus() { assert.fail('Recovery must not take focus'); }
  }
  const electron = {
    app: { commandLine: { appendSwitch() {} }, whenReady: () => ({ then: (fn) => fn() }), on() {} },
    BrowserWindow: TestWindow, session: { defaultSession: { clearCache() {} } },
    ipcMain: { on: (name, callback) => ipc.set(name, callback) }
  };
  const host = vm.createContext({
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === './WindowDiagnostics') return { startWindowDiagnostics: (win, getIsPip, log, callback) => { recovery = callback; } };
      if (name === 'fs') return {
        readFileSync: (file) => JSON.stringify(file.endsWith('channel_record.json')
          ? { date: new Clock().toISOString().slice(0, 10), index: 0 } : { name: 'test' }),
        appendFileSync: (file, line) => logs.push(line),
        writeFileSync: () => assert.fail('Unexpected runtime state write'),
        copyFileSync: () => assert.fail('Unexpected package swap')
      };
      return require(name);
    },
    __dirname: path.dirname(sourcePath), process: { pid: 10, platform: 'win32' }, Date: Clock
  });
  vm.runInContext(source, host, { filename: sourcePath });
  topmostCalls.length = 0;
  return { window, recovery, logs, topmostCalls, ipc, raises: () => raises, advance: (ms) => { now += ms; } };
}

function snapshot(topmost = true, above = [{ hwnd: '99', pid: 20, topmost: false }]) {
  return {
    own: { hwnd: '42', pid: 10, topmost, visible: true, minimized: false, cloaked: 0 },
    overlapCandidatesAbove: above, overlapCount: above.length, scanTruncated: false
  };
}

const tests = [
  ['raise only when native ordering shows an ordinary window above the PIP window', () => {
    const h = createHarness();
    h.recovery(snapshot(true, []));
    assert.strictEqual(h.raises(), 0);
    h.recovery(snapshot());
    assert.strictEqual(h.raises(), 1);
    assert.deepStrictEqual(h.topmostCalls, []);
    assert(h.logs.some((line) => line.includes('covered by normal window')));
  }],
  ['yield to topmost competitors, including another instance, and incomplete scans', () => {
    const h = createHarness();
    const anotherInstance = { hwnd: '100', pid: 30, topmost: true, processName: 'YouTubeRandomPlay' };
    const normal = { hwnd: '99', pid: 20, topmost: false };
    for (const state of [snapshot(true, [anotherInstance]), snapshot(true, [normal, anotherInstance]),
      snapshot(true, [{ topmost: null }]), { ...snapshot(), overlapCount: 6 },
      { ...snapshot(), scanTruncated: true }]) {
      h.recovery(state);
      h.advance(1000);
    }
    assert.strictEqual(h.raises(), 0);
    assert.deepStrictEqual(h.topmostCalls, []);
  }],
  ['repair native flag loss even when Electron still reports topmost without recursive recovery', () => {
    const h = createHarness();
    h.recovery(snapshot(false, []));
    assert.deepStrictEqual(h.topmostCalls, [false, true]);
    assert.strictEqual(h.window.topmost, true);
    assert.strictEqual(h.raises(), 0);
    assert(!h.logs.some((line) => line.includes('alwaysOnTop lost in PIP mode, restoring')));
  }],
  ['respect normal mode and focused, minimized, hidden or destroyed windows', () => {
    for (const [property, value] of [['focused', true], ['minimized', true], ['visible', false], ['destroyed', true]]) {
      const h = createHarness();
      h.window[property] = value;
      h.recovery(snapshot(false));
      assert.deepStrictEqual(h.topmostCalls, []);
      assert.strictEqual(h.raises(), 0);
    }
    const h = createHarness();
    h.ipc.get('toggle-pip')();
    h.topmostCalls.length = 0;
    h.recovery(snapshot(false));
    assert.deepStrictEqual(h.topmostCalls, []);
    assert.strictEqual(h.raises(), 0);
  }],
  ['ignore missing, failed, cloaked or foreign native window samples', () => {
    const h = createHarness();
    for (const state of [null, { own: null }, ...[
      { pid: 30 }, { topmost: null }, { visible: false }, { minimized: true }, { cloaked: 2 }, { cloaked: null }
    ].map((changes) => ({ ...snapshot(false), own: { ...snapshot(false).own, ...changes } }))]) {
      h.recovery(state);
    }
    assert.deepStrictEqual(h.topmostCalls, []);
    assert.strictEqual(h.raises(), 0);
  }],
  ['coalesce event and polling responses to at most one recovery per second', () => {
    const h = createHarness();
    h.recovery(snapshot());
    h.recovery(snapshot());
    h.advance(999);
    h.recovery(snapshot());
    assert.strictEqual(h.raises(), 1);
    h.advance(1);
    h.recovery(snapshot());
    assert.strictEqual(h.raises(), 2);
  }],
  ['ordinary always-on-top change events still recover immediately', () => {
    const h = createHarness();
    h.window.setAlwaysOnTop(false);
    assert.deepStrictEqual(h.topmostCalls, [false, true]);
    assert.strictEqual(h.window.topmost, true);
  }],
  ['a failed flag repair releases its guard so later change events still recover', () => {
    const h = createHarness();
    const setAlwaysOnTop = h.window.setAlwaysOnTop.bind(h.window);
    let failOnce = true;
    h.window.setAlwaysOnTop = (value) => {
      if (failOnce) { failOnce = false; throw new Error('native call failed'); }
      setAlwaysOnTop(value);
    };
    h.recovery(snapshot(false));
    assert(h.logs.some((line) => line.includes('ERROR pip topmost recovery failed')));
    h.window.setAlwaysOnTop(false);
    assert.deepStrictEqual(h.topmostCalls, [false, true]);
    assert.strictEqual(h.window.topmost, true);
  }]
];

for (const [name, test] of tests) {
  test();
  console.log(`PASS ${name}`);
}
