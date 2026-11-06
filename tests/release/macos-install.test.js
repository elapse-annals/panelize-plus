import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const isMacOS = process.platform === 'darwin';
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const appName = 'Panelize Link';
const hostName = 'com.panelize.global_sender';
const sourceRoot = path.resolve(import.meta.dirname, '../..');

function makeExecutable(filePath, contents) {
  fs.writeFileSync(filePath, contents);
  fs.chmodSync(filePath, 0o755);
}

function makeFixture(context, { fixtureHomeName = 'user-home', withApp = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelize-macos-install-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const downloadDir = path.join(root, 'release');
  const fixtureHome = path.join(root, fixtureHomeName);
  const mockBin = path.join(root, 'mock-bin');
  fs.mkdirSync(downloadDir);
  fs.mkdirSync(mockBin);

  const installer = path.join(downloadDir, 'install.sh');
  const originalInstaller = fs.readFileSync(
    path.join(sourceRoot, 'desktop/macos/Scripts/install.sh'),
    'utf8'
  );
  // Redirect only this disposable fixture copy; the test never reads or writes the real user home.
  const escapedFixtureHome = fixtureHome
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('$', '\\$')
    .replaceAll('`', '\\`');
  fs.writeFileSync(installer, originalInstaller.replaceAll('$HOME', escapedFixtureHome));
  fs.chmodSync(installer, 0o755);

  makeExecutable(path.join(mockBin, 'codesign'), '#!/bin/sh\nexit 0\n');
  makeExecutable(path.join(mockBin, 'node'), '#!/bin/sh\necho "node was invoked" >&2\nexit 99\n');
  makeExecutable(path.join(mockBin, 'swift'), '#!/bin/sh\necho "swift was invoked" >&2\nexit 99\n');

  let appPath = '';
  if (withApp) {
    appPath = path.join(downloadDir, `${appName}.app`);
    const binariesDir = path.join(appPath, 'Contents', 'MacOS');
    fs.mkdirSync(binariesDir, { recursive: true });
    makeExecutable(path.join(binariesDir, 'PanelizeSearchApp'), '#!/bin/sh\nexit 0\n');
    makeExecutable(path.join(binariesDir, 'PanelizeSearchBridge'), '#!/bin/sh\nexit 0\n');
  }

  return { appPath, downloadDir, fixtureHome, installer, mockBin, root };
}

function nativeHostPath(fixtureHome, browser) {
  const browserDirectory = browser === 'chrome' ? 'Google/Chrome' : 'Microsoft Edge';
  return path.join(
    fixtureHome,
    'Library',
    'Application Support',
    browserDirectory,
    'NativeMessagingHosts',
    `${hostName}.json`
  );
}

function extensionIdForCheckout(repoRoot) {
  return createHash('sha256')
    .update(repoRoot)
    .digest('hex')
    .slice(0, 32)
    .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + Number.parseInt(digit, 16)));
}

function runInstaller(fixture, args) {
  return spawnSync('/bin/bash', [fixture.installer, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixture.mockBin}:${process.env.PATH}`
    }
  });
}

test('release installer registers Chrome and Edge using only the bundled app and extension ID', {
  skip: !isMacOS
}, t => {
  for (const browser of ['chrome', 'edge']) {
    const fixture = makeFixture(t);
    const result = runInstaller(fixture, ['--browser', browser, '--extension-id', extensionId]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Enable global input bridge/);
    assert.equal(fs.existsSync(path.join(fixture.fixtureHome, 'Applications', `${appName}.app`)), true);

    const registeredHost = JSON.parse(fs.readFileSync(nativeHostPath(fixture.fixtureHome, browser), 'utf8'));
    assert.equal(registeredHost.name, hostName);
    assert.equal(registeredHost.type, 'stdio');
    assert.equal(
      registeredHost.path,
      path.join(fixture.fixtureHome, 'Applications', `${appName}.app`, 'Contents', 'MacOS', 'PanelizeSearchBridge')
    );
    assert.deepEqual(registeredHost.allowed_origins, [`chrome-extension://${extensionId}/`]);
  }
});

test('download installer rejects missing or invalid extension IDs before installing anything', {
  skip: !isMacOS
}, t => {
  for (const args of [
    ['--browser', 'chrome'],
    ['--browser', 'chrome', '--extension-id', 'not-an-extension-id']
  ]) {
    const fixture = makeFixture(t);
    const result = runInstaller(fixture, args);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /extension-id|Invalid extension ID/);
    assert.equal(fs.existsSync(path.join(fixture.fixtureHome, 'Applications')), false);
    assert.equal(fs.existsSync(path.dirname(nativeHostPath(fixture.fixtureHome, 'chrome'))), false);
  }
});

