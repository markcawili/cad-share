// Three.js view of the shared document. Both roles use this same view, so
// what the expert sees matches what the customer sees.
//
// Nothing jumps: pieces, the model and the camera glide toward the latest
// document state every frame. A selected piece turns translucent ("ghosted")
// and a dashed outline stays where it was when selected, so you can see both
// where it came from and where it's going.
import * as THREE from 'three';
import { PIECES } from './model.js';

const TARGET = new THREE.Vector3(0, 1.2, 0);
const VIEW_DIR = new THREE.Vector3(0.55, 0.45, 0.7).normalize(); // camera direction at zero tilt
// Tilt turns the camera around this screen-horizontal axis, so it can go fully over the top.
const TILT_AXIS = new THREE.Vector3(VIEW_DIR.z, 0, -VIEW_DIR.x).normalize();

const SELECT_COLOR = new THREE.Color(0x3b82f6); // customer selection: blue
const HIGHLIGHT_COLOR = new THREE.Color(0xf59e0b); // expert highlight: amber
const CONFIRM_COLOR = new THREE.Color(0x22c55e); // confirmed placement: green
const EDGE_COLOR = new THREE.Color(0x334155);

const GLIDE_RATE = 12; // higher = snappier transitions
const GHOSTED_OPACITY = 0.55;

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class SceneView {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf1f5f9);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a0, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(5, 10, 7);
    this.scene.add(sun);
    this.scene.add(new THREE.GridHelper(20, 40, 0x94a3b8, 0xdbe3ec));

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.meshes = {};
    for (const p of PIECES) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...p.size),
        new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.75, transparent: true }),
      );
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: EDGE_COLOR }),
      );
      mesh.add(edges);
      mesh.userData = { pieceId: p.id, edges, target: null, kick: 0, flash: 0 };
      this.modelGroup.add(mesh);
      this.meshes[p.id] = mesh;
    }

    // Dashed outline marking where the selected piece was when it was selected.
    this.ghost = new THREE.Group();
    this.ghostFill = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    this.ghostEdges = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: SELECT_COLOR, dashSize: 0.15, gapSize: 0.1, transparent: true }),
    );
    this.ghost.add(this.ghostFill, this.ghostEdges);
    this.ghost.visible = false;
    this.modelGroup.add(this.ghost);
    this.ghostOrigin = null; // { pos, rotY } of the selected piece at selection time

    this.selectedId = null;
    this.highlightedId = null;
    this.target = null; // latest document state to glide toward
    this.view = null; // current (animated) model transform, zoom and tilt
    this.onSelect = null; // called with the piece id when a new piece becomes selected
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.render(t));
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // [x, z] world direction pointing to the right of the screen, flattened onto the ground.
  // Tilting turns around this same axis, so it never changes.
  screenRight() {
    return [TILT_AXIS.x, TILT_AXIS.z];
  }

  applyDoc(doc) {
    const first = !this.target;
    this.target = doc;
    for (const [id, p] of Object.entries(doc.pieces)) {
      this.meshes[id].userData.target = p;
      if (first) {
        this.meshes[id].position.set(...p.pos);
        this.meshes[id].rotation.y = p.rotY;
      }
    }
    if (first) {
      this.view = { pos: new THREE.Vector3(...doc.model.pos), rotY: doc.model.rotY, zoom: doc.zoom, tilt: doc.tilt ?? 0 };
    }

    if (doc.selectedId !== this.selectedId) {
      this.selectedId = doc.selectedId;
      this.showGhostFor(doc.selectedId);
      if (doc.selectedId) {
        this.meshes[doc.selectedId].userData.kick = 1;
        this.onSelect?.(doc.selectedId);
      }
    }
  }

  setHighlight(id) {
    if (id && id !== this.highlightedId) this.meshes[id].userData.kick = 1;
    this.highlightedId = id;
  }

  /** Brief green glow on a piece (or the whole model) after a confirmed placement. */
  flashConfirm(id) {
    const ids = id ? [id] : Object.keys(this.meshes);
    for (const i of ids) this.meshes[i].userData.flash = 1;
  }

  showGhostFor(id) {
    if (!id) {
      this.ghost.visible = false;
      this.ghostOrigin = null;
      return;
    }
    const p = this.target.pieces[id];
    const size = PIECES.find((piece) => piece.id === id).size;
    this.ghostOrigin = { pos: [...p.pos], rotY: p.rotY };
    this.ghostFill.scale.set(...size);
    this.ghostEdges.geometry.dispose();
    this.ghostEdges.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(...size));
    this.ghostEdges.computeLineDistances();
    this.ghost.position.set(...p.pos);
    this.ghost.rotation.y = p.rotY;
  }

  /** Piece id under a point given in 0..1 canvas coordinates, or null. */
  pick(nx, ny) {
    this.raycaster.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), this.camera);
    const hit = this.raycaster.intersectObjects(Object.values(this.meshes), false)[0];
    return hit ? hit.object.userData.pieceId : null;
  }

  placeCamera() {
    const turn = new THREE.Quaternion().setFromAxisAngle(TILT_AXIS, -this.view.tilt);
    this.camera.position.copy(TARGET).addScaledVector(VIEW_DIR.clone().applyQuaternion(turn), this.view.zoom);
    this.camera.up.set(0, 1, 0).applyQuaternion(turn); // keeps the view upright going over the top
    this.camera.lookAt(TARGET);
  }

  render(time) {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.target) this.animate(dt, time);
    this.renderer.render(this.scene, this.camera);
  }

  animate(dt, time) {
    const k = 1 - Math.exp(-GLIDE_RATE * dt); // frame-rate independent easing
    const t = this.target;
    const v = this.view;

    v.pos.lerp(new THREE.Vector3(...t.model.pos), k);
    v.rotY += angleDiff(t.model.rotY, v.rotY) * k;
    v.zoom += (t.zoom - v.zoom) * k;
    v.tilt += angleDiff(t.tilt ?? 0, v.tilt) * k;
    this.modelGroup.position.copy(v.pos);
    this.modelGroup.rotation.y = v.rotY;
    this.placeCamera();

    const pulse = 0.5 + 0.5 * Math.sin(time / 220);
    for (const [id, mesh] of Object.entries(this.meshes)) {
      const d = mesh.userData;
      mesh.position.lerp(new THREE.Vector3(...d.target.pos), k);
      mesh.rotation.y += angleDiff(d.target.rotY, mesh.rotation.y) * k;

      // Small "pop" when a piece is picked.
      d.kick = Math.max(0, d.kick - dt * 4);
      mesh.scale.setScalar(1 + 0.06 * Math.sin(d.kick * Math.PI));
      d.flash = Math.max(0, d.flash - dt * 1.5);

      const mat = mesh.material;
      const edges = d.edges.material;
      const selected = id === this.selectedId;
      const highlighted = id === this.highlightedId;
      mat.opacity += ((selected ? GHOSTED_OPACITY : 1) - mat.opacity) * k;
      mat.depthWrite = mat.opacity > 0.95;

      if (selected) {
        mat.emissive.copy(SELECT_COLOR).multiplyScalar(0.25 + 0.15 * pulse);
        edges.color.copy(SELECT_COLOR);
      } else if (highlighted) {
        mat.emissive.copy(HIGHLIGHT_COLOR).multiplyScalar(0.2 + 0.35 * pulse);
        edges.color.copy(HIGHLIGHT_COLOR);
      } else {
        mat.emissive.setRGB(0, 0, 0);
        edges.color.copy(EDGE_COLOR);
      }
      if (d.flash > 0) mat.emissive.lerp(CONFIRM_COLOR, d.flash * 0.8);
    }

    // Show the "where it was" outline only once the selected piece has moved away from it.
    if (this.ghostOrigin && this.selectedId) {
      const now = t.pieces[this.selectedId];
      const o = this.ghostOrigin;
      const moved = Math.hypot(now.pos[0] - o.pos[0], now.pos[1] - o.pos[1], now.pos[2] - o.pos[2]) > 0.01 ||
        Math.abs(angleDiff(now.rotY, o.rotY)) > 0.01;
      this.ghost.visible = moved;
      this.ghostEdges.material.opacity = 0.45 + 0.35 * pulse;
    }
  }
}
