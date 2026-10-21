// Expert side: hosts the room, clicks pieces to highlight them for the
// customer, and can undo or reset the customer's changes.
//
// Messages between the two sides:
//   expert → novice  { t: 'doc', doc }            full model state (on join, undo, reset)
//                    { t: 'highlight', id }       piece the expert is pointing out (or null)
//   novice → expert  { t: 'edit', doc, push }     novice changed the model; push = new undo step
//                    { t: 'cursor', cursor, pose, dwell }
//                    { t: 'confirm', id }         novice confirmed a placement (thumbs-up)
import { SceneView } from './scene.js';
import { hostRoom } from './net.js';
import { initialDoc, cloneDoc, pieceLabel } from './model.js';
import { rotateModel, tiltView } from './ops.js';
import { $, setStatus, toast, showBanner, showCursor, button } from './ui.js';
import { playSelect, playConfirm, unlockSound } from './sound.js';

const POSE_NAMES = {
  none: 'No hand',
  point: '👉 Pointing',
  palm: '✋ Open hand (swipe)',
  fist: '✊ Rotating',
  pinch: '👌 Zooming',
  thumbs: '👍 Thumbs up',
  other: '—',
  off: '📷 Camera off',
};

export function startExpert(room) {
  $('role').textContent = 'Expert';
  setStatus('Starting…');

  const view = new SceneView($('viewport'));
  view.onSelect = playSelect; // the customer picked a piece
  window.addEventListener('pointerdown', unlockSound, { once: true });
  let doc = initialDoc();
  let highlightId = null;
  const history = [];
  view.applyDoc(doc);
  $('cursor').classList.add('remote');

  // Toolbar: invite link, undo, reset.
  const invite = new URL(location.href);
  invite.searchParams.delete('role');
  const link = Object.assign(document.createElement('input'), { readOnly: true, value: invite.href });
  const toolbar = $('toolbar');
  toolbar.append(
    link,
    button('Copy invite link', async (e) => {
      await navigator.clipboard.writeText(link.value);
      e.target.textContent = 'Copied ✓';
      setTimeout(() => (e.target.textContent = 'Copy invite link'), 1500);
    }, 'primary'),
    button('Undo', undo),
    button('Reset model', reset),
  );

  // Side panel: what the customer is doing.
  $('panel').innerHTML = `
    <section>
      <h3>Customer's hand</h3>
      <div id="novice-pose" class="pose">Not connected</div>
      <div id="novice-target" class="muted"></div>
    </section>
    <section>
      <h3>How to guide</h3>
      <p><b>Middle-drag</b> (hold the scroll wheel and drag): left / right turns the model, up / down tilts the view, all the way around.</p>
      <p>Click a piece to highlight it for the customer. Click it again, or click empty space, to clear the highlight.</p>
      <p>The customer moves, rotates and zooms with hand gestures. Their cursor shows in purple.</p>
      <p><b>Undo</b> steps back one customer change. <b>Reset model</b> restores the original house.</p>
    </section>`;

  const net = hostRoom(room, {
    onOpen: () => setStatus('Waiting for customer to join…', 'warn'),
    onJoin: () => {
      setStatus('Customer connected', 'ok');
      toast('Customer joined');
      $('novice-pose').textContent = 'No hand detected yet';
      net.send({ t: 'doc', doc });
      net.send({ t: 'highlight', id: highlightId });
    },
    onLeave: () => {
      setStatus('Customer left: waiting…', 'warn');
      $('novice-pose').textContent = 'Not connected';
      showCursor(null);
    },
    onError: (err) => {
      if (err.type === 'unavailable-id') setStatus('Room still in use: wait a minute, then reload', 'warn');
      else setStatus(`Connection error: ${err.type ?? err.message}`, 'warn');
    },
    onMessage: (msg) => {
      if (msg.t === 'edit') {
        if (msg.push) history.push(cloneDoc(doc));
        doc = msg.doc;
        view.applyDoc(doc);
        $('novice-target').textContent = doc.selectedId
          ? `Selected: ${pieceLabel(doc.selectedId)}`
          : 'Nothing selected (gestures move the whole model)';
      } else if (msg.t === 'cursor') {
        showCursor(msg.cursor, msg.dwell);
        $('novice-pose').textContent = POSE_NAMES[msg.pose] ?? msg.pose;
      } else if (msg.t === 'confirm') {
        toast(`✅ Customer confirmed placement: ${pieceLabel(msg.id)}`);
        view.flashConfirm(msg.id);
        playConfirm();
      }
    },
  });

  // Click to highlight a piece for the customer.
  view.renderer.domElement.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const id = view.pick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    highlightId = id === highlightId ? null : id;
    view.setHighlight(highlightId);
    if (highlightId) playSelect();
    showBanner(highlightId ? `Highlighting: ${pieceLabel(highlightId)}` : null);
    net.send({ t: 'highlight', id: highlightId });
  });

  // Middle mouse button drag orbits, as in most 3D software:
  // left / right turns the model, up / down tilts the view (a full 360°).
  const canvas = view.renderer.domElement;
  let orbit = null; // { x, y, pushed } while dragging
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return;
    e.preventDefault(); // stop the browser's middle-click autoscroll
    orbit = { x: e.clientX, y: e.clientY, pushed: false };
    canvas.classList.add('orbiting');
  });
  window.addEventListener('mousemove', (e) => {
    if (!orbit) return;
    const dx = e.clientX - orbit.x;
    const dy = e.clientY - orbit.y;
    if (!dx && !dy) return;
    if (!orbit.pushed) history.push(cloneDoc(doc)); // one undo step per drag
    orbit = { x: e.clientX, y: e.clientY, pushed: true };
    doc = tiltView(rotateModel(doc, dx * 0.01), dy * 0.01);
    view.applyDoc(doc);
    net.send({ t: 'doc', doc });
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 1) return;
    orbit = null;
    canvas.classList.remove('orbiting');
  });
  canvas.addEventListener('auxclick', (e) => e.preventDefault());

  function undo() {
    const prev = history.pop();
    if (!prev) return toast('Nothing to undo');
    // Keep the customer's current view and selection; only the geometry goes back.
    doc = { ...prev, zoom: doc.zoom, selectedId: doc.selectedId };
    view.applyDoc(doc);
    net.send({ t: 'doc', doc });
  }

  function reset() {
    history.push(cloneDoc(doc));
    doc = initialDoc();
    view.applyDoc(doc);
    net.send({ t: 'doc', doc });
    toast('Model reset');
  }
}
