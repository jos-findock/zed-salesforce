'use strict';

// Minimal LSP server that wraps `sf code-analyzer run` and publishes diagnostics.
//
// Lifecycle:
//   initialize  → respond with capabilities
//   initialized → run initial analysis (debounced)
//   textDocument/didSave → re-run analysis
//   shutdown / exit → clean up
//
// argv[2]: absolute path to the `sf` binary (passed by the Zed extension so we
//          don't depend on PATH being set correctly in the editor process).

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const sfBin = process.argv[2] || 'sf';

function log(msg) {
  process.stderr.write(`[code-analyzer-lsp] ${msg}\n`);
}

log(`starting up (sf=${sfBin})`);

// --- LSP framing (stdio transport) ---

let inputBuffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  drainBuffer();
});

function drainBuffer() {
  while (true) {
    const sep = findHeaderEnd(inputBuffer);
    if (sep === -1) break;

    const header = inputBuffer.slice(0, sep).toString('utf8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      inputBuffer = inputBuffer.slice(sep + 4);
      continue;
    }

    const length = parseInt(match[1], 10);
    const bodyStart = sep + 4;
    if (inputBuffer.length < bodyStart + length) break;

    const body = inputBuffer.slice(bodyStart, bodyStart + length).toString('utf8');
    inputBuffer = inputBuffer.slice(bodyStart + length);

    try { dispatch(JSON.parse(body)); } catch (_) {}
  }
}

function findHeaderEnd(buf) {
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i;
  }
  return -1;
}

function send(msg) {
  const body = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

function respond(id, result) { send({ jsonrpc: '2.0', id, result }); }
function notify(method, params) { send({ jsonrpc: '2.0', method, params }); }

// --- State ---

let workspaceRoot = null;
let analyzing = false;

// --- Severity mapping: Code Analyzer 1–5 → LSP 1–4 ---
// 1 Critical, 2 High → Error (1)
// 3 Moderate         → Warning (2)
// 4 Low              → Information (3)
// 5 Info             → Hint (4)
function mapSeverity(s) {
  if (s <= 2) return 1;
  if (s === 3) return 2;
  if (s === 4) return 3;
  return 4;
}

// --- Analysis ---

function runAnalysis(targetFile) {
  log('starting analysis' + (targetFile ? ` for ${targetFile}` : ''));
  if (analyzing || !workspaceRoot) return;
  analyzing = true;

  const tmpFile = path.join(os.tmpdir(), `sca-${process.pid}-${Date.now()}.json`);

  const args = ['code-analyzer', 'run', '--workspace', '.', '--output-file', tmpFile];
  if (targetFile) args.push('--target', targetFile);

  log(`running: ${sfBin} ${args.join(' ')}`);

  execFile(
    sfBin,
    args,
    { cwd: workspaceRoot, timeout: 600000 },
    (err, _stdout, stderr) => {
      analyzing = false;

      if (stderr) log(`stderr: ${stderr.trim()}`);

      if (err && err.killed) {
        log('analysis timed out after 10 minutes');
        return;
      }

      // sf exits non-zero when violations exist — that's expected.
      // Only bail if the output file wasn't written at all.
      if (!fs.existsSync(tmpFile)) {
        log('no output file produced; analysis may have failed');
        if (err) log(`error: ${err.message}`);
        return;
      }

      let raw;
      try {
        raw = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
        log(`parsed output successfully`);
      } catch (parseErr) {
        log(`failed to parse output: ${parseErr}`);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
      }

      if (raw != null) publishDiagnostics(raw);
    }
  );
}

function publishDiagnostics(raw) {
  // The top-level may be an array of violations or an object wrapping them.
  let violations = Array.isArray(raw) ? raw : (raw.violations || raw.results || []);
  if (!Array.isArray(violations)) violations = [];

  const byUri = {};

  for (const v of violations) {
    const locIndex = v.primaryLocationIndex ?? 0;
    const loc = Array.isArray(v.locations) ? v.locations[locIndex] : null;
    if (!loc || !loc.file) continue;

    const absPath = path.resolve(workspaceRoot, loc.file);
    const uri = 'file://' + absPath;

    if (!byUri[uri]) byUri[uri] = [];

    // LSP lines/columns are 0-based; Code Analyzer reports 1-based.
    const startLine = Math.max(0, (loc.startLine || 1) - 1);
    const startChar = Math.max(0, (loc.startColumn || 1) - 1);
    const endLine = Math.max(0, (loc.endLine || loc.startLine || 1) - 1);
    const endChar = Math.max(0, (loc.endColumn || loc.startColumn || 1) - 1);

    const diag = {
      range: {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
      },
      severity: mapSeverity(v.severity),
      source: 'code-analyzer',
      message: v.message || v.rule || 'violation',
      code: v.rule,
    };

    if (Array.isArray(v.resources) && v.resources[0]) {
      diag.codeDescription = { href: v.resources[0] };
    }

    byUri[uri].push(diag);
  }

  const fileCount = Object.keys(byUri).length;
  log(`publishing diagnostics for ${violations.length} violations across ${fileCount} files`);

  for (const [uri, diagnostics] of Object.entries(byUri)) {
    notify('textDocument/publishDiagnostics', { uri, diagnostics });
  }
}

// --- LSP dispatcher ---

function dispatch(msg) {
  log(`received message: ${msg.method}`);
  switch (msg.method) {
    case 'initialize': {
      const params = msg.params || {};
      if (params.rootUri) {
        workspaceRoot = params.rootUri.replace(/^file:\/\//, '');
      } else if (params.rootPath) {
        workspaceRoot = params.rootPath;
      }

      respond(msg.id, {
        capabilities: {
          textDocumentSync: {
            openClose: false,
            save: { includeText: false },
          },
        },
        serverInfo: { name: 'code-analyzer-lsp', version: '1.0.0' },
      });
      break;
    }

    case 'initialized':
      runAnalysis();
      break;

    case 'textDocument/didSave': {
      const uri = msg.params?.textDocument?.uri;
      const targetFile = uri ? uri.replace(/^file:\/\//, '') : null;
      runAnalysis(targetFile);
      break;
    }

    case 'workspace/didChangeWatchedFiles':
      runAnalysis();
      break;

    case 'shutdown':
      respond(msg.id, null);
      break;

    case 'exit':
      process.exit(0);
      break;

    default:
      // Respond to requests we don't handle to keep the client unblocked.
      if (msg.id != null) respond(msg.id, null);
      break;
  }
}
