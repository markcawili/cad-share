// Turns per-frame hand landmarks into intent events.
// Pure logic: no camera, no MediaPipe import, so it can be unit tested with
// synthetic frames. Tune the numbers in CONFIG if detection feels off.
//
// Each action has its own hand shape, so they can't be confused:
//   👉 point       index finger only        cursor; hold still to select
//   ✋ palm        all fingers open          swipe to move
//   ✊ fist        all fingers curled        turn like a dial to rotate
//   👌 pinch (OK)  thumb+index touch, other three up   spread/close thumb and index to zoom
//   👍 thumbs      thumb up, fingers curled  hold to confirm

export const CONFIG = {
  poseStableFrames: 3, // a new pose must repeat this many frames before it counts

  // Cursor: the part of the camera image the fingertip moves within (mirrored, 0..1).
  cursorBox: { x0: 0.15, x1: 0.85, y0: 0.1, y1: 0.75 },
  cursorSmoothing: 0.4, // 0..1, higher follows the finger faster

  dwellMs: 800, // hold a point this long to select
  dwellRadius: 0.04, // cursor may wobble this much (0..1 of the canvas) while dwelling

  // Swipe distances are in hand-lengths (wrist → middle knuckle), so they work
  // the same whether you sit close to the camera or far from it.
  swipeWindowMs: 400, // a swipe must happen within this time...
  swipeDistance: 1.2, // ...and the palm must travel this many hand-lengths
  swipeAxisRatio: 1.3, // main direction must dominate the other by this factor
  swipePalmGraceMs: 300, // the open hand may blur into another pose this long mid-swipe
  swipeCooldownMs: 600, // pause after a swipe before another is allowed
  swipeReverseBlockMs: 1200, // block the opposite direction (the hand returning) this long

  rotateArmMs: 300, // hold a fist this long before it starts rotating
  fistToThumbsFrames: 8, // a fist must show a clear thumbs-up this many frames (~0.25 s) to switch
  rotateGain: 1.5, // model radians per radian of fist turn
  rotateDeadzone: 0.01, // ignore per-frame wrist jitter smaller than this (radians)

  pinchClose: 0.3, // thumb–index gap (in hand-lengths) that counts as touching
  zoomSmoothing: 0.2, // 0..1, lower = smoother but slower zoom
  zoomDeadzone: 0.05, // gap may wobble this much around where it started without zooming (hand-lengths)
  zoomStep: 0.01, // smallest gap change worth sending (hand-lengths)
  zoomGain: 1.5, // zoom strength per hand-length of gap change
  zoomExitMs: 300, // leave zoom mode once the three fingers have been down this long

  thumbsHoldMs: 600, // hold a thumbs-up this long to confirm
  holdRadius: 0.05, // hand may drift this much (0..1 of the image) during a hold
};

// MediaPipe hand landmark indices.
const WRIST = 0, THUMB_MCP = 2, THUMB_IP = 3, THUMB_TIP = 4, INDEX_MCP = 5, INDEX_PIP = 6,
  INDEX_TIP = 8, MIDDLE_MCP = 9, MIDDLE_PIP = 10, MIDDLE_TIP = 12, RING_MCP = 13,
  RING_PIP = 14, RING_TIP = 16, PINKY_MCP = 17, PINKY_PIP = 18, PINKY_TIP = 20;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function extended(lm, tip, pip) {
  return dist(lm[WRIST], lm[tip]) > dist(lm[WRIST], lm[pip]) * 1.1;
}

/** Measurements shared by the classifier and the handlers. */
export function measure(lm) {
  const handSize = dist(lm[WRIST], lm[MIDDLE_MCP]);
  return {
    handSize,
    index: extended(lm, INDEX_TIP, INDEX_PIP),
    middle: extended(lm, MIDDLE_TIP, MIDDLE_PIP),
    ring: extended(lm, RING_TIP, RING_PIP),
    pinky: extended(lm, PINKY_TIP, PINKY_PIP),
    pinchGap: dist(lm[THUMB_TIP], lm[INDEX_TIP]) / handSize,
    // How far the thumb tip sticks out from the index knuckle. In a fist the
    // thumb rests across the fingers, so this stays small.
    thumbOut: dist(lm[THUMB_TIP], lm[INDEX_MCP]) / handSize,
    // Thumb pointing up and clearly above the knuckles (image y grows downwards).
    thumbAbove: (lm[INDEX_MCP].y - lm[THUMB_TIP].y) / handSize,
    thumbStraightUp: lm[THUMB_TIP].y < lm[THUMB_IP].y && lm[THUMB_IP].y < lm[THUMB_MCP].y,
  };
}

/**
 * Pose from finger positions, with MediaPipe's label as a second opinion for
 * fist and thumbs-up. The order matters: earlier checks win.
 */
