'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('package scripts expose unpacked, portable, and installer outputs', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packager = fs.readFileSync(path.join(root, 'scripts', 'package.cjs'), 'utf8');
  const builder = fs.readFileSync(path.join(root, 'scripts', 'build-installer.ps1'), 'utf8');

  assert.equal(pkg.scripts.package, 'node scripts/package.cjs');
  assert.equal(pkg.scripts['package:portable'], 'node scripts/package.cjs --portable-only');
  assert.match(packager, /Little-Bot-\$\{version\}-portable\.zip/);
  assert.match(packager, /Little-Bot-\$\{version\}-Setup\.exe/);
  assert.match(packager, /build-installer\.ps1/);
  assert.match(builder, /Compress-Archive/);
  assert.match(builder, /iexpress\.exe/i);
  assert.match(builder, /PackagePurpose=InstallApp/);
  assert.match(builder, /AppLaunched=%AppLaunched%/);
  assert.match(builder, /^AppLaunched=cmd\.exe \/c install\.cmd$/m);
  assert.match(builder, /^AdminQuietInstCmd=cmd\.exe \/c install\.cmd$/m);
  assert.match(builder, /^UserQuietInstCmd=cmd\.exe \/c install\.cmd$/m);
  assert.match(builder, /& \$iexpress \/N \/Q \/M \$sedPath/);
});

test('installer is per-user and registers a real uninstaller', () => {
  const root = path.join(__dirname, '..');
  const install = fs.readFileSync(path.join(root, 'scripts', 'install.ps1'), 'utf8');
  const uninstall = fs.readFileSync(path.join(root, 'scripts', 'uninstall.ps1'), 'utf8');

  assert.match(install, /LOCALAPPDATA.*Programs\\Little Bot/s);
  assert.match(install, /GetFolderPath\('Programs'\)/);
  assert.match(install, /CurrentVersion\\Uninstall\\Little Bot/);
  assert.match(install, /UninstallString/);
  assert.match(install, /QuietUninstallString/);
  assert.match(install, /NoModify/);
  assert.match(install, /NoRepair/);
  assert.match(uninstall, /\$resolvedInstall = \[IO\.Path\]::GetFullPath\(\$InstallDir\)/);
  assert.match(uninstall, /Remove-Item[^\n]*\$resolvedInstall/);
  assert.match(uninstall, /CurrentVersion\\Uninstall\\Little Bot/);
});
