'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const scroll = require('../src/renderer/chat-scroll.js');

function scroller({ scrollTop = 0, scrollHeight = 1000, clientHeight = 400, top = 0 } = {}) {
  return {
    scrollTop,
    scrollHeight,
    clientHeight,
    getBoundingClientRect() { return { top, bottom: top + clientHeight }; },
  };
}

function item(rect) {
  return {
    isConnected: true,
    rect: { ...rect },
    getBoundingClientRect() { return { ...this.rect }; },
  };
}

test('nearBottom uses a small deliberate follow threshold', () => {
  assert.equal(scroll.nearBottom(scroller({ scrollTop: 568 }), 32), true);
  assert.equal(scroll.nearBottom(scroller({ scrollTop: 567 }), 32), false);
});

test('tail-follow mode always moves to the newest content', () => {
  const view = scroller({ scrollTop: 500, scrollHeight: 1000 });
  const snapshot = scroll.capture(view, { children: [] }, true);
  view.scrollHeight = 1350;
  scroll.restore(view, snapshot);
  assert.equal(view.scrollTop, 1350);
});

test('reading position stays visually anchored when content grows above the viewport', () => {
  const view = scroller({ scrollTop: 300, scrollHeight: 1400 });
  const above = item({ top: -120, bottom: -20 });
  const anchor = item({ top: 40, bottom: 140 });
  const below = item({ top: 180, bottom: 280 });
  const host = { children: [above, anchor, below] };

  const snapshot = scroll.capture(view, host, false);
  assert.equal(snapshot.anchor, anchor);
  assert.equal(snapshot.anchorOffset, 40);

  // 90px of streamed/tool content was inserted above the visible anchor.
  anchor.rect.top += 90;
  anchor.rect.bottom += 90;
  below.rect.top += 90;
  below.rect.bottom += 90;
  view.scrollHeight += 90;

  scroll.restore(view, snapshot);
  assert.equal(view.scrollTop, 390);
});

test('native browser anchoring is not double-applied', () => {
  const view = scroller({ scrollTop: 300, scrollHeight: 1400 });
  const anchor = item({ top: 30, bottom: 130 });
  const host = { children: [anchor] };
  const snapshot = scroll.capture(view, host, false);

  // Browser already compensated for 80px inserted above, so the anchor
  // remains at the same visual offset while scrollTop has moved.
  view.scrollTop = 380;
  view.scrollHeight += 80;
  anchor.rect.top = 30;
  anchor.rect.bottom = 130;

  scroll.restore(view, snapshot);
  assert.equal(view.scrollTop, 380);
});

test('an intentionally detached anchor leaves the current scroll position alone', () => {
  const view = scroller({ scrollTop: 250, scrollHeight: 1200 });
  const anchor = item({ top: 20, bottom: 100 });
  const snapshot = scroll.capture(view, { children: [anchor] }, false);
  anchor.isConnected = false;
  view.scrollTop = 275;
  scroll.restore(view, snapshot);
  assert.equal(view.scrollTop, 275);
});
