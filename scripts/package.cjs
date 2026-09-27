const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

(async () => {
  const { packager } = await import('@electron/packager');
  const root = path.resolve(__dirname, '..');
  const version = require('../package.json').version;
  const outputRoot = path.join(root, 'dist', version);
  const outputs = await packager({
    dir: root, out: outputRoot, name: 'Little Bot',
    platform: 'win32', arch: 'x64', electronVersion: '44.4.5',
    overwrite: true, prune: true, asar: false,
    ignore: [/^\/dist($|\/)/, /^\/test($|\/)/, /^\/scripts($|\/)/, /^\/\.test-data($|\/)/,
      /^\/node_modules\/agent-browser\/bin\/agent-browser-(?:darwin|linux)/],
    win32metadata: { CompanyName: 'Personal project', FileDescription: 'Little Bot — local assistant', ProductName: 'Little Bot' },
  });

  const packagedDir = outputs[0];
  const launcher = path.join(root, 'Launch Little Bot.cmd');
  fs.writeFileSync(launcher, `@echo off\r\nstart "" "%~dp0dist\\${version}\\Little Bot-win32-x64\\Little Bot.exe"\r\n`);

  console.log(`Packaged folder: ${packagedDir}`);

  if (process.platform !== 'win32') {
    console.log('Portable ZIP and Setup EXE are created only when packaging on Windows.');
    return;
  }

  const portableZip = path.join(outputRoot, `Little-Bot-${version}-portable.zip`);
  const installerFile = path.join(outputRoot, `Little-Bot-${version}-Setup.exe`);
  const buildArgs = [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'build-installer.ps1'),
    '-SourceDir', packagedDir,
    '-PortableZip', portableZip,
    '-InstallerFile', installerFile,
    '-Version', version,
  ];
  if (process.argv.includes('--portable-only')) buildArgs.push('-PortableOnly');

  execFileSync('powershell.exe', buildArgs, { stdio: 'inherit' });
})().catch(error => { console.error(error); process.exitCode = 1; });
