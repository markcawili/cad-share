// Three.js view of the shared document. Both roles use this same view, so
// what the expert sees matches what the novice sees.
import * as THREE from 'three';
import { PIECES } from './model.js';

const TARGET = new THREE.Vector3(0, 1.2, 0);
const VIEW_DIR = new THREE.Vector3(0.55, 0.45, 0.7).normalize(); // camera sits along this from the target

const SELECT_COLOR = new THREE.Color(0x2196f3); // novice selection: blue
const HIGHLIGHT_COLOR = new THREE.Color(0xffc107); // expert highlight: amber

export class SceneView {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeef2f5);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(5, 10, 7);
    this.scene.add(sun);
    const grid = new THREE.GridHelper(20, 40, 0x9aa5b1, 0xcfd8dc);
    this.scene.add(grid);

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.meshes = {};
    for (const p of PIECES) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...p.size),
        new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.8 }),
      );
      mesh.userData.pieceId = p.id;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: 0x333333 }),
      );
      mesh.add(edges);
      mesh.userData.edges = edges;
      this.modelGroup.add(mesh);
      this.meshes[p.id] = mesh;
    }

    this.selectedId = null;
    this.highlightedId = null;
    this.raycaster = new THREE.Raycaster();

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
  screenRight() {
    return [VIEW_DIR.z, -VIEW_DIR.x].map((v) => v / Math.hypot(VIEW_DIR.z, VIEW_DIR.x));
  }

  applyDoc(doc) {
    this.modelGroup.position.set(...doc.model.pos);
    this.modelGroup.rotation.y = doc.model.rotY;
    for (const [id, p] of Object.entries(doc.pieces)) {
      const mesh = this.meshes[id];
      mesh.position.set(...p.pos);
      mesh.rotation.y = p.rotY;
    }
    this.targetZoom = doc.zoom;
    this.zoom ??= doc.zoom;
    this.placeCamera();
    this.selectedId = doc.selectedId;
  }

  placeCamera() {
    this.camera.position.copy(TARGET).addScaledVector(VIEW_DIR, this.zoom);
    this.camera.lookAt(TARGET);
  }

  setHighlight(id) {
    this.highlightedId = id;
  }

  /** Piece id under a point given in 0..1 canvas coordinates, or null. */
  pick(nx, ny) {
    this.raycaster.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), this.camera);
    const hit = this.raycaster.intersectObjects(Object.values(this.meshes), false)[0];
    return hit ? hit.object.userData.pieceId : null;
  }

  render(time) {
    // Ease the camera toward the shared zoom so zoom changes glide instead of jumping.
    if (Math.abs(this.targetZoom - this.zoom) > 0.001) {
      this.zoom += (this.targetZoom - this.zoom) * 0.25;
      this.placeCamera();
    }
    const pulse = 0.35 + 0.25 * Math.sin(time / 200);
    for (const [id, mesh] of Object.entries(this.meshes)) {
      const mat = mesh.material;
      const edges = mesh.userData.edges.material;
      if (id === this.highlightedId) {
        mat.emissive.copy(HIGHLIGHT_COLOR).multiplyScalar(pulse);
        edges.color.copy(HIGHLIGHT_COLOR);
      } else if (id === this.selectedId) {
        mat.emissive.copy(SELECT_COLOR).multiplyScalar(0.45);
        edges.color.copy(SELECT_COLOR);
      } else {
        mat.emissive.setRGB(0, 0, 0);
        edges.color.setHex(0x333333);
      }
      // A piece that is both highlighted and selected gets the blue outline.
      if (id === this.highlightedId && id === this.selectedId) edges.color.copy(SELECT_COLOR);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