export function classifyPose(lm, category) {
  const m = measure(lm);
  const curled = !m.index && !m.middle && !m.ring && !m.pinky;
  const threeUp = m.middle && m.ring && m.pinky;

  // Thumbs-up needs the thumb clearly out and up, even when MediaPipe says Thumb_Up,
  // so a fist with the thumb resting on top still counts as a fist.
  const thumbClear = m.thumbStraightUp && m.thumbAbove > 0.3;
  if ((category === 'Thumb_Up' && m.thumbOut > 0.55 && thumbClear) ||
      (curled && m.thumbOut > 0.7 && thumbClear)) return 'thumbs';
  if (category === 'Closed_Fist' || curled) return 'fist';
  if (threeUp && m.pinchGap < CONFIG.pinchClose) return 'pinch';
  if (m.index && threeUp) return 'palm';
  if (m.index && !m.middle && !m.ring && !m.pinky) return 'point';
  return 'other';
}

export class GestureInterpreter {
  constructor() {
    this.reset();
  }

  reset() {
    this.pose = 'none';
    this.candidate = null;
    this.candidateCount = 0;
    this.cursor = null;
    this.trail = []; // recent palm-centre samples for swipe detection
    this.lastPalm = -Infinity; // last time the open hand was seen
    this.lastSwipe = { t: -Infinity, dir: null };
    this.dwell = null; // { x, y, start, fired }
    this.hold = null; // thumbs-up hold: { x, y, start, fired }
    this.rotating = false;
    this.fistSince = null;
    this.lastAngle = 0;
    this.zoomMode = false;
    this.smoothGap = 0;
    this.startGap = 0;
    this.lastZoomAmount = 0;
    this.threeDownSince = null;
  }

  /**
   * @param landmarks 21 {x, y, z} points in raw camera coordinates, or null when no hand
   * @param category MediaPipe gesture label ('Closed_Fist', 'Open_Palm', ...) or 'None'
   * @param t timestamp in ms
   * @returns {{pose, cursor, dwell, hold, zoomMode, rotating, events}}
   */
  update(landmarks, category, t) {
    const events = [];
    this.now = t;
    if (!landmarks) {
      if (this.rotating) events.push({ type: 'rotateEnd' });
      this.reset();
      return this.snapshot(events);
    }

    // Mirror so "right" means the user's right, like looking in a mirror.
    const lm = landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
    const m = measure(lm);
    this.updatePose(classifyPose(lm, category));

    const palmCentre = averagePoint(lm, [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]);
    this.updateCursor(lm[INDEX_TIP]);

    this.handleZoom(m, t, events);
    this.handleRotate(lm, t, events);
    this.handleSwipe(palmCentre, m.handSize, t, events);
    this.handleDwell(t, events);
    this.handleThumbs(palmCentre, t, events);

    return this.snapshot(events);
  }

  snapshot(events) {
    const progress = (s, ms) => (s && !s.fired ? clamp01((this.now - s.start) / ms) : 0);
    return {
      pose: this.pose,
      cursor: this.cursor,
      dwell: progress(this.dwell, CONFIG.dwellMs),
      hold: progress(this.hold, CONFIG.thumbsHoldMs),
      zoomMode: this.zoomMode,
      rotating: this.rotating,
      events,
    };
  }

  updatePose(raw) {
    this.rawPose = raw;
    if (raw === this.pose) {
      this.candidate = null;
      return;
    }
    if (raw === this.candidate) this.candidateCount++;
    else {
      this.candidate = raw;
      this.candidateCount = 1;
    }
    // Leaving a fist for a thumbs-up needs extra proof: they look alike mid-rotation.
    const needed = this.pose === 'fist' && raw === 'thumbs' ? CONFIG.fistToThumbsFrames : CONFIG.poseStableFrames;
    if (this.candidateCount >= needed) {
      this.pose = raw;
      this.candidate = null;
    }
  }

  updateCursor(tip) {
    const b = CONFIG.cursorBox;
    const x = clamp01((tip.x - b.x0) / (b.x1 - b.x0));
    const y = clamp01((tip.y - b.y0) / (b.y1 - b.y0));
    if (!this.cursor) this.cursor = { x, y };
    else {
      const a = CONFIG.cursorSmoothing;
      this.cursor = { x: this.cursor.x + (x - this.cursor.x) * a, y: this.cursor.y + (y - this.cursor.y) * a };
    }
  }

  // OK sign starts zoom mode. While the middle, ring and pinky stay up,
  // spreading thumb and index zooms in and closing them zooms out.
  // Drop those three fingers (or make a fist) to stop.
  // Zoom follows how far the gap has moved since zoom mode began (not
  // frame-to-frame changes), so jitter can't build up and moving back undoes it.
  handleZoom(m, t, events) {
    if (!this.zoomMode) {
      if (this.pose !== 'pinch') return;
      this.zoomMode = true;
      this.smoothGap = this.startGap = m.pinchGap;
      this.lastZoomAmount = 0;
      this.threeDownSince = null;
      events.push({ type: 'zoomStart' });
      return;
    }
    const threeUp = m.middle && m.ring && m.pinky;
    if (this.pose === 'fist' || this.pose === 'point') {
      this.zoomMode = false;
      return;
    }
    if (!threeUp) {
      this.threeDownSince ??= t;
      if (t - this.threeDownSince > CONFIG.zoomExitMs) this.zoomMode = false;
      return;
    }
    this.threeDownSince = null;
    this.smoothGap += (m.pinchGap - this.smoothGap) * CONFIG.zoomSmoothing;
    const moved = this.smoothGap - this.startGap;
    const amount = Math.sign(moved) * Math.max(0, Math.abs(moved) - CONFIG.zoomDeadzone);
    if (Math.abs(amount - this.lastZoomAmount) > CONFIG.zoomStep) {
      // factor is relative to the zoom when zoom mode began; > 1 zooms in.
      events.push({ type: 'zoom', factor: Math.exp(amount * CONFIG.zoomGain) });
      this.lastZoomAmount = amount;
    }
  }

