import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom, perspective, lookAt, multiplyMatrices } from '../src/math.js';
import { createState, updateSetting, advanceClock, pointerToScene } from '../src/state.js';
import { createFigure, sampleSurface } from '../src/geometry.js';

test('seeded randomness is reproducible and stays inside the unit interval', () => {
  const first = createRandom(79);
  const second = createRandom(79);
  for (let sample = 0; sample < 200; sample += 1) {
    const value = first();
    assert.equal(value, second());
    assert.ok(value >= 0 && value < 1);
  }
});

test('perspective maps the near plane to the clip boundary', () => {
  const matrix = perspective(Math.PI / 2, 2, 1, 100);
  assert.ok(Math.abs(matrix[0] - 0.5) < 0.00001);
  assert.ok(Math.abs(matrix[5] - 1) < 0.00001);
  const clipDepth = matrix[10] * -1 + matrix[14];
  assert.ok(Math.abs(clipDepth + 1) < 0.00001);
});

test('lookAt translates the camera origin to negative eye distance', () => {
  const matrix = lookAt([0, 0, 10], [0, 0, 0], [0, 1, 0]);
  assert.equal(matrix[14], -10);
  assert.equal(matrix[0], 1);
  assert.equal(matrix[5], 1);
  assert.equal(matrix[10], 1);
});

test('matrix multiplication preserves a view transform with identity', () => {
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const view = lookAt([0, 0, 10], [0, 0, 0], [0, 1, 0]);
  assert.deepEqual(multiplyMatrices(identity, view), new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -10, 1,
  ]));
});

test('settings clamp intensities and reject nonfinite input', () => {
  const state = createState(false);
  updateSetting(state, 'flow', 500);
  assert.equal(state.flow, 100);
  updateSetting(state, 'hologram', -20);
  assert.equal(state.hologram, 0);
  updateSetting(state, 'flow', Number.NaN);
  assert.equal(state.flow, 100);
  updateSetting(state, 'unknown', 12);
  assert.equal(state.unknown, undefined);
});

test('reduced motion starts with simulation paused', () => {
  assert.equal(createState(true).paused, true);
  assert.equal(createState(false).paused, false);
});

test('paused and hidden time does not cause a jump on resume', () => {
  const clock = { last: null, elapsed: 0 };
  assert.equal(advanceClock(clock, 1000, true), 0);
  assert.equal(advanceClock(clock, 1020, true), 0.02);
  assert.equal(advanceClock(clock, 90000, false), 0.02);
  assert.equal(advanceClock(clock, 90020, true), 0.04);
});

test('long frame gaps are bounded and backwards timestamps cannot rewind', () => {
  const clock = { last: 1000, elapsed: 2 };
  assert.equal(advanceClock(clock, 6000, true), 2.05);
  assert.equal(advanceClock(clock, 5900, true), 2.05);
});

test('pointer projection maps center and corners with the render aspect ratio', () => {
  assert.deepEqual(pointerToScene(500, 250, 1000, 500), [0, 0]);
  assert.deepEqual(pointerToScene(0, 0, 1000, 500), [-2, 1]);
  assert.deepEqual(pointerToScene(1000, 500, 1000, 500), [2, -1]);
  assert.deepEqual(pointerToScene(20, 10, 0, 0), [0, 0]);
});

test('the original sculpture has finite indexed geometry and a full-height silhouette', () => {
  const figure = createFigure();
  assert.ok(figure.meshes.length >= 12);
  assert.ok(figure.bounds.max[1] - figure.bounds.min[1] > 5);
  for (const mesh of figure.meshes) {
    assert.equal(mesh.positions.length % 3, 0);
    assert.equal(mesh.normals.length, mesh.positions.length);
    assert.equal(mesh.indices.length % 3, 0);
    assert.ok(mesh.positions.every(Number.isFinite));
    assert.ok(mesh.normals.every(Number.isFinite));
    assert.ok(mesh.indices.every(index => index < mesh.positions.length / 3));
  }
});

test('surface sampling is reproducible and produces normalized outward normals', () => {
  const figure = createFigure();
  const first = sampleSurface(figure.meshes, 700, 79);
  const second = sampleSurface(figure.meshes, 700, 79);
  assert.equal(first.positions.length, 2100);
  assert.deepEqual(first.positions, second.positions);
  assert.ok(first.positions.every(Number.isFinite));
  for (let offset = 0; offset < first.normals.length; offset += 3) {
    const length = Math.hypot(...first.normals.slice(offset, offset + 3));
    assert.ok(Math.abs(length - 1) < 0.0001);
  }
});

test('zero samples and empty geometry produce valid empty buffers', () => {
  assert.equal(sampleSurface([], 100, 79).positions.length, 0);
  assert.equal(sampleSurface(createFigure().meshes, 0, 79).positions.length, 0);
});
