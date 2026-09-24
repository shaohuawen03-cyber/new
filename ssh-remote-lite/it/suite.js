// Runs INSIDE a real VS Code instance.
//
// @vscode/test-electron loads THIS file as the "extension tests" module and
// calls its exported run(). There is no mocha in that context unless the file
// creates one itself - the bdd globals (describe/it) are NOT defined, which is
// how round 1 failed ("ReferenceError: describe is not defined"). So the suite
// is plain async code: it throws on failure, resolves on success.
//
// Proves: the extension activates + an SSH terminal really opens against the
// in-repo SSH test server (system ssh client + a temporary ed25519 key) and is
// still alive a few seconds later.
//
// Round 2 failed with `SSH terminal exited early: {"code":255,"reason":2}` -
// exit 255 is the ssh CLIENT giving up, and a VS Code terminal swallows its
// stderr. So before the terminal case we run the SAME ssh command line
// head-less with -v and print it: whatever the client complains about is then
// in the round log instead of being invisible.
const assert = require('assert');
const cp = require('child_process');
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

// Windows OpenSSH REFUSES a private key whose ACL lets anyone else read it
// ("UNPROTECTED PRIVATE KEY FILE" -> exit 255). Node's mode 0o600 does not
// touch Windows ACLs, so do it with icacls. Also keep the key on an ASCII
// path inside the repo: %TEMP% sits under a CJK user name on this machine.
function writePrivateKey(dir, contents) {
  {
    const me = process.env.USERNAME || process.env.USER || '';
    fs.mkdirSync(dir, { recursive: true });
    // Keys from earlier runs are ACL'd read-only, so overwriting one fails
    // with "EPERM: operation not permitted" (round 4). Give them back write
    // access, delete them, and use a fresh unique name anyway.
    try {
      for (const f of fs.readdirSync(dir)) {
        const old = path.join(dir, f);
        if (process.platform === 'win32' && me) {
          try {
            cp.execFileSync('icacls', [old, '/grant', `${me}:F`], { stdio: 'pipe' });
          } catch (e) {
            /* ignore */
          }
        }
        try {
          fs.rmSync(old, { force: true });
        } catch (e) {
          /* ignore */
        }
      }
    } catch (e) {
      /* ignore */
    }
    const file = path.join(dir, `it_key_${process.pid}_${Date.now()}`);
    fs.writeFileSync(file, contents, { mode: 0o600 });
    if (process.platform === 'win32') {
      // by SID: a Chinese user name can fail to match through icacls' code
      // page and leave the file with no ACE at all ("Load key: invalid
      // format", round 11). OWNER RIGHTS (*S-1-3-4) is not accepted by ssh
      // either ("bad permissions", round 12) - it wants the real owner.
      let principal = me;
      try {
        const who = cp
          .execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { stdio: ['ignore', 'pipe', 'pipe'] })
          .toString();
        const m = /S-1-[0-9-]+/.exec(who);
        if (m) {
          principal = `*${m[0]}`;
        }
      } catch (e) {
        /* keep the name */
      }
      try {
        cp.execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${principal}:F`], {
          stdio: 'pipe',
        });
        log(`key ACL locked down for ${principal}`);
      } catch (e) {
        log(`icacls failed (continuing): ${e.message}`);
      }
      let readable = false;
      try {
        readable = fs.readFileSync(file, 'utf8').includes('PRIVATE KEY');
      } catch (e) {
        readable = false;
      }
      if (!readable) {
        log('key became unreadable after icacls - resetting its ACL');
        try {
          cp.execFileSync('icacls', [file, '/reset'], { stdio: 'pipe' });
        } catch (e) {
          /* ignore */
        }
      }
    }
    return file;
  }
}

// NB: this MUST be async. The test SSH server runs inside THIS process (the
// extension host), so a blocking spawnSync deadlocks it: ssh connects, sends
// its version string and then waits forever because the event loop is frozen
// (round 3: "spawnSync ... ETIMEDOUT" right after "Local version string").
function runSshProbe(opts, extraArgs) {
  const args = [...opts.shellArgs, ...extraArgs];
  log(`probe: "${opts.shellPath}" ${args.join(' ')}`);
  return new Promise((resolve) => {
    const child = cp.spawn(opts.shellPath, args, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    const killer = setTimeout(() => {
      try {
        child.kill();
      } catch (e) {
        /* ignore */
      }
    }, 30000);
    child.on('error', (e) => {
      clearTimeout(killer);
      log(`probe spawn error: ${e.message}`);
      resolve({ status: null, out, err });
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      out.trim().split(/\r?\n/).filter(Boolean).forEach((l) => log(`probe out| ${l}`));
      err
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-40)
        .forEach((l) => log(`probe err| ${l}`));
      log(`probe exit: ${code}`);
      resolve({ status: code, out, err });
    });
  });
}

async function run() {
  const harness = require('../out/test/harness.js');
  const terminal = require('../out/terminal.js');
  const { utils } = require('ssh2');

  const kp = utils.generateKeyPairSync('ed25519');
  const server = await harness.startTestServer('testuser', 'testpass', kp.public);
  const keyFile = writePrivateKey(path.join(__dirname, '..', '.vscode-test', 'it'), kp.private);
  log(`test ssh server on 127.0.0.1:${server.port}, key ${keyFile}`);

  const cfg = {
    host: '127.0.0.1',
    port: server.port,
    username: 'testuser',
    privateKeyPath: keyFile,
  };

  let term;
  try {
    await withCase('extension is installed and activates', async () => {
      const ext = vscode.extensions.getExtension(EXT_ID);
      assert.ok(ext, `extension ${EXT_ID} not found in this VS Code`);
      await ext.activate();
      assert.ok(ext.isActive, 'extension did not activate');
    });

    await withCase('system ssh can authenticate with the extension command line', async () => {
      const opts = terminal.sshTerminalOptions(cfg);
      const probe = await runSshProbe(opts, [
        '-v',
        '-o',
        'BatchMode=yes',
        '-o',
        'IdentitiesOnly=yes',
        'echo IT_SSH_OK',
      ]);
      assert.strictEqual(
        probe.status,
        0,
        `ssh exited ${probe.status} - see the "probe err|" lines above for the reason`
      );
      assert.ok(
        /EXEC:/.test(probe.out),
        `the test server did not answer the exec request: ${probe.out}`
      );
    });

    await withCase('opens an SSH terminal that stays alive', async () => {
      term = await vscode.commands.executeCommand('sshRemoteLite._openTestTerminal', cfg);
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

    await withCase('the SSH terminal profile is contributed and becomes the default', async () => {
      const conf = vscode.workspace.getConfiguration('sshRemoteLite');
      await conf.update(
        'defaultHost',
        `testuser@127.0.0.1:${server.port}`,
        vscode.ConfigurationTarget.Global
      );
      const opts = await vscode.commands.executeCommand('sshRemoteLite._profileOptions');
      assert.ok(opts, 'the profile provider has no host to use');
      assert.ok(
        opts.shellArgs.join(' ').includes(String(server.port)),
        `profile args do not target the test server: ${JSON.stringify(opts.shellArgs)}`
      );
      await vscode.commands.executeCommand('sshRemoteLite.setDefaultTerminal');
      const key =
        process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
      const expected = await vscode.commands.executeCommand('sshRemoteLite._staticProfileName');
      const termConf = vscode.workspace.getConfiguration('terminal.integrated');
      const def = termConf.get(`defaultProfile.${key}`);
      assert.strictEqual(
        def,
        expected,
        `default terminal profile is "${def}" - new terminals would still be the local shell`
      );
      // the profile must be a PLAIN path+args entry: it has to work even when
      // the extension is not activated (that is the
      // "No terminal profile provider registered for id ..." failure)
      const written = (termConf.get(`profiles.${key}`) || {})[expected];
      assert.ok(written, `profiles.${key} has no entry named "${expected}"`);
      assert.ok(written.path, 'the profile entry has no path (ssh executable)');
      assert.ok(
        written.args.join(' ').includes(String(server.port)),
        `profile args do not target the test server: ${JSON.stringify(written.args)}`
      );

      // and it really opens: build a terminal straight from the settings entry
      const fromSettings = vscode.window.createTerminal({
        name: expected,
        shellPath: written.path,
        shellArgs: written.args,
      });
      try {
        await new Promise((r) => setTimeout(r, 5000));
        assert.strictEqual(
          fromSettings.exitStatus,
          undefined,
          `the settings-based profile exited early: ${JSON.stringify(fromSettings.exitStatus)}`
        );
      } finally {
        fromSettings.dispose();
      }
    });

    await withCase('a password-only host is turned passwordless and its terminal stays alive', async () => {
      // second server: it knows NOTHING about our key, only the password
      const pwServer = await harness.startTestServer('testuser', 'testpass');
      const sshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srl-it-'));
      let pwTerm;
      try {
        const res = await vscode.commands.executeCommand(
          'sshRemoteLite._autoLogin',
          { host: '127.0.0.1', port: pwServer.port, username: 'testuser', password: 'testpass' },
          sshDir
        );
        assert.ok(res && res.deployed, `key deployment failed: ${res && res.error}`);
        assert.ok(res.cfg.privateKeyPath, 'no private key path came back');
        pwTerm = await vscode.commands.executeCommand('sshRemoteLite._openTestTerminal', res.cfg);
        await new Promise((r) => setTimeout(r, 5000));
        assert.strictEqual(
          pwTerm.exitStatus,
          undefined,
          `passwordless terminal exited early: ${JSON.stringify(pwTerm.exitStatus)}`
        );
      } finally {
        try {
          if (pwTerm) {
            pwTerm.dispose();
          }
        } catch (e) {
          /* ignore */
        }
        await pwServer.close();
        try {
          fs.rmSync(sshDir, { recursive: true, force: true });
        } catch (e) {
          /* ignore */
        }
      }
    });

    await withCase('the ssh:// file system provider is registered and works', async () => {
      // 用户实测报错: "ssh://... 的文件系统提供程序不可用" —— 只有把
      // **安装后的** 插件跑起来才能复现(开发模式下总是好的), 所以这条用例
      // 在 npm run it:installed 里价值最大。
      const conf = vscode.workspace.getConfiguration('sshRemoteLite');
      await conf.update(
        'hosts',
        [{ host: '127.0.0.1', port: server.port, username: 'testuser', password: 'testpass' }],
        vscode.ConfigurationTarget.Global
      );
      const base = `ssh://testuser@127.0.0.1:${server.port}`;
      const file = vscode.Uri.parse(`${base}/it_probe.txt`);
      await vscode.workspace.fs.writeFile(file, Buffer.from('hello-it'));
      const back = await vscode.workspace.fs.readFile(file);
      assert.strictEqual(Buffer.from(back).toString(), 'hello-it');
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.parse(`${base}/`));
      assert.ok(
        entries.some(([n]) => n === 'it_probe.txt'),
        `the remote directory listing has no it_probe.txt: ${JSON.stringify(entries)}`
      );
      await vscode.workspace.fs.delete(file);
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
