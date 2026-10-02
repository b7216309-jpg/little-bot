'use strict';
// Builds the Little Bot Android app (plain Java, no Gradle) with the Android SDK build tools:
// aapt2 (resources) -> javac -> d8 (dex) -> zipalign -> apksigner, then copies it to resources/android so the
// phone relay serves it at /little-bot.apk. The signing key stays outside the repository.
//   ANDROID_HOME=C:\Users\you\Android node scripts/build-android.cjs
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const app = path.join(root, 'android');
const build = path.join(app, 'build');
const sdk = process.env.ANDROID_HOME || path.join(process.env.USERPROFILE || '', 'Android');
const version = require('../package.json').version;
const [major, minor, patch] = version.split('.').map(Number);
const versionCode = major * 10000 + minor * 100 + patch;

function latest(directory) {
  const entries = fs.readdirSync(directory).filter(name => !name.startsWith('.')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!entries.length) throw new Error(`Nothing installed in ${directory}`);
  return path.join(directory, entries.at(-1));
}
function run(file, args, options = {}) {
  const stdio = ['ignore', 'pipe', 'inherit'];
  // Windows .bat tools (d8, apksigner) need cmd.exe and explicit quoting; the project path has spaces.
  if (/\.(bat|cmd)$/i.test(file)) {
    const line = [file, ...args].map(value => `"${String(value).replace(/"/g, '""')}"`).join(' ');
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { stdio, windowsVerbatimArguments: true, ...options });
  } else execFileSync(file, args, { stdio, ...options });
}
function files(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(directory, entry.name), extension) : entry.name.endsWith(extension) ? [path.join(directory, entry.name)] : []);
}

const tools = latest(path.join(sdk, 'build-tools'));
const platform = path.join(latest(path.join(sdk, 'platforms')), 'android.jar');
const exe = name => path.join(tools, process.platform === 'win32' ? (['d8', 'apksigner'].includes(name) ? `${name}.bat` : `${name}.exe`) : name);

fs.rmSync(build, { recursive: true, force: true });
for (const dir of ['compiled', 'gen', 'classes', 'dex', 'res/mipmap-xxxhdpi', 'res/mipmap-xxhdpi']) fs.mkdirSync(path.join(build, dir), { recursive: true });

// 1. Resources: the vector notification icon plus launcher icons from the Wink build.
fs.copyFileSync(path.join(root, 'resources', 'icons', 'little-bot-192.png'), path.join(build, 'res', 'mipmap-xxxhdpi', 'ic_launcher.png'));
fs.copyFileSync(path.join(root, 'resources', 'icons', 'little-bot-192.png'), path.join(build, 'res', 'mipmap-xxhdpi', 'ic_launcher.png'));
for (const file of [...files(path.join(app, 'res'), ''), ...files(path.join(build, 'res'), '')]) run(exe('aapt2'), ['compile', '-o', path.join(build, 'compiled'), file]);
const unsigned = path.join(build, 'unsigned.apk');
run(exe('aapt2'), ['link', '-o', unsigned, '-I', platform, '--manifest', path.join(app, 'AndroidManifest.xml'), '--java', path.join(build, 'gen'),
  '--version-code', String(versionCode), '--version-name', version, '--min-sdk-version', '30', '--target-sdk-version', '34', '--auto-add-overlay', ...files(path.join(build, 'compiled'), '.flat')]);

// 2. Code: Java 8 language level, desugared by d8.
const sources = [...files(path.join(app, 'src'), '.java'), ...files(path.join(build, 'gen'), '.java')];
run('javac', ['-nowarn', '-Xlint:-options', '-source', '8', '-target', '8', '-encoding', 'UTF-8', '-bootclasspath', [platform, path.join(tools, 'core-lambda-stubs.jar')].join(path.delimiter), '-d', path.join(build, 'classes'), ...sources]);
run(exe('d8'), ['--release', '--min-api', '30', '--lib', platform, '--output', path.join(build, 'dex'), ...files(path.join(build, 'classes'), '.class')]);
run(exe('aapt'), ['add', unsigned, 'classes.dex'], { cwd: path.join(build, 'dex') });

// 3. Align and sign with the personal key (created once, kept next to the SDK, never committed).
const aligned = path.join(build, 'aligned.apk');
run(exe('zipalign'), ['-p', '-f', '4', unsigned, aligned]);
const keystore = process.env.LITTLE_BOT_KEYSTORE || path.join(sdk, 'little-bot.jks');
const passFile = `${keystore}.pass`;
if (!fs.existsSync(keystore)) {
  const password = crypto.randomBytes(24).toString('base64url');
  run('keytool', ['-genkeypair', '-keystore', keystore, '-storepass', password, '-keypass', password, '-alias', 'little-bot',
    '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Little Bot']);
  fs.writeFileSync(passFile, password, { mode: 0o600 });
}
const password = fs.readFileSync(passFile, 'utf8').trim();
const signed = path.join(build, 'little-bot.apk');
run(exe('apksigner'), ['sign', '--ks', keystore, '--ks-pass', `pass:${password}`, '--ks-key-alias', 'little-bot', '--out', signed, aligned]);
run(exe('apksigner'), ['verify', signed]);

const target = path.join(root, 'resources', 'android', 'little-bot.apk');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(signed, target);
console.log(`Built ${path.relative(root, target)} (${version}, code ${versionCode}, ${Math.round(fs.statSync(target).size / 1024)} KB).`);
