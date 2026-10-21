// Pure edits on the shared document. Each returns a new doc; nothing here
// touches Three.js or the network, so it is easy to test.
import { MOVE_STEP, ZOOM_MIN, ZOOM_MAX, cloneDoc } from './model.js';

const ROTATE_SNAP = Math.PI / 12; // 15 degrees

// Rotate an [x, z] vector around the vertical axis (Three.js rotation.y convention).
function rotateXZ([x, z], angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c + z * s, -x * s + z * c];
}

// What a gesture acts on: the selected piece, or the whole model when nothing is selected.
function target(doc) {
  return doc.selectedId ? doc.pieces[doc.selectedId] : doc.model;
}

/**
 * Move the target one step. Left/right follow the screen, then snap to the
 * nearest grid axis of the space being moved in, so walls stay aligned.
 * @param screenRight [x, z] world direction that points to the right of the screen
 */
export function move(doc, direction, screenRight) {
  const next = cloneDoc(doc);
  const t = target(next);
  if (direction === 'up' || direction === 'down') {
    t.pos[1] += direction === 'up' ? MOVE_STEP : -MOVE_STEP;
    return next;
  }
  const sign = direction === 'right' ? 1 : -1;
  let [dx, dz] = [screenRight[0] * sign, screenRight[1] * sign];
  // Pieces live inside the (possibly rotated) model group: convert to its local space.
  if (next.selectedId) [dx, dz] = rotateXZ([dx, dz], -next.model.rotY);
  if (Math.abs(dx) >= Math.abs(dz)) t.pos[0] += Math.sign(dx) * MOVE_STEP;
  else t.pos[2] += Math.sign(dz) * MOVE_STEP;
  return next;
}

export function rotate(doc, deltaRad) {
  const next = cloneDoc(doc);
  target(next).rotY += deltaRad;
  return next;
}

// Snap the target's rotation to the nearest 15 degrees (used when a rotate gesture ends).
export function snapRotation(doc) {
  const next = cloneDoc(doc);
  const t = target(next);
  t.rotY = Math.round(t.rotY / ROTATE_SNAP) * ROTATE_SNAP;
  return next;
}

// Middle-mouse orbit for the expert: always turns the whole model.
export function rotateModel(doc, deltaRad) {
  const next = cloneDoc(doc);
  next.model.rotY += deltaRad;
  return next;
}

// Middle-mouse tilt for the expert: turns the camera up or over the model, a full 360°.
export function tiltView(doc, deltaRad) {
  const next = cloneDoc(doc);
  const t = (next.tilt ?? 0) + deltaRad;
  next.tilt = Math.atan2(Math.sin(t), Math.cos(t)); // keep within -π..π
  return next;
}

// factor > 1 zooms in (camera moves closer).
export function zoom(doc, factor) {
  const next = cloneDoc(doc);
  next.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next.zoom / factor));
  return next;
}

export function select(doc, id) {
  const next = cloneDoc(doc);
  next.selectedId = id;
  return next;
}
