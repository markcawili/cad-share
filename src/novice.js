// Novice (customer) side: joins the expert's room and edits the model with
// hand gestures only.
//
// Layout: the model fills the screen, the camera preview sits top-right, a
// gesture pill at the bottom centre says what the current hand shape does, and
// the full gesture guide opens first as a modal, then lives in a drawer on the right.
import { SceneView } from './scene.js';
import { joinRoom } from './net.js';
import { initialDoc, pieceLabel } from './model.js';
import * as ops from './ops.js';
import { GestureInterpreter } from './gestures.js';
import { HandTracker } from './handtracker.js';
import { $, setStatus, toast, showBanner, showCursor } from './ui.js';
import { playSelect, playConfirm, unlockSound } from './sound.js';

// Each action has its own hand shape (see gestures.js).
const GESTURES = [
  { pose: 'point', icon: '👉', name: 'Point, hold still', what: 'Select the piece under the cursor. Point at empty space to deselect.' },
  { pose: 'palm', icon: '✋', name: 'Open hand, swipe', what: 'Move one step left, right, up or down.' },
  { pose: 'fist', icon: '✊', name: 'Fist, hold, then turn', what: 'Rotate like a dial. Snaps to 15° when you let go.' },
  { pose: 'pinch', icon: '👌', name: 'OK sign, spread / close', what: 'Zoom in or out. Keep the other three fingers up; drop them to stop.' },
  { pose: 'thumbs', icon: '👍', name: 'Thumbs up, hold', what: 'Confirm the placement.' },
];

const guideList = () => `
  <ul class="gesture-list">
    ${GESTURES.map((g) => `
      <li data-pose="${g.pose}">
        <span class="g-icon">${g.icon}</span>
        <span><b>${g.name}</b><span class="g-what">${g.what}</span></span>
      </li>`).join('')}
  </ul>`;

