import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createView, orbitView, zoomView, panView, presetView,
  cameraFrame, flatCameraFrame, screenToWorld, projectToScreen,
} from '../src/camera.js';

test('orbit allows repeated full revolutions but prevents flipping over a pole', () => {
  const view = createView();
  orbitView(view, Math.PI * 5, 8);
  assert.equal(view.active, true);
  assert.equal(view.yaw, Math.PI * 5);
  assert.ok(view.pitch > 1.2 && view.pitch < Math.PI / 2);
  orbitView(view, -Math.PI * 7, -16);
  assert.equal(view.yaw, -Math.PI * 2);
  assert.ok(view.pitch < -1.2 && view.pitch > -Math.PI / 2);
});

test('zoom moves the eye and clamps both extremes without crossing the sculpture', () => {
  const view = createView();
  zoomView(view, -400);
  assert.ok(view.distance < 11.8 && view.distance > 2);
  zoomView(view, -100000);
  assert.ok(view.distance >= 2.5);
  zoomView(view, 100000);
  assert.ok(view.distance <= 24 && view.distance > 15);
  const previous = view.distance;
  zoomView(view, Number.NaN);
  assert.equal(view.distance, previous);
});

test('screen-relative panning follows the camera basis after a quarter turn', () => {
  const view = createView();
  orbitView(view, Math.PI / 2, 0);
  const frame = cameraFrame(view, 1000, 1000);
  panView(view, 100, 0, 1000, frame);
  assert.ok(Math.abs(view.pan[0]) < 0.0001);
  assert.ok(view.pan[2] > 0.5);
  panView(view, 0, 100, 1000, cameraFrame(view, 1000, 1000));
  assert.ok(view.pan[1] > 0.5);
});

test('pan bounds remain finite after extreme gestures', () => {
  const view = createView();
  panView(view, 1e8, 1e8, 1000, cameraFrame(view, 1000, 1000));
  assert.ok(view.pan.every(value => Number.isFinite(value) && Math.abs(value) <= 3));
});

test('presets select actual camera positions and face focus, not just labels', () => {
  const view = createView();
  presetView(view, 'side');
  const side = cameraFrame(view, 1400, 1000);
  assert.ok(side.eye[0] > side.target[0] + 9);
  assert.ok(Math.abs(side.eye[2] - side.target[2]) < 0.001);
  presetView(view, 'back');
  const back = cameraFrame(view, 1400, 1000);
  assert.ok(back.eye[2] < back.target[2] - 9);
  presetView(view, 'face');
  const portrait = cameraFrame(view, 1400, 1000);
  assert.ok(portrait.target[1] > 2.4);
  assert.ok(view.distance < 4);
  presetView(view, 'composition');
  assert.equal(view.active, false);
  assert.deepEqual(view.pan, [0, 0, 0]);
  assert.deepEqual(cameraFrame(view, 1400, 1000).eye, [0, 0.26, 11.8]);
});

test('screen unprojection and projection round trip at the front, side, and back', () => {
  const view = createView();
  for (const preset of ['front', 'side', 'back', 'face']) {
    presetView(view, preset);
    orbitView(view, 0, 0.35);
    const frame = cameraFrame(view, 1200, 800);
    for (const pixel of [[600, 400], [150, 200], [1000, 650]]) {
      const point = screenToWorld(...pixel, 1200, 800, frame);
      const projected = projectToScreen(point, frame);
      assert.ok(Math.abs(projected[0] * 1200 - pixel[0]) < 0.01);
      assert.ok(Math.abs((1 - projected[1]) * 800 - pixel[1]) < 0.01);
    }
  }
});

test('camera safety keeps the eye outside the expanded sculpture volume when panning at close range', () => {
  const view = createView();
  presetView(view, 'face');
  orbitView(view, Math.PI / 2, 0);
  view.pan = [-1.6, -0.7, 0];
  const frame = cameraFrame(view, 1200, 800);
  const local = frame.eye.map((value, axis) => value - (axis < 2 ? frame.offset[axis] : 0));
  const inside = local[0] > -1.05 && local[0] < 1.5
    && local[1] > -2.8 && local[1] < 2.95
    && local[2] > -0.8 && local[2] < 0.75;
  assert.equal(inside, false);
});

test('projection stays valid for small and landscape viewports', () => {
  const view = createView();
  for (const dimensions of [[390, 844], [640, 360], [0, 0]]) {
    const frame = cameraFrame(view, ...dimensions);
    assert.ok(frame.viewProjection.every(Number.isFinite));
    assert.ok(screenToWorld(0, 0, ...dimensions, frame).every(Number.isFinite));
  }
});

