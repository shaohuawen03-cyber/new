// Runs INSIDE a real VS Code instance (mocha bdd UI, provided by the test runner).
// Proves: extension activates + an SSH terminal really opens and stays alive,
// using the in-repo SSH test server + the system ssh client + a temp key.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const pkg = require('../package.json');
const EXT_ID = `${pkg.publisher}.${pkg.name}`;

describe('ssh-remote-lite integration (real VS Code)', function () {
  this.timeout(180000);

  let server;
  let keyFile;
  let term;

  before(async function () {
    const harness = require('../out/test/harness.js');
    const { utils } = require('ssh2');
    const kp = utils.generateKeyPairSync('ed25519');
    server = await harness.startTestServer('testuser', 'testpass', kp.public);
    keyFile = path.join(os.tmpdir(), 'ssh_remote_lite_test_key');
    fs.writeFileSync(keyFile, kp.private, { mode: 0o600 });
  });

  after(async function () {
    try {
      if (term) {
        term.dispose();
      }
    } catch (e) {
      /* ignore */
    }
    if (server) {
      await server.close();
    }
  });

  it('extension is installed and activates', async function () {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} not found in this VS Code`);
    await ext.activate();
    assert.ok(ext.isActive, 'extension did not activate');
  });

  it('opens an SSH terminal (system ssh -> in-repo test server) and it stays alive', async function () {
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
    // give system ssh a moment to handshake with the test server
    await new Promise((r) => setTimeout(r, 5000));
    assert.strictEqual(
      term.exitStatus,
      undefined,
      `SSH terminal exited early: ${JSON.stringify(term.exitStatus)}`
    );
  });
});
