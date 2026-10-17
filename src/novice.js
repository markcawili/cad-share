// Novice (customer) side: joins the expert's room and edits the model with
// hand gestures. Keyboard shortcuts do the same things, for testing without a camera.
import { SceneView } from './scene.js';
import { joinRoom } from './net.js';
import { initialDoc, pieceLabel } from './model.js';
import * as ops from './ops.js';
import { GestureInterpreter } from './gestures.js';
import { HandTracker } from './handtracker.js';
import { $, setStatus, toast, showBanner, showCursor } from './ui.js';

// Each action has its own hand shape (see gestures.js).
const GESTURES = [
  { pose: 'point', icon: '👉', name: 'Point, hold still', what: 'Select the piece under the cursor', key: 'click' },
  { pose: 'palm', icon: '✋', name: 'Open hand, swipe', what: 'Move one step left / right / up / down', key: '← → ↑ ↓' },
  { pose: 'fist', icon: '✊', name: 'Fist, hold, then turn', what: 'Rotate like a dial (snaps to 15° on release)', key: 'Q E' },
  { pose: 'pinch', icon: '👌', name: 'OK sign, spread / close', what: 'Zoom: keep the other 3 fingers up; drop them to stop', key: '+ −' },
  { pose: 'thumbs', icon: '👍', name: 'Thumbs up, hold', what: 'Confirm placement', key: 'Enter' },
];
const POSE_NAMES = {
  none: 'No hand', point: '👉 Point', palm: '✋ Open hand', fist: '✊ Fist (rotate)',
  pinch: '👌 OK sign', thumbs: '👍 Thumbs up', other: 'Hand', off: '📷 Camera off',
};