test('full-body presets leave the face and projection ring clear of the header and control bars', () => {
  const view = createView();
  for (const dimensions of [[1440, 1000], [390, 844]]) {
    presetView(view, 'front');
    const frame = cameraFrame(view, ...dimensions);
    const head = projectToScreen([frame.offset[0], frame.offset[1] + 2.74, 0], frame);
    const feet = projectToScreen([frame.offset[0], frame.offset[1] - 2.61, 0], frame);
    const headPixel = (1 - head[1]) * dimensions[1];
    const footPixel = (1 - feet[1]) * dimensions[1];
    assert.ok(headPixel > (dimensions[0] < 700 ? 95 : 115));
    assert.ok(footPixel < dimensions[1] - (dimensions[0] < 700 ? 265 : 250));
  }
});

test('starting an orbit inherits the existing camera without reframing the sculpture', () => {
  for (const dimensions of [[1440, 1000], [390, 844], [640, 360]]) {
    const view = createView();
    const before = cameraFrame(view, ...dimensions);
    orbitView(view, 0, 0, before);
    const after = cameraFrame(view, ...dimensions);
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(Math.abs(after.eye[axis] - before.eye[axis]) < 0.000001, 'Activation must preserve eye position.');
      assert.ok(Math.abs(after.target[axis] - before.target[axis]) < 0.000001, 'Activation must preserve look direction.');
    }
    assert.equal(view.immersive, false);
  }
});

test('a small first orbit produces a small screen movement instead of a jump to center', () => {
  const view = createView();
  const before = cameraFrame(view, 1440, 1000);
  const point = [before.offset[0], before.offset[1], 0];
  const initial = projectToScreen(point, before);
  orbitView(view, 0.002, 0.001, before);
  const result = projectToScreen(point, cameraFrame(view, 1440, 1000));
  assert.ok(Math.abs(result[0] - initial[0]) * 1440 < 3);
  assert.ok(Math.abs(result[1] - initial[1]) * 1000 < 3);
  assert.equal(view.immersive, false);
});

test('first wheel input retains the off-center orbit anchor and visible composition mode', () => {
  const view = createView();
  const before = cameraFrame(view, 1440, 1000);
  const point = [before.offset[0], before.offset[1] + view.focus[1], 0];
  const initial = projectToScreen(point, before);
  zoomView(view, -120, before);
  const result = projectToScreen(point, cameraFrame(view, 1440, 1000));
  assert.ok(Math.abs(result[0] - initial[0]) < 0.000001);
  assert.ok(Math.abs(result[1] - initial[1]) < 0.000001);
  assert.equal(view.immersive, false);
});

test('first pan moves by the gesture amount instead of switching to a centered preset', () => {
  const view = createView();
  const before = cameraFrame(view, 1440, 1000);
  const point = [before.offset[0], before.offset[1], 0];
  const initial = projectToScreen(point, before);
  panView(view, 10, 0, 1000, before);
  const result = projectToScreen(point, cameraFrame(view, 1440, 1000));
  assert.ok(Math.abs((result[0] - initial[0]) * 1440 - 10) < 0.1);
  assert.ok(Math.abs(result[1] - initial[1]) * 1000 < 0.1);
  assert.equal(view.immersive, false);
});

test('only explicit presets request an immersive centered presentation', () => {
  const view = createView();
  orbitView(view, 0.02, 0, cameraFrame(view, 1440, 1000));
  assert.equal(view.immersive, false);
  presetView(view, 'front');
  assert.equal(view.immersive, true);
  const frame = cameraFrame(view, 1440, 1000);
  assert.ok(Math.abs(projectToScreen(frame.target, frame)[0] - 0.5) < 0.000001);
  presetView(view, 'composition');
  assert.equal(view.immersive, false);
});

test('the 2D fallback preserves its affine framing when zoom and pan first activate', () => {
  const view = createView();
  const before = flatCameraFrame(view, 1440, 1000);
  zoomView(view, 0, before);
  const after = flatCameraFrame(view, 1440, 1000);
  assert.equal(after.scale, before.scale);
  assert.deepEqual(after.center, before.center);
  assert.equal(view.yaw, 0);
  assert.equal(view.pitch, 0);
  const world = screenToWorld(994, 285, 1440, 1000, after);
  const projected = projectToScreen(world, after);
  assert.ok(Math.abs(projected[0] * 1440 - 994) < 0.000001);
  assert.ok(Math.abs((1 - projected[1]) * 1000 - 285) < 0.000001);
  panView(view, 10, -5, 1000, after);
  const moved = projectToScreen(world, flatCameraFrame(view, 1440, 1000));
  assert.ok(Math.abs((moved[0] - projected[0]) * 1440 - 10) < 0.000001);
  assert.ok(Math.abs((moved[1] - projected[1]) * 1000 - 5) < 0.000001);
});
