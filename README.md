# CAD Share: gesture-driven remote model review (MVP)

An expert shares a 3D model with a customer (novice) through an invite link.
Both see the same model in real time. The expert clicks pieces to highlight
them; the customer moves, rotates, zooms and confirms with hand gestures
tracked through their webcam.

- **3D:** Three.js
- **Hand tracking:** MediaPipe Gesture Recognizer (`@mediapipe/tasks-vision`)
- **Sync:** PeerJS (WebRTC, peer-to-peer; the free PeerJS cloud server only introduces the two browsers)
- **Build:** Vite, plain JavaScript

## Run it locally

Requires Node 18+.

```bash
npm install
npm run dev
```

1. Open http://localhost:5173 in Chrome and click **Start a session as the expert**.
2. Click **Copy invite link** and open it in a second Chrome window (this is the customer).
3. Allow camera access in the customer window.

Voice is not built in: talk over Zoom or Discord while using the app.

## Use it on two computers

Browsers only allow the webcam on `https://` or `localhost`, so for two
machines put the built site on any HTTPS static host:

```bash
npm run build
```

Upload the `dist/` folder to GitHub Pages, Netlify (drag-and-drop `dist/` at app.netlify.com/drop) or similar. The expert opens the hosted URL and sends the invite link to the customer.

## Gestures (customer)

Each action uses its own hand shape, so the tracker can't mix them up.

| Gesture | Action | Keyboard fallback |
|---|---|---|
| 👉 Point (index finger only), hold still ~0.8 s | Select the piece under the cursor (pointing at empty space deselects) | Click |
| ✋ Open hand, swipe left / right / up / down | Move one step (0.5 m) in that direction | ← → ↑ ↓ |
| ✊ Closed fist, hold ~0.3 s, then turn it like a dial | Rotate; snaps to 15° when you release | Q / E |
| 👌 OK sign (thumb + index touching, other three fingers up), then spread / close thumb and index | Zoom in / out. Drop the three fingers to stop zooming | + / − |
| 👍 Thumbs up, hold ~0.6 s | Confirm placement (deselects and notifies the expert). A hand passes through a fist on the way to a thumbs-up, so any rotation made just before it is undone | Enter |

If a piece is selected, gestures act on that piece; otherwise they act on the
whole model. After a swipe, bring your hand back slowly: the opposite
direction is ignored for about a second so the return stroke doesn't undo it.

**Camera on/off:** the button above the camera preview (or the <kbd>C</kbd> key)
turns the camera off so you can rest your hands without moving anything. The
expert sees "Camera off".

**Tuning:** all thresholds are in `CONFIG` at the top of `src/gestures.js`.
Swipe distances are measured in hand-lengths, so they work at any distance
from the camera.

## Expert controls

- **Middle-drag** (hold the scroll wheel and drag left/right): rotate the whole model. Each drag is one Undo step.
- **Click a piece:** highlight it (amber) for the customer. Click again or click empty space to clear.
- **Undo:** steps back one customer change (a swipe or a whole fist rotation).
- **Reset model:** restores the original house.
- The customer's cursor shows in purple, and the side panel shows the gesture they're making.

## Code map

| File | What it does |
|---|---|
| `src/main.js` | Picks the role from the URL (`?room=X&role=expert` or `?room=X`) |
| `src/expert.js` | Expert UI, highlight, undo/reset; documents the message protocol |
| `src/novice.js` | Customer UI; turns gesture events into model edits |
| `src/gestures.js` | Gesture interpreter (landmarks → events). **Tuning values are in `CONFIG`** |
| `src/handtracker.js` | Webcam + MediaPipe setup |
| `src/ops.js` | Pure model edits: move, rotate, zoom, select |
| `src/model.js` | Hardcoded house template and initial state |
| `src/scene.js` | Three.js rendering, picking, highlight colours |
| `src/net.js` | PeerJS room hosting / joining |
| `test/gestures.test.js` | Synthetic-hand tests for every gesture (`npm test`) |

## Known limits

- One expert and one customer per room. A second customer is refused.
- If the expert reloads, the room code can stay reserved for about a minute; wait, then reload again.
- The house model is hardcoded in `src/model.js`.
