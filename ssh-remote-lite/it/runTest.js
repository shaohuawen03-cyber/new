// Launches a real VS Code (downloaded by @vscode/test-electron) with this
// extension in development mode and runs it/suite.js inside it.
const path = require('path');
const { runTests } = require('@vscode/test-electron');

(async () => {
  try {
    // Pin to the VS Code the user actually runs. Without this, test-electron
    // downloads "latest" (1.139) into .vscode-test - a ~400 MB copy that is
    // not the IDE under test and only confuses things.
    const version = process.env.SRL_VSCODE_VERSION || '1.85.2';
    console.log(`[IT] VS Code version under test: ${version}`);
    await runTests({
      version,
      extensionDevelopmentPath: path.join(__dirname, '..'),
      extensionTestsPath: path.resolve(__dirname, 'suite.js'),
      launchArgs: ['--disable-telemetry', '--skip-welcome', '--skip-release-notes'],
    });
    console.log('[IT] integration tests passed');
  } catch (err) {
    console.error('[IT] integration tests failed:', err);
    process.exit(1);
  }
})();
