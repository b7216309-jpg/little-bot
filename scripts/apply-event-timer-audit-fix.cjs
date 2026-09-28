'use strict';

const fs = require('node:fs');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function replaceOnce(file, before, after, label) {
  const source = read(file);
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
}

replaceOnce(
  'src/event-bus.cjs',
  `    this.timer = null;\n    this.scheduled = false;`,
  `    this.timer = null;\n    this.timerAt = null;\n    this.scheduled = false;`,
  'event timer state',
);

replaceOnce(
  'src/event-bus.cjs',
  `    if (this.timer) this.clearTimer(this.timer);\n    this.timer = null;\n    if (clear) {`,
  `    if (this.timer) this.clearTimer(this.timer);\n    this.timer = null;\n    this.timerAt = null;\n    if (clear) {`,
  'event stop timer reset',
);

replaceOnce(
  'src/event-bus.cjs',
  `    this.scheduled = false;\n    if (this.timer) this.clearTimer(this.timer);\n    this.timer = null;\n    try {`,
  `    this.scheduled = false;\n    if (this.timer) this.clearTimer(this.timer);\n    this.timer = null;\n    this.timerAt = null;\n    try {`,
  'event drain timer reset',
);

replaceOnce(
  'src/event-bus.cjs',
  `  _schedule() {\n    if (!this.started || this.dispatching || this.scheduled) return;\n    if (this.timer) this.clearTimer(this.timer);\n    this.timer = null;\n    if (!this.queue.length) return;\n    const delay = Math.max(0, Math.min(...this.queue.map(entry => entry.event.availableAt)) - this.now());\n    this.scheduled = true;\n    if (delay === 0) {\n      this.defer(() => { this.scheduled = false; void this.drain(); });\n    } else {\n      this.timer = this.setTimer(() => { this.timer = null; this.scheduled = false; void this.drain(); }, delay);\n      this.timer?.unref?.();\n    }\n  }`,
  `  _schedule() {\n    if (!this.started || this.dispatching) return;\n    const nextAvailableAt = this.queue.length ? Math.min(...this.queue.map(entry => entry.event.availableAt)) : null;\n    if (nextAvailableAt === null) {\n      if (this.timer) this.clearTimer(this.timer);\n      this.timer = null;\n      this.timerAt = null;\n      this.scheduled = false;\n      return;\n    }\n    if (this.scheduled) {\n      // An already queued microtask will re-evaluate the complete queue. A real\n      // timer must move whenever the earliest available event changes.\n      if (!this.timer) return;\n      if (this.timerAt === nextAvailableAt) return;\n      this.clearTimer(this.timer);\n      this.timer = null;\n      this.timerAt = null;\n      this.scheduled = false;\n    }\n    const delay = Math.max(0, nextAvailableAt - this.now());\n    this.scheduled = true;\n    this.timerAt = nextAvailableAt;\n    if (delay === 0) {\n      const scheduledAt = nextAvailableAt;\n      this.defer(() => {\n        if (!this.started || !this.scheduled || this.timer || this.timerAt !== scheduledAt) return;\n        this.scheduled = false;\n        this.timerAt = null;\n        void this.drain();\n      });\n    } else {\n      this.timer = this.setTimer(() => {\n        this.timer = null;\n        this.timerAt = null;\n        this.scheduled = false;\n        void this.drain();\n      }, delay);\n      this.timer?.unref?.();\n    }\n  }`,
  'event queue scheduler',
);

const testFile = 'test/event-bus.test.cjs';
const testSource = read(testFile);
const testAddition = `\n\ntest('an immediate event reschedules an existing delayed wake-up', async () => {\n  const { bus, timers } = fixture();\n  const seen = [];\n  bus.subscribe({ type: '*', handler: event => seen.push(event.type) });\n  bus.start();\n  bus.publish({ type: 'event.delayed', debounceMs: 1000 });\n  assert.equal(timers.length, 1);\n  assert.equal(timers[0].at, 2000);\n\n  bus.publish({ type: 'event.immediate' });\n  await new Promise(resolve => setImmediate(resolve));\n\n  assert.deepEqual(seen, ['event.immediate']);\n  assert.equal(bus.state.queued, 1);\n  assert.equal(timers.length, 1);\n  assert.equal(timers[0].at, 2000);\n});\n`;
if (!testSource.includes("test('an immediate event reschedules an existing delayed wake-up'")) {
  fs.writeFileSync(testFile, testSource.trimEnd() + testAddition, 'utf8');
}
