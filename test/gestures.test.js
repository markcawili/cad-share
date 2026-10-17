// Feeds synthetic hand landmarks through the interpreter to check each gesture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GestureInterpreter, classifyPose } from '../src/gestures.js';
import { initialDoc } from '../src/model.js';
import * as ops from '../src/ops.js';

// Build 21 raw (unmirrored) landmarks for a hand centred at (cx, cy).
// fingers: which of index/middle/ring/pinky are extended. angle tilts the knuckle line.
function hand({ cx = 0.5, cy = 0.5, fingers = [1, 1, 1, 1], thumbTip = null, angle = 0 }) {
  const lm = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  const rot = (dx, dy) => ({
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
    z: 0,
  });
  lm[0] = rot(0, 0.15); // wrist
  const base = [5, 9, 13, 17];
  base.forEach((mcp, i) => {
    const dx = -0.045 + i * 0.03;
    lm[mcp] = rot(dx, 0);
    if (fingers[i]) {
      lm[mcp + 1] = rot(dx, -0.04);
      lm[mcp + 2] = rot(dx, -0.07);
      lm[mcp + 3] = rot(dx, -0.1);
    } else {
      lm[mcp + 1] = rot(dx, -0.03);
      lm[mcp + 2] = rot(dx, -0.01);
      lm[mcp + 3] = rot(dx, 0.02);
    }
  });
  lm[1] = rot(-0.06, 0.1);
  lm[2] = rot(-0.08, 0.07);
  lm[3] = rot(-0.09, 0.04);
  lm[4] = thumbTip ? rot(...thumbTip) : rot(-0.1, 0.01);
  return lm;
}

const POINT = { fingers: [1, 0, 0, 0] };
const PALM = { fingers: [1, 1, 1, 1] };
const FIST = { fingers: [0, 0, 0, 0] };
// Thumb tucked against the curled index: the shape that used to read as a pinch.
const TIGHT_FIST = { fingers: [0, 0, 0, 0], thumbTip: [-0.045, 0.02] };
const THUMBS_UP = { fingers: [0, 0, 0, 0], thumbTip: [-0.1, -0.08] };
// OK sign: middle/ring/pinky up, thumb meets the index tip. gap widens the thumb-index distance.
const ok = (gap = 0) => ({ fingers: [0, 1, 1, 1], thumbTip: [-0.045 - gap, 0.02] });

// Run frames at ~30 fps; returns all events.
function run(g, frames, start = 0) {
  const events = [];
  frames.forEach(([opts, cat], i) => {
    events.push(...g.update(opts ? hand(opts) : null, cat ?? 'None', start + i * 33).events);
  });
  return events;
}
const repeat = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const types = (ev) => ev.map((e) => e.type);

test('classifies each pose from landmarks alone', () => {
  assert.equal(classifyPose(hand(POINT), 'None'), 'point');
  assert.equal(classifyPose(hand(PALM), 'None'), 'palm');
  assert.equal(classifyPose(hand(FIST), 'None'), 'fist');
  assert.equal(classifyPose(hand(TIGHT_FIST), 'None'), 'fist');
  assert.equal(classifyPose(hand(THUMBS_UP), 'None'), 'thumbs');
  assert.equal(classifyPose(hand(ok()), 'None'), 'pinch');
});

test('a fist never starts zoom, even when MediaPipe drops the fist label', () => {
  const frames = repeat(40, (i) => [TIGHT_FIST, i % 3 ? 'Closed_Fist' : 'None']);
  const ev = run(new GestureInterpreter(), frames);
  assert.equal(ev.filter((e) => e.type === 'zoom').length, 0);
});

test('point and hold selects once', () => {
  const ev = run(new GestureInterpreter(), repeat(45, () => [POINT]));
  assert.deepEqual(types(ev), ['select']);
});

test('moving a pointing finger never swipes', () => {
  const ev = run(new GestureInterpreter(), repeat(10, (i) => [{ ...POINT, cx: 0.8 - i * 0.06 }]));
  assert.equal(ev.filter((e) => e.type === 'swipe').length, 0);
});

test('open-hand swipe right fires once and the return stroke is ignored', () => {
  // Raw x decreases = the user's hand moves to their right (camera is mirrored).
  const settle = repeat(4, () => [{ ...PALM, cx: 0.7 }]);
  const there = repeat(8, (i) => [{ ...PALM, cx: 0.7 - i * 0.05 }]);
  const back = repeat(8, (i) => [{ ...PALM, cx: 0.35 + i * 0.05 }]);
  const ev = run(new GestureInterpreter(), [...settle, ...there, ...repeat(22, () => [{ ...PALM, cx: 0.35 }]), ...back]);
  assert.deepEqual(ev.filter((e) => e.type === 'swipe').map((e) => e.dir), ['right']);
});

test('open-hand swipe up', () => {
  const settle = repeat(4, () => [{ ...PALM, cy: 0.7 }]);
  const ev = run(new GestureInterpreter(), [...settle, ...repeat(8, (i) => [{ ...PALM, cy: 0.7 - i * 0.05 }])]);
  assert.deepEqual(ev.filter((e) => e.type === 'swipe').map((e) => e.dir), ['up']);
});

