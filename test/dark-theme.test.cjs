'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { build, darken, OUTPUT } = require('../scripts/build-dark-theme.cjs');

test('the generated dark theme matches the current light stylesheets', () => {
  // Git may check files out with CRLF; compare the content, not the line endings.
  const normalize = text => text.replace(/\r/g, '');
  assert.equal(normalize(fs.readFileSync(OUTPUT, 'utf8')), normalize(build()), 'Run: node scripts/build-dark-theme.cjs');
});

test('dark colors mirror lightness, keep accents, and leave variables and shadows alone', () => {
  const lightness = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); return (Math.max(r, g, b) + Math.min(r, g, b)) / 2; };
  assert.ok(lightness(darken('#fcfbf8')) < 0.15, 'paper becomes dark');
  assert.ok(lightness(darken('#242d2a')) > 0.75, 'ink becomes light');
  assert.ok(Math.abs(lightness(darken('#bc623f')) - lightness('#bc623f')) < 0.12, 'accent keeps its weight');
  assert.match(darken('rgba(255,255,255,.5)'), /^rgba\(\d+,\d+,\d+,0\.5\)$/);
  const css = build();
  assert.doesNotMatch(css, /var\(--#/);
  assert.doesNotMatch(css, /box-shadow/);
  assert.match(css, /html\[data-theme=dark\]\{--paper:/);
});
