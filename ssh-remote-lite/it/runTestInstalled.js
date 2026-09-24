// Runs the SAME suite against the INSTALLED vsix instead of the source tree.
//
// Why: every round was green while the user saw
//   "ssh://... 的文件系统提供程序不可用"  (no file system provider for ssh://)
// Development mode (extensionDevelopmentPath) always has the full source and
// node_modules next to it, so it can never catch a packaging/activation
// problem in the .vsix. This runner installs the packaged extension into a
// throw-away extensions dir and runs the tests against that.
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  runTests,
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
} = require('@vscode/test-electron');

(async () => {
  try {
    const root = path.join(__dirname, '..');
    const vsix = fs
      .readdirSync(root)
      .filter((f) => f.endsWith('.vsix'))
      .sort()
      .pop();
    if (!vsix) {
      throw new Error('no .vsix in the extension folder - run: npx @vscode/vsce package');
    }
    const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srl-exts-'));
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srl-user-'));
    // Pin to the VS Code the user actually runs (1.85.2 - the last build that
    // works with their old server's glibc). The default "latest" hid the
    // problem: 1.139 activates the extension fine while 1.85.2 is what showed
    // "file system provider for ssh:// is not available".
    const version = process.env.SRL_VSCODE_VERSION || '1.85.2';
    console.log(`[IT-installed] VS Code version under test: ${version}`);
    const exe = await downloadAndUnzipVSCode(version);
    const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(exe);
    console.log(`[IT-installed] installing ${vsix} into ${extDir}`);
    const installArgs = [
      ...cliArgs,
      '--extensions-dir',
      extDir,
      '--user-data-dir',
      userDir,
      '--install-extension',
      path.join(root, vsix),
      '--force',
    ];
    // Windows: the CLI is a .cmd/.bat and node >= 20 refuses to spawn those
    // without a shell (round 18 failed with status!=0 and no output at all)
    const install = cp.spawnSync(cli, installArgs, {
      encoding: 'utf8',
      stdio: 'pipe',
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    if (install.stdout) {
      console.log(install.stdout.trim());
    }
    if (install.status !== 0) {
      throw new Error(
        `installing the vsix failed (status=${install.status}, error=${
          install.error ? install.error.message : 'none'
        }): ${install.stderr || install.stdout || '<no output>'}`
      );
    }
    await runTests({
      vscodeExecutablePath: exe,
      // NO extensionDevelopmentPath on purpose: this must exercise the
      // installed copy, exactly like the user's IDE does.
      extensionTestsPath: path.resolve(__dirname, 'suite.js'),
      launchArgs: [
        '--extensions-dir',
        extDir,
        '--user-data-dir',
        userDir,
        '--disable-telemetry',
        '--skip-welcome',
        '--skip-release-notes',
      ],
    });
    console.log('[IT-installed] integration tests passed against the packaged extension');
  } catch (err) {
    console.error('[IT-installed] FAILED:', err);
    process.exit(1);
  }
})();