export function startNovice(room) {
  document.body.classList.add('novice');
  $('role').textContent = 'Customer';
  setStatus('Connecting to expert…', 'warn');

  const view = new SceneView($('viewport'));
  view.onSelect = playSelect;
  let doc = initialDoc();
  view.applyDoc(doc);

  $('viewport').insertAdjacentHTML('beforeend', `
    <div class="cam-card">
      <div class="webcam">
        <video id="video" playsinline muted></video>
        <canvas id="overlay"></canvas>
        <div id="cam-note" class="note">Camera starts after the gesture guide</div>
      </div>
      <button id="cam-toggle" class="cam-toggle" disabled>📷 Camera off</button>
    </div>

    <div id="hud" class="hud">
      <span class="hud-icon"><span id="hud-ring" class="hud-ring"></span><span id="hud-emoji">📷</span></span>
      <span class="hud-text"><b id="hud-title">Camera off</b><span id="hud-sub">Gestures are paused</span></span>
    </div>

    <button id="guide-tab" class="guide-tab hidden" aria-expanded="false"><span class="tab-icon">✋</span><span>Gestures</span></button>
    <aside id="guide-drawer" class="guide-drawer" aria-hidden="true">
      <div class="drawer-head"><h3>Hand gestures</h3><button id="guide-close" class="icon-btn" aria-label="Close">✕</button></div>
      ${guideList()}
      <p class="muted small">If a piece is selected, gestures act on it. Otherwise they move the whole model.</p>
    </aside>`);

  document.body.insertAdjacentHTML('beforeend', `
    <div id="guide-modal" class="modal-backdrop">
      <div class="modal" role="dialog" aria-labelledby="guide-title">
        <h2 id="guide-title">Shape the model with your hands</h2>
        <p class="muted">Your expert will walk you through the design. Use these gestures in front of your camera:</p>
        ${guideList()}
        <p class="muted small">If a piece is selected, gestures act on it. Otherwise they move the whole model.
          You can open this guide again from the <b>Gestures</b> tab on the right.</p>
        <button id="guide-ok" class="primary big">I understand, start my camera</button>
      </div>
    </div>`);

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
      } else if (msg.t === 'highlight') {
        view.setHighlight(msg.id);
        showBanner(msg.id ? `Your expert is pointing out: ${pieceLabel(msg.id)}` : null);
      }
    },
  });

  // Every local change goes through here: show it, then send it to the expert.
  // push = this edit starts a new undo step for the expert.
  function commit(next, push = false) {
    doc = next;
    view.applyDoc(doc);
    net.send({ t: 'edit', doc, push });
  }

  const targetName = () => (doc.selectedId ? pieceLabel(doc.selectedId) : 'the whole model');

  // ----- Gesture guide: modal first, then a drawer on the right -----
  const modal = $('guide-modal');
  const drawer = $('guide-drawer');
  const tab = $('guide-tab');
  $('guide-ok').addEventListener('click', () => {
    unlockSound(); // this click lets the page play sounds
    modal.classList.add('minimizing'); // the card shrinks off toward the Gestures tab
    setTimeout(() => {
      modal.remove();
      tab.classList.remove('hidden');
      tab.classList.add('attention');
    }, 450);
    setCamera(true);
  });
  const setDrawer = (open) => {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    tab.setAttribute('aria-expanded', String(open));
    tab.classList.remove('attention');
  };
  tab.addEventListener('click', () => setDrawer(!drawer.classList.contains('open')));
  $('guide-close').addEventListener('click', () => setDrawer(false));

  // ----- Bottom-centre gesture pill -----
  let hudHoldUntil = 0; // keeps a one-off message (swipe, confirm) visible briefly
  function setHud(emoji, title, sub, progress = 0, kind = '') {
    $('hud-emoji').textContent = emoji;
    $('hud-title').textContent = title;
    $('hud-sub').textContent = sub;
    $('hud-ring').style.setProperty('--p', progress);
    $('hud').className = `hud ${kind}`;
  }
  function flashHud(emoji, title, sub, kind) {
    setHud(emoji, title, sub, 0, kind);
    hudHoldUntil = performance.now() + 900;
  }
  function updateHud(pose, out) {
    if (performance.now() < hudHoldUntil) return;
    const what = targetName();
    switch (pose) {
      case 'off': return setHud('📷', 'Camera off', 'Gestures are paused');
      case 'none': return setHud('🖐️', 'Show your hand', 'Hold it up in front of the camera');
      case 'point': return setHud('👉', 'Pointing', 'Hold still to select', out.dwell, 'active');
      case 'palm': return setHud('✋', 'Open hand', `Swipe to move ${what}`, 0, 'active');
      case 'fist': return out.rotating
        ? setHud('✊', 'Rotating', `Turning ${what}`, 0, 'active')
        : setHud('✊', 'Fist', 'Hold, then turn to rotate', 0, 'active');
      case 'pinch': return setHud('👌', 'Zooming', 'Spread / close · drop 3 fingers to stop', 0, 'active');
      case 'thumbs': return setHud('👍', 'Thumbs up', 'Hold to confirm placement', out.hold, 'active');
      default: return setHud('🖐️', 'Hand detected', 'Make one of the gestures');
    }
  }

  function confirmPlacement() {
    const id = doc.selectedId;
    net.send({ t: 'confirm', id });
    view.flashConfirm(id);
    playConfirm();
    flashHud('✅', 'Placement confirmed', pieceLabel(id), 'done');
    toast(`✅ Confirmed: ${pieceLabel(id)}`);
    commit(ops.select(doc, null));
  }

  // Apply one gesture event from the interpreter.
  let rotatePushPending = false;
  let zoomBase = doc.zoom; // camera distance when the OK-sign zoom began
  const ARROWS = { left: '⬅️', right: '➡️', up: '⬆️', down: '⬇️' };
  function handleEvent(e) {
    switch (e.type) {
      case 'swipe':
        commit(ops.move(doc, e.dir, view.screenRight()), true);
        flashHud(ARROWS[e.dir], `Moved ${e.dir}`, targetName(), 'active');
        break;
      case 'rotateStart':
        rotatePushPending = true;
        break;
      case 'rotate':
        commit(ops.rotate(doc, e.delta), rotatePushPending);
        rotatePushPending = false;
        break;
      case 'rotateEnd':
        if (!rotatePushPending) commit(ops.snapRotation(doc));
        rotatePushPending = false;
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

  // ----- Gesture pipeline: camera → MediaPipe → interpreter → events -----
  const interpreter = new GestureInterpreter();
  const tracker = new HandTracker($('video'), $('overlay'), (landmarks, category, t) => {
    const out = interpreter.update(landmarks, category, t);
    out.events.forEach(handleEvent);

    const pose = !tracker.running ? 'off' : out.zoomMode ? 'pinch' : out.pose;
    const progress = pose === 'thumbs' ? out.hold : out.dwell;
    showCursor(tracker.running ? out.cursor : null, progress);
    updateHud(pose, out);
    for (const li of document.querySelectorAll('.gesture-list li')) {
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
        $('cam-note').textContent = `Camera unavailable (${err.name ?? err.message})`;
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
}
