'use strict';

// The PC's fonts by family name, for text in CAD parts. Windows lists installed fonts in the registry ("Arial Bold
// (TrueType)" -> arialbd.ttf), for all users and for this user; the list is read once. Font collections (.ttc) are
// left out: the text engine reads single fonts only.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KEYS = ['HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'];
const STYLE_WORDS = { regular: [], bold: ['bold'], italic: ['italic'], bolditalic: ['bold', 'italic'] };

let index = null;

// "Arial Bold Italic (TrueType)" -> "arial bold italic"
const cleanName = name => name.replace(/\s*\((TrueType|OpenType|All res)\)\s*$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();

function readRegistry(run = execFileSync) {
  const fonts = new Map();
  const folder = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  for (const key of KEYS) {
    let out = '';
    try { out = run('reg', ['query', key], { encoding: 'utf8', windowsHide: true, timeout: 5000 }); } catch { continue; }
    for (const line of out.split(/\r?\n/)) {
      const match = /^\s{2,}(.+?)\s{2,}REG_(?:EXPAND_)?SZ\s{2,}(.+?)\s*$/.exec(line);
      if (!match) continue;
      const file = path.isAbsolute(match[2]) ? match[2] : path.join(folder, match[2]);
      if (!/\.(ttf|otf)$/i.test(file) || match[1].includes('&')) continue;
      fonts.set(cleanName(match[1]), file);
    }
  }
  return fonts;
}

function fontIndex(run) {
  if (!index || run) index = process.platform === 'win32' || run ? readRegistry(run) : new Map();
  return index;
}

// The file of a family in a style, or null. A family with no regular entry may be listed by its bare name.
function fontFile(family, style = 'regular', run) {
  const fonts = fontIndex(run);
  const name = cleanName(String(family || ''));
  if (!name || name.length > 60 || !STYLE_WORDS[style]) return null;
  const words = STYLE_WORDS[style];
  const candidates = style === 'regular' ? [name, `${name} regular`] : [`${name} ${words.join(' ')}`, ...(style === 'bolditalic' ? [`${name} bold oblique`] : style === 'italic' ? [`${name} oblique`] : [])];
  for (const candidate of candidates) {
    const file = fonts.get(candidate);
    if (file && fs.existsSync(file)) return file;
  }
  return null;
}

module.exports = { fontFile, cleanName, readRegistry };
