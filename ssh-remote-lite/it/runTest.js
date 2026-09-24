// Launches a real VS Code (downloaded by @vscode/test-electron) with this
// extension in development mode and runs it/suite.js inside it.
const path = require('path');
const { runTests } = require('@vscode/test-electron');

(async () => {
  try {
    await runTests({
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
