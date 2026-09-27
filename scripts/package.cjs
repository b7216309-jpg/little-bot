const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const { packager } = await import('@electron/packager');
  const root = path.resolve(__dirname, '..');
  const version = require('../package.json').version;
  const outputs = await packager({
    dir: root, out: path.join(root, 'dist', version), name: 'Little Bot',
    platform: 'win32', arch: 'x64', electronVersion: '44.4.5',
    overwrite: true, prune: true, asar: false,
    ignore: [/^\/dist($|\/)/, /^\/test($|\/)/, /^\/scripts($|\/)/, /^\/\.test-data($|\/)/,
      /^\/node_modules\/agent-browser\/bin\/agent-browser-(?:darwin|linux)/],
    win32metadata: { CompanyName: 'Personal project', FileDescription: 'Little Bot — local assistant', ProductName: 'Little Bot' },
  });
  const launcher = path.join(root, 'Launch Little Bot.cmd');
  fs.writeFileSync(launcher, `@echo off\r\nstart "" "%~dp0dist\\${version}\\Little Bot-win32-x64\\Little Bot.exe"\r\n`);
  console.log(`Packaged: ${outputs.join(', ')}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
