// The shared document: everything both participants must see identically.
// Positions are in metres. Piece positions are relative to the model group.

export const MOVE_STEP = 0.5; // distance one swipe moves something
export const ZOOM_MIN = 4;
export const ZOOM_MAX = 25;

// Hardcoded template: a floor, four walls and a roof.
// size = [width, height, depth] of each box.
export const PIECES = [
  { id: 'floor', type: 'floor', label: 'Floor', size: [4, 0.2, 4], color: 0x8d6e63 },
  { id: 'wall-front', type: 'wall', label: 'Front wall', size: [4, 2, 0.2], color: 0xd7ccc8 },
  { id: 'wall-back', type: 'wall', label: 'Back wall', size: [4, 2, 0.2], color: 0xd7ccc8 },
  { id: 'wall-left', type: 'wall', label: 'Left wall', size: [0.2, 2, 3.6], color: 0xbcaaa4 },
  { id: 'wall-right', type: 'wall', label: 'Right wall', size: [0.2, 2, 3.6], color: 0xbcaaa4 },
  { id: 'roof', type: 'roof', label: 'Roof', size: [4.6, 0.3, 4.6], color: 0xb71c1c },
];

export function initialDoc() {
  return {
    pieces: {
      'floor': { pos: [0, 0.1, 0], rotY: 0 },
      'wall-front': { pos: [0, 1.2, 1.9], rotY: 0 },
      'wall-back': { pos: [0, 1.2, -1.9], rotY: 0 },
      'wall-left': { pos: [-1.9, 1.2, 0], rotY: 0 },
      'wall-right': { pos: [1.9, 1.2, 0], rotY: 0 },
      'roof': { pos: [0, 2.35, 0], rotY: 0 },
    },
    model: { pos: [0, 0, 0], rotY: 0 },
    zoom: 13, // camera distance from the target
    selectedId: null,
  };
}

export const cloneDoc = (doc) => JSON.parse(JSON.stringify(doc));

export function pieceLabel(id) {
  return PIECES.find((p) => p.id === id)?.label ?? 'Model';
}