export function startNovice(room) {
  $('role').textContent = 'Customer';
  setStatus('Connecting to expert…', 'warn');

  const view = new SceneView($('viewport'));
  let doc = initialDoc();
  view.applyDoc(doc);

  $('panel').innerHTML = `
    <section>
      <h3>Your camera</h3>
      <button id="cam-toggle" class="cam-toggle" disabled>Starting camera…</button>
      <div class="webcam">
        <video id="video" playsinline muted></video>
        <canvas id="overlay"></canvas>
        <div id="cam-note" class="note">Starting camera and hand tracking…</div>
      </div>
    </section>
    <section>
      <h3>Detected</h3>
      <div id="pose" class="pose">No hand</div>
      <div id="target" class="muted">Nothing selected: gestures move the whole model</div>
    </section>
    <section>
      <h3>Gestures</h3>
      <ul class="gestures">
        ${GESTURES.map((g) => `
          <li data-pose="${g.pose}">
            <span class="icon">${g.icon}</span>
            <span><b>${g.name}</b><br><span class="what">${g.what} · <kbd>${g.key}</kbd></span></span>
          </li>`).join('')}
      </ul>
    </section>`;

  const net = joinRoom(room, {
    onOpen: () => setStatus('Connected to expert', 'ok'),
    onLeave: () => setStatus('Expert disconnected', 'warn'),
    onError: (err) => {
      if (err.type === 'peer-unavailable') setStatus('Session not found: check the link or ask the expert to start it', 'warn');
      else setStatus(`Connection error: ${err.type ?? err.message}`, 'warn');
    },
    onMessage: (msg) => {
      if (msg.t === 'doc') {
        doc = msg.doc;
        view.applyDoc(doc);
        updateTarget();
      } else if (msg.t === 'highlight') {
        view.setHighlight(msg.id);
        showBanner(msg.id ? `Your expert is pointing out: ${pieceLabel(msg.id)}` : null);
      }
    },
  });

  // Every local change goes through here: show it, then send it to the expert.
  // push = this edit starts a new undo step; drop = discard the expert's latest undo step.
  function commit(next, push = false, drop = false) {
    doc = next;
    view.applyDoc(doc);
    updateTarget();
    net.send({ t: 'edit', doc, push, drop });
  }

  function updateTarget() {
    $('target').textContent = doc.selectedId
      ? `Selected: ${pieceLabel(doc.selectedId)}`
      : 'Nothing selected: gestures move the whole model';
  }

  function confirmPlacement() {
    net.send({ t: 'confirm', id: doc.selectedId });
    toast(`✅ Confirmed: ${pieceLabel(doc.selectedId)}`);
    commit(ops.select(doc, null));
  }

  // Apply one gesture event from the interpreter.
  let rotatePushPending = false;
  let beforeRotate = null; // model before the latest fist rotation, for rotateCancel
  let zoomBase = doc.zoom; // camera distance when the OK-sign zoom began
  function handleEvent(e) {
    switch (e.type) {
      case 'swipe':
        commit(ops.move(doc, e.dir, view.screenRight()), true);
        flash('palm');
        break;
      case 'rotateStart':
        rotatePushPending = true;
        beforeRotate = doc;
        break;
      case 'rotate':
        commit(ops.rotate(doc, e.delta), rotatePushPending);
        rotatePushPending = false;
        break;
      case 'rotateEnd':
        if (!rotatePushPending) commit(ops.snapRotation(doc));
        else beforeRotate = null; // the fist never actually turned anything
        rotatePushPending = false;
        break;
      case 'rotateCancel':
        // The fist was the start of a thumbs-up: put the model back as it was.
        if (beforeRotate) {
          commit({ ...beforeRotate, zoom: doc.zoom, selectedId: doc.selectedId }, false, true);
          beforeRotate = null;
        }
        break;
      case 'zoomStart':
        zoomBase = doc.zoom;
        break;
      case 'zoom':
        commit(ops.zoom({ ...doc, zoom: zoomBase }, e.factor));
        break;
      case 'select':
        commit(ops.select(doc, view.pick(e.x, e.y)));
        break;
      case 'confirm':
        confirmPlacement();
        break;
    }
  }

  // Gesture pipeline: camera → MediaPipe → interpreter → events.
  const interpreter = new GestureInterpreter();
  const tracker = new HandTracker($('video'), $('overlay'), (landmarks, category, t) => {
    const out = interpreter.update(landmarks, category, t);
    out.events.forEach(handleEvent);

    const pose = !tracker.running ? 'off' : out.zoomMode ? 'pinch' : out.pose;
    const progress = pose === 'thumbs' ? out.hold : out.dwell;
    showCursor(tracker.running ? out.cursor : null, progress);
    $('pose').textContent = out.zoomMode ? '👌 Zooming: drop 3 fingers to stop' : POSE_NAMES[pose];
    for (const li of document.querySelectorAll('.gestures li')) {
      li.classList.toggle('active', li.dataset.pose === pose);
    }
    net.send({ t: 'cursor', cursor: tracker.running ? out.cursor : null, pose, dwell: progress });
  });

  // Camera on/off, so the customer can rest their hands without moving anything.
  const camButton = $('cam-toggle');
  async function setCamera(on) {
    camButton.disabled = true;
    if (on) {
      $('cam-note').textContent = 'Starting camera and hand tracking…';
      $('cam-note').classList.remove('hidden');
      try {
        await tracker.start();
        $('cam-note').classList.add('hidden');
      } catch (err) {
        $('cam-note').textContent = `Camera unavailable (${err.name ?? err.message}). Keyboard controls still work.`;
      }
    } else {
      tracker.stop();
      $('cam-note').textContent = 'Camera is off. Gestures are paused.';
      $('cam-note').classList.remove('hidden');
    }
    camButton.textContent = tracker.running ? '📷 Turn camera off' : '📷 Turn camera on';
    camButton.disabled = false;
  }
  camButton.addEventListener('click', () => setCamera(!tracker.running));
  setCamera(true);

  // Briefly mark a gesture row in the help list, for one-shot gestures like swipes.
  function flash(pose) {
    const rows = document.querySelectorAll(`.gestures li[data-pose="${pose}"]`);
    rows.forEach((li) => li.classList.add('active'));
    setTimeout(() => rows.forEach((li) => li.classList.remove('active')), 400);
  }

  // Keyboard and mouse fallbacks.
  const KEY_MOVES = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  window.addEventListener('keydown', (e) => {
    if (KEY_MOVES[e.key]) {
      e.preventDefault();
      handleEvent({ type: 'swipe', dir: KEY_MOVES[e.key] });
    } else if (e.key === 'q' || e.key === 'e') {
      commit(ops.snapRotation(ops.rotate(doc, (e.key === 'q' ? 1 : -1) * Math.PI / 12)), true);
    } else if (e.key === '+' || e.key === '=') {
      commit(ops.zoom(doc, 1.15));
    } else if (e.key === '-') {
      commit(ops.zoom(doc, 1 / 1.15));
    } else if (e.key === 'Enter') {
      confirmPlacement();
    } else if (e.key === 'c' && !camButton.disabled) {
      setCamera(!tracker.running);
    } else if (e.key === 'Escape') {
      commit(ops.select(doc, null));
    }
  });
  view.renderer.domElement.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    commit(ops.select(doc, view.pick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)));
  });
}