test('fist turn rotates after a short hold, then ends', () => {
  const frames = repeat(30, (i) => [{ ...FIST, angle: i * 0.03 }, 'Closed_Fist']);
  const ev = run(new GestureInterpreter(), [...frames, [null]]);
  assert.equal(ev[0].type, 'rotateStart');
  assert.equal(ev.at(-1).type, 'rotateEnd');
  const total = ev.filter((e) => e.type === 'rotate').reduce((s, e) => s + e.delta, 0);
  assert.ok(Math.abs(total) > 0.5, `expected noticeable rotation, got ${total}`);
  assert.equal(ev.filter((e) => e.type === 'swipe').length, 0);
});

test('a brief fist on the way to a thumbs-up never rotates', () => {
  const fist = repeat(6, (i) => [{ ...FIST, angle: i * 0.05 }, 'Closed_Fist']); // ~200 ms
  const thumbs = repeat(30, () => [THUMBS_UP, 'Thumb_Up']);
  const ev = run(new GestureInterpreter(), [...fist, ...thumbs]);
  assert.deepEqual(types(ev), ['confirm']);
});

test('a longer fist that turns into a thumbs-up cancels its rotation', () => {
  const fist = repeat(15, (i) => [{ ...FIST, angle: i * 0.05 }, 'Closed_Fist']); // ~500 ms
  const thumbs = repeat(30, () => [THUMBS_UP, 'Thumb_Up']);
  const ev = types(run(new GestureInterpreter(), [...fist, ...thumbs]));
  assert.ok(ev.includes('rotate'));
  assert.deepEqual(ev.slice(ev.indexOf('rotateEnd')), ['rotateEnd', 'rotateCancel', 'confirm']);
});

test('OK sign then spread zooms in steadily; holding still does not zoom', () => {
  const g = new GestureInterpreter();
  const still = run(g, repeat(20, () => [ok()]));
  assert.deepEqual(types(still), ['zoomStart']);
  const spread = run(g, repeat(15, (i) => [ok(i * 0.01)]), 20 * 33);
  const factors = spread.filter((e) => e.type === 'zoom').map((e) => e.factor);
  assert.ok(factors.length > 0 && factors.every((f) => f > 1));
  assert.ok(factors.every((f, i) => i === 0 || f >= factors[i - 1]), 'zoom should only grow while spreading');
  assert.equal(spread.filter((e) => e.type === 'swipe' || e.type === 'select').length, 0);
});

test('a shaky OK sign barely zooms', () => {
  const g = new GestureInterpreter();
  // Thumb wobbles back and forth by a few percent of a hand-length.
  const ev = run(g, repeat(60, (i) => [ok((i % 2 ? 1 : -1) * 0.006)]));
  const factors = ev.filter((e) => e.type === 'zoom').map((e) => e.factor);
  assert.ok(factors.every((f) => Math.abs(f - 1) < 0.05), `jitter zoomed: ${factors}`);
});

test('dropping the three fingers leaves zoom mode', () => {
  const g = new GestureInterpreter();
  run(g, repeat(5, () => [ok()]));
  assert.equal(g.zoomMode, true);
  run(g, repeat(15, () => [POINT]), 5 * 33);
  assert.equal(g.zoomMode, false);
});

test('thumbs-up held confirms once', () => {
  const ev = run(new GestureInterpreter(), repeat(60, () => [THUMBS_UP, 'Thumb_Up']));
  assert.deepEqual(types(ev), ['confirm']);
});

test('open palm held still no longer confirms', () => {
  const ev = run(new GestureInterpreter(), repeat(60, () => [PALM, 'Open_Palm']));
  assert.deepEqual(types(ev), []);
});

test('move acts on selection, else the whole model', () => {
  const right = [0.79, -0.62];
  let doc = ops.move(initialDoc(), 'right', right);
  assert.deepEqual(doc.model.pos, [0.5, 0, 0]);
  doc = ops.select(doc, 'roof');
  doc = ops.move(doc, 'up', right);
  assert.equal(doc.pieces.roof.pos[1], 2.85);
  assert.deepEqual(doc.model.pos, [0.5, 0, 0]);
});

test('move of a piece follows the screen when the model is rotated', () => {
  let doc = ops.rotate(initialDoc(), Math.PI / 2);
  doc = ops.select(doc, 'roof');
  doc = ops.move(doc, 'right', [1, 0]);
  // Model turned 90°: screen-right (world +x) is local +z for the pieces.
  assert.deepEqual(doc.pieces.roof.pos.map((v) => +v.toFixed(3)), [0, 2.35, 0.5]);
});

test('expert orbit rotates the whole model even with a piece selected', () => {
  const doc = ops.rotateModel(ops.select(initialDoc(), 'roof'), 0.5);
  assert.equal(doc.model.rotY, 0.5);
  assert.equal(doc.pieces.roof.rotY, 0);
});
