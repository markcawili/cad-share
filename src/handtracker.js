// Webcam + MediaPipe Gesture Recognizer, with start/stop so the customer can
// turn the camera off when they're not adjusting the model.
// Calls onFrame(landmarks, category, time) for every new video frame;
// landmarks is null when no hand is visible or the camera is off.
import { FilesetResolver, GestureRecognizer, DrawingUtils } from '@mediapipe/tasks-vision';

// Keep the WASM version in step with @mediapipe/tasks-vision in package.json.
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

async function createRecognizer() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numHands: 1,
  });
  try {
    return await GestureRecognizer.createFromOptions(fileset, options('GPU'));
  } catch {
    return GestureRecognizer.createFromOptions(fileset, options('CPU'));
  }
}

export class HandTracker {
  constructor(video, overlay, onFrame) {
    this.video = video;
    this.overlay = overlay;
    this.onFrame = onFrame;
    this.recognizer = null;
    this.stream = null;
    this.frame = 0;
  }

  get running() {
    return !!this.stream;
  }

  async start() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    try {
      this.video.srcObject = this.stream;
      await this.video.play();
      this.recognizer ??= await createRecognizer(); // loaded once, reused after a restart
    } catch (err) {
      this.stop();
      throw err;
    }
    if (!this.stream) return; // turned off while the model was loading
    this.loop();
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.overlay.getContext('2d').clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.onFrame(null, 'None', performance.now());
  }

  loop() {
    const ctx = this.overlay.getContext('2d');
    const draw = new DrawingUtils(ctx);
    let lastVideoTime = -1;

    const tick = () => {
      if (!this.stream) return;
      const { video, overlay } = this;
      if (video.currentTime !== lastVideoTime && video.videoWidth) {
        lastVideoTime = video.currentTime;
        const now = performance.now();
        const result = this.recognizer.recognizeForVideo(video, now);
        const landmarks = result.landmarks[0] ?? null;
        const category = result.gestures[0]?.[0]?.categoryName ?? 'None';

        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        if (landmarks) {
          draw.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: '#00e5ff', lineWidth: 3 });
          draw.drawLandmarks(landmarks, { color: '#ff4081', radius: 3 });
        }
        this.onFrame(landmarks, category, now);
      }
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }
}
