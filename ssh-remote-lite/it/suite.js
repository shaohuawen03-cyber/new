// Runs INSIDE a real VS Code instance.
//
// @vscode/test-electron loads THIS file as the "extension tests" module and
// calls its exported run(). There is no mocha in that context unless the file
// creates one itself - the bdd globals (describe/it) are NOT defined, which is
// exactly how round 1 failed on the local box:
//     ReferenceError: describe is not defined   (it/suite.js:13)
// So the suite is plain async code: it throws on failure, resolves on success.
//
// Proves: the extension activates + an SSH terminal really opens against the
// in-repo SSH test server (system ssh client + a temporary ed25519 key) and
// is still alive a few seconds later.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const pkg = require('../package.json');
const EXT_ID = `${pkg.publisher}.${pkg.name}`;

function log(msg) {
  console.log(`[IT] ${msg}`);
}

async function withCase(name, fn) {
  const started = Date.now();
  try {
    await fn();
    log(`ok   - ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    log(`FAIL - ${name} (${Date.now() - started}ms)`);
    throw err;
  }
}

async function run() {
  const harness = require('../out/test/harness.js');
  const { utils } = require('ssh2');

  const kp = utils.generateKeyPairSync('ed25519');
  const server = await harness.startTestServer('testuser', 'testpass', kp.public);
  const keyFile = path.join(os.tmpdir(), 'ssh_remote_lite_test_key');
  fs.writeFileSync(keyFile, kp.private, { mode: 0o600 });
  log(`test ssh server on 127.0.0.1:${server.port}, key ${keyFile}`);

  let term;
  try {
    await withCase('extension is installed and activates', async () => {
      const ext = vscode.extensions.getExtension(EXT_ID);
      assert.ok(ext, `extension ${EXT_ID} not found in this VS Code`);
      await ext.activate();
      assert.ok(ext.isActive, 'extension did not activate');
    });

    await withCase('opens an SSH terminal that stays alive', async () => {
      term = await vscode.commands.executeCommand('sshRemoteLite._openTestTerminal', {
        host: '127.0.0.1',
        port: server.port,
        username: 'testuser',
        privateKeyPath: keyFile,
      });
      assert.ok(term, 'command returned no terminal');
      assert.ok(String(term.name).startsWith('SSH:'), `unexpected terminal name: ${term.name}`);
      assert.ok(
        vscode.window.terminals.some((t) => t === term),
        'terminal not present in window.terminals'
      );
      // give the system ssh client a moment to handshake with the test server
      await new Promise((r) => setTimeout(r, 5000));
      assert.strictEqual(
        term.exitStatus,
        undefined,
        `SSH terminal exited early: ${JSON.stringify(term.exitStatus)}`
      );
    });

    log('all integration cases passed');
  } finally {
    try {
      if (term) {
        term.dispose();
      }
    } catch (e) {
      /* ignore */
    }
    try {
      await server.close();
    } catch (e) {
      /* ignore */
    }
  }
}

module.exports = { run };
