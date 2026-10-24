const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

(async () => {
  await require('./prepare-embeddings.cjs').prepareEmbeddings();
  const { packager } = await import('@electron/packager');
  const root = path.resolve(__dirname, '..');
  execFileSync(require('electron'), [path.join(__dirname, 'build-icons.cjs')], { stdio: 'inherit', windowsHide: true });
  const version = require('../package.json').version;
  const outputRoot = path.join(root, 'dist', version);
  const outputs = await packager({
    dir: root, out: outputRoot, name: 'Little Bot',
    platform: 'win32', arch: 'x64', electronVersion: '44.4.5',
    overwrite: true, prune: true, asar: false, icon: path.join(root, 'resources', 'icons', 'little-bot.ico'),
    // Local leftovers in a working checkout (an old copy, archives, benchmark baselines) never ship.
    ignore: [/^\/dist($|\/)/, /^\/test($|\/)/, /^\/scripts($|\/)/, /^\/\.test-data($|\/)/, /^\/\.bench-base($|\/)/, /^\/little-bot-main($|\/)/, /^\/[^/]+\.zip$/,
      /^\/node_modules\/onnxruntime-node\/bin\/napi-v6\/(?:darwin|linux|win32\/arm64)(?:\/|$)/,
      // The CAD workshop loads one OpenCascade build, replicad's ES module and three's two module files.
      /^\/node_modules\/replicad-opencascadejs\/dist\/replicad_multi\./, /^\/node_modules\/replicad\/dist\/.*\.(?:map|cjs)$/,
      /^\/node_modules\/three\/(?!build(?:$|\/three\.(?:module|core)\.js$)|package\.json$|LICENSE$)/],
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