test('source installer builds locally and derives the ID from the checkout path by default', {
  skip: !isMacOS
}, t => {
  const fixture = makeFixture(t, { withApp: false });
  const repoRoot = path.join(fixture.root, 'source checkout');
  const scriptsDir = path.join(repoRoot, 'desktop', 'macos', 'Scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'manifest.json'), '{}\n');
  const checkedOutInstaller = path.join(scriptsDir, 'install.sh');
  const originalInstaller = fs.readFileSync(path.join(sourceRoot, 'desktop/macos/Scripts/install.sh'), 'utf8');
  const escapedFixtureHome = fixture.fixtureHome
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('$', '\\$')
    .replaceAll('`', '\\`');
  fs.writeFileSync(checkedOutInstaller, originalInstaller.replaceAll('$HOME', escapedFixtureHome));
  fs.chmodSync(checkedOutInstaller, 0o755);

  const buildScript = path.join(scriptsDir, 'build-app.sh');
  makeExecutable(buildScript, [
    '#!/bin/bash',
    'set -euo pipefail',
    'repo_root="$(cd "$(dirname "$0")/../../.." && pwd -P)"',
    'binaries="$repo_root/dist/Panelize Link.app/Contents/MacOS"',
    'mkdir -p "$binaries"',
    'printf "#!/bin/sh\\nexit 0\\n" > "$binaries/PanelizeSearchApp"',
    'printf "#!/bin/sh\\nexit 0\\n" > "$binaries/PanelizeSearchBridge"',
    'chmod +x "$binaries/PanelizeSearchApp" "$binaries/PanelizeSearchBridge"',
    ''
  ].join('\n'));

  const physicalRepoRoot = fs.realpathSync(repoRoot);
  const result = spawnSync('/bin/bash', [checkedOutInstaller, '--browser', 'chrome'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixture.mockBin}:${process.env.PATH}`
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const expectedId = extensionIdForCheckout(physicalRepoRoot);
  const manifest = JSON.parse(fs.readFileSync(nativeHostPath(fixture.fixtureHome, 'chrome'), 'utf8'));
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${expectedId}/`]);
  assert.equal(
    fs.existsSync(path.join(fixture.fixtureHome, 'Applications', `${appName}.app`, 'Contents', 'MacOS', 'PanelizeSearchBridge')),
    true
  );
});

test('reinstall keeps the previous app and native-host manifest as backups', {
  skip: !isMacOS
}, t => {
  const fixture = makeFixture(t);
  const installedApp = path.join(fixture.fixtureHome, 'Applications', `${appName}.app`);
  const manifestPath = nativeHostPath(fixture.fixtureHome, 'chrome');

  let result = runInstaller(fixture, ['--browser', 'chrome', '--extension-id', extensionId]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(path.join(installedApp, 'user-data.txt'), 'keep me');
  const originalManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  originalManifest.allowed_origins = ['chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/'];
  fs.writeFileSync(manifestPath, JSON.stringify(originalManifest));

  result = runInstaller(fixture, ['--browser', 'chrome', '--extension-id', 'ponmlkjihgfedcbaponmlkjihgfedcba']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const appBackup = fs.readdirSync(path.dirname(installedApp))
    .find(entry => entry.startsWith(`${appName}.app.backup-`));
  const manifestBackup = fs.readdirSync(path.dirname(manifestPath))
    .find(entry => entry.startsWith(`${hostName}.json.backup-`));
  assert.ok(appBackup, 'previous app should be retained');
  assert.ok(manifestBackup, 'previous host manifest should be retained');
  assert.equal(fs.readFileSync(path.join(path.dirname(installedApp), appBackup, 'user-data.txt'), 'utf8'), 'keep me');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(path.dirname(manifestPath), manifestBackup), 'utf8')).allowed_origins,
    ['chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/']
  );
});

test('installing from the already-installed app keeps that app in place', {
  skip: !isMacOS
}, t => {
  const fixture = makeFixture(t);
  const installedApp = path.join(fixture.fixtureHome, 'Applications', `${appName}.app`);
  const appMarker = path.join(installedApp, 'Contents', 'Resources', 'local-data.txt');

  let result = runInstaller(fixture, ['--browser', 'chrome', '--extension-id', extensionId]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  fs.mkdirSync(path.dirname(appMarker), { recursive: true });
  fs.writeFileSync(appMarker, 'keep installed application');

  result = runInstaller(fixture, [
    '--app', installedApp,
    '--browser', 'edge',
    '--extension-id', 'ponmlkjihgfedcbaponmlkjihgfedcba'
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(appMarker, 'utf8'), 'keep installed application');
  assert.equal(fs.readdirSync(path.dirname(installedApp))
    .some(entry => entry.startsWith(`${appName}.app.backup-`)), false);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(nativeHostPath(fixture.fixtureHome, 'edge'), 'utf8')).allowed_origins,
    ['chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/']
  );
});

test('native-host manifest correctly escapes quotes in the installed app path', {
  skip: !isMacOS
}, t => {
  const fixture = makeFixture(t, { fixtureHomeName: 'users "quoted"' });
  const result = runInstaller(fixture, ['--browser', 'chrome', '--extension-id', extensionId]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const manifest = JSON.parse(fs.readFileSync(nativeHostPath(fixture.fixtureHome, 'chrome'), 'utf8'));
  assert.equal(
    manifest.path,
    path.join(fixture.fixtureHome, 'Applications', `${appName}.app`, 'Contents', 'MacOS', 'PanelizeSearchBridge')
  );
});

test('double-click installer accepts a Chrome extension settings URL', {
  skip: !isMacOS
}, t => {
  const fixture = makeFixture(t, { withApp: false });
  const wrapper = path.join(fixture.downloadDir, 'Install.command');
  const receivedArgs = path.join(fixture.root, 'received-args.txt');
  fs.writeFileSync(wrapper, fs.readFileSync(
    path.join(sourceRoot, 'desktop/macos/Scripts/Install.command'),
    'utf8'
  ));
  fs.chmodSync(wrapper, 0o755);

  makeExecutable(fixture.installer, '#!/bin/bash\nprintf "%s\\n" "$@" > "$PANELIZE_TEST_ARGS_FILE"\n');
  const result = spawnSync('/bin/bash', [wrapper], {
    encoding: 'utf8',
    input: `2\nchrome-extension://${extensionId}/options/options.html\n`,
    env: {
      ...process.env,
      PANELIZE_TEST_ARGS_FILE: receivedArgs
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(fs.readFileSync(receivedArgs, 'utf8').trim().split('\n'), [
    '--browser', 'edge', '--extension-id', extensionId
  ]);
});