  // Closed fist: turning it like a dial rotates. Uses the knuckle line (index → pinky).
  // A hand passes through a fist on its way to a thumbs-up, so the fist must be
  // held briefly before rotating. Rotating and then giving a thumbs-up keeps the rotation.
  handleRotate(lm, t, events) {
    const angle = Math.atan2(lm[PINKY_MCP].y - lm[INDEX_MCP].y, lm[PINKY_MCP].x - lm[INDEX_MCP].x);
    if (this.pose === 'fist') {
      this.fistSince ??= t;
      if (!this.rotating) {
        // Arm only while this frame itself looks like a fist, not while the pose
        // is still "fist" only because the next pose hasn't been confirmed yet.
        if (this.rawPose !== 'fist' || t - this.fistSince < CONFIG.rotateArmMs) return;
        this.rotating = true;
        this.lastAngle = angle;
        events.push({ type: 'rotateStart' });
        return;
      }
      const d = angleDiff(angle, this.lastAngle);
      if (Math.abs(d) > CONFIG.rotateDeadzone) {
        events.push({ type: 'rotate', delta: -d * CONFIG.rotateGain });
        this.lastAngle = angle;
      }
      return;
    }
    this.fistSince = null;
    if (this.rotating) {
      this.rotating = false;
      events.push({ type: 'rotateEnd' });
    }
  }

  // Open hand moving quickly in one direction.
  handleSwipe(p, handSize, t, events) {
    if (this.pose === 'palm') this.lastPalm = t;
    this.trail.push({ x: p.x, y: p.y, t });
    while (this.trail.length && t - this.trail[0].t > CONFIG.swipeWindowMs) this.trail.shift();

    const openHand = t - this.lastPalm <= CONFIG.swipePalmGraceMs;
    if (!openHand || this.zoomMode) return;
    if (t - this.lastSwipe.t < CONFIG.swipeCooldownMs) return;

    const first = this.trail[0];
    const dx = (p.x - first.x) / handSize;
    const dy = (p.y - first.y) / handSize;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    let dir = null;
    if (ax > CONFIG.swipeDistance && ax > ay * CONFIG.swipeAxisRatio) dir = dx > 0 ? 'right' : 'left';
    else if (ay > CONFIG.swipeDistance && ay > ax * CONFIG.swipeAxisRatio) dir = dy > 0 ? 'down' : 'up';
    if (!dir) return;

    const opposite = { left: 'right', right: 'left', up: 'down', down: 'up' }[dir];
    if (this.lastSwipe.dir === opposite && t - this.lastSwipe.t < CONFIG.swipeReverseBlockMs) return;

    events.push({ type: 'swipe', dir });
    this.lastSwipe = { t, dir };
    this.trail = [];
  }

  // Point and hold still to select whatever is under the cursor.
  handleDwell(t, events) {
    if (this.pose !== 'point' || this.zoomMode) {
      this.dwell = null;
      return;
    }
    const c = this.cursor;
    if (!this.dwell || Math.hypot(c.x - this.dwell.x, c.y - this.dwell.y) > CONFIG.dwellRadius) {
      this.dwell = { x: c.x, y: c.y, start: t, fired: false };
      return;
    }
    if (!this.dwell.fired && t - this.dwell.start >= CONFIG.dwellMs) {
      this.dwell.fired = true;
      events.push({ type: 'select', x: c.x, y: c.y });
    }
  }

  // Thumbs-up held still confirms the placement (once per thumbs-up).
  handleThumbs(p, t, events) {
    if (this.pose !== 'thumbs') {
      this.hold = null;
      return;
    }
    if (!this.hold || (!this.hold.fired && Math.hypot(p.x - this.hold.x, p.y - this.hold.y) > CONFIG.holdRadius)) {
      this.hold = { x: p.x, y: p.y, start: t, fired: false };
      return;
    }
    if (!this.hold.fired && t - this.hold.start >= CONFIG.thumbsHoldMs) {
      this.hold.fired = true;
      events.push({ type: 'confirm' });
    }
  }
}

function averagePoint(lm, ids) {
  let x = 0, y = 0;
  for (const i of ids) {
    x += lm[i].x;
    y += lm[i].y;
  }
  return { x: x / ids.length, y: y / ids.length };
}
