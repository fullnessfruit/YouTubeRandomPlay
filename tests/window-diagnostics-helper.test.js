const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

// Exercise the deployed executable and its real JSON stream; no captured desktop data is saved.
if (process.platform !== 'win32') {
  console.log('SKIP Windows is required to run the prebuilt diagnostics helper');
  process.exit(0);
}

const executable = path.join(__dirname, '..', 'WindowDiagnostics.exe');
const result = spawnSync(executable, [], {
  shell: false, windowsHide: true, encoding: 'utf8', timeout: 15000,
  input: '0\ninvalid-handle\n0\n'
});
if (result.error) throw result.error;
assert.strictEqual(result.status, 0, result.stderr);
assert.strictEqual(result.stderr, '');
const replies = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
assert.strictEqual(replies.length, 3);
for (const reply of [replies[0], replies[2]]) {
  assert(!reply.error);
  assert(!Number.isNaN(Date.parse(reply.sampledAt)));
  assert.strictEqual(reply.state.own, null);
  assert.deepStrictEqual(reply.state.overlapCandidatesAbove, []);
  assert.strictEqual(reply.state.overlapCount, 0);
  assert.strictEqual(reply.state.scanTruncated, false);
  assert(Object.prototype.hasOwnProperty.call(reply.state, 'foreground'));
  if (reply.state.foreground) {
    const window = reply.state.foreground;
    assert.strictEqual(typeof window.hwnd, 'string');
    assert.strictEqual(typeof window.pid, 'number');
    assert(window.topmost === null || typeof window.topmost === 'boolean');
    assert.strictEqual(typeof window.visible, 'boolean');
    assert.strictEqual(typeof window.minimized, 'boolean');
    assert(window.cloaked === null || typeof window.cloaked === 'number');
    assert(window.processName === null || typeof window.processName === 'string');
    assert.strictEqual(typeof window.className, 'string');
    if (window.bounds) {
      for (const name of ['left', 'top', 'right', 'bottom']) {
        assert.strictEqual(typeof window.bounds[name], 'number');
      }
    }
  }
}
assert.strictEqual(typeof replies[1].error, 'string');
assert(replies[1].error.length > 0);
console.log('PASS native JSON fields, invalid request recovery and shutdown on stdin EOF');
