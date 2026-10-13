const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SAMPLE_INTERVAL_MS = 1000;
const HEARTBEAT_MS = 60000;
const QUERY_TIMEOUT_MS = 15000;

// Collect window state and deliver native samples to an optional main-process recovery policy.
function startWindowDiagnostics(window, getIsPip, log, onNativeState = null) {
  const windowId = window.id;
  let stopped = false;
  let helper = null;
  let output = null;
  let pending = null;
  let queryTimeout = null;
  let nativeStatus = process.platform === 'win32' ? 'starting' : 'unsupported';
  let stderr = '';
  let lastSignature = null;
  let lastLogAt = 0;
  let handle = null;

  function record(reason, native = null, sampledAt = null, requestedAt = null) {
    if (stopped || window.isDestroyed()) return;
    const electron = {
      isPip: getIsPip(), alwaysOnTop: window.isAlwaysOnTop(),
      focused: window.isFocused(), visible: window.isVisible(),
      minimized: window.isMinimized(), maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(), bounds: window.getBounds()
    };
    const signature = JSON.stringify({ electron, nativeStatus, native });
    const now = Date.now();
    if (reason !== 'poll' || signature !== lastSignature || now - lastLogAt >= HEARTBEAT_MS) {
      log(`window diagnostic - windowId: ${windowId}, reason: ${reason}, electron: ${JSON.stringify(electron)}, nativeStatus: ${nativeStatus}, nativeSampledAt: ${sampledAt}, queryMs: ${requestedAt === null ? null : now - requestedAt}, native: ${JSON.stringify(native)}`);
      lastSignature = signature;
      lastLogAt = now;
    }
  }

  function stopNative() {
    clearTimeout(queryTimeout);
    pending = null;
    if (output) output.close();
    if (helper) {
      const child = helper;
      helper = null;
      child.stdin.end();
      child.kill();
    }
  }

  function failNative(error) {
    if (stopped || nativeStatus === 'unavailable') return;
    nativeStatus = 'unavailable';
    log(`WARN window diagnostic native unavailable - windowId: ${windowId}, error: ${String(error).replace(/[\r\n]+/g, ' ')}, stderr: ${stderr.replace(/[\r\n]+/g, ' ')}`);
    stopNative();
  }

  function sample(reason) {
    if (stopped || window.isDestroyed()) return;
    if (!helper) {
      record(reason);
      return;
    }
    // Keep one query in flight, including while PowerShell compiles the Win32 declarations.
    if (pending) return;
    pending = { reason, requestedAt: Date.now() };
    queryTimeout = setTimeout(() => failNative('query timed out'), QUERY_TIMEOUT_MS);
    helper.stdin.write(handle + '\n', (error) => { if (error) failNative(error.message); });
  }

  const listeners = new Map();
  for (const event of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore', 'maximize',
    'unmaximize', 'moved', 'resized', 'enter-full-screen', 'leave-full-screen', 'always-on-top-changed']) {
    const listener = (_, value) => {
      const reason = event === 'always-on-top-changed' ? `${event}:${value}` : event;
      record(reason);
      sample(reason);
    };
    listeners.set(event, listener);
    window.on(event, listener);
  }

  if (process.platform === 'win32') {
    try {
      const buffer = window.getNativeWindowHandle();
      handle = buffer.length === 8 ? buffer.readBigUInt64LE().toString() : buffer.readUInt32LE().toString();
      const script = fs.readFileSync(path.join(__dirname, 'WindowDiagnostics.ps1'), 'utf8');
      const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      helper = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      helper.on('error', (error) => failNative(error.message));
      helper.on('close', (code, signal) => failNative(`helper exited - code: ${code}, signal: ${signal}`));
      helper.stdin.on('error', (error) => failNative(error.message));
      helper.stderr.setEncoding('utf8');
      helper.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2048); });
      output = readline.createInterface({ input: helper.stdout });
      output.on('line', (line) => {
        if (!pending || stopped) return;
        try {
          const response = JSON.parse(line);
          if (response.error || !response.state) throw new Error(response.error || 'missing native state');
          const request = pending;
          pending = null;
          clearTimeout(queryTimeout);
          nativeStatus = 'available';
          record(request.reason, response.state, response.sampledAt, request.requestedAt);
          // Logging may be deduplicated, but the caller still needs every current sample.
          if (onNativeState) {
            try {
              onNativeState(response.state);
            } catch (error) {
              log(`ERROR window diagnostic native handler failed - windowId: ${windowId}, error: ${String(error).replace(/[\r\n]+/g, ' ')}`);
            }
          }
        } catch (error) {
          failNative(error.message);
        }
      });
    } catch (error) {
      failNative(error.message);
    }
  }

  log(`window diagnostic started - windowId: ${windowId}, hwnd: ${handle}, electronVersion: ${process.versions.electron}, platform: ${process.platform}, arch: ${process.arch}, intervalMs: ${SAMPLE_INTERVAL_MS}`);
  record('start');
  sample('initial');
  const interval = setInterval(() => sample('poll'), SAMPLE_INTERVAL_MS);
  window.once('closed', () => {
    stopped = true;
    clearInterval(interval);
    stopNative();
    for (const [event, listener] of listeners) window.removeListener(event, listener);
    log(`window diagnostic stopped - windowId: ${windowId}`);
  });
}

module.exports = { startWindowDiagnostics };
