import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPaletteCycle,
  samplePaletteCycle,
  jumpPaletteCycle,
  PALETTE_HOLD_SECONDS,
  PALETTE_FADE_SECONDS,
} from '../src/palette-cycle.js';

const HOLD = 2;
const FADE = 1;
const sample = (cycle, elapsed) => samplePaletteCycle(cycle, elapsed, HOLD, FADE);

test('cycle holds the starry palette before the first fade', () => {
  const cycle = createPaletteCycle(0);
  assert.equal(sample(cycle, 0), 0);
  assert.equal(sample(cycle, HOLD / 2), 0);
  assert.equal(sample(cycle, HOLD), 0);
});

test('cycle fades smoothly to neon, holds it, then fades back', () => {
  const cycle = createPaletteCycle(0);
  const midFade = sample(cycle, HOLD + FADE / 2);
  assert.ok(midFade > 0 && midFade < 1);
  assert.equal(Math.round(midFade * 1000) / 1000, 0.5); // smoothstep(0.5)
  assert.equal(sample(cycle, HOLD + FADE), 1);
  assert.equal(sample(cycle, HOLD + FADE + HOLD / 2), 1);
  // 完整周期结束回到星夜
  assert.equal(sample(cycle, 2 * (HOLD + FADE)), 0);
});

test('blend stays within [0, 1] across a dense time sweep', () => {
  const cycle = createPaletteCycle(0);
  for (let t = 0; t <= 4 * (HOLD + FADE); t += 0.07) {
    const value = sample(cycle, t);
    assert.ok(value >= 0 && value <= 1, `out of range at t=${t}: ${value}`);
  }
});

test('a late epoch keeps the same phase relative to its start', () => {
  const cycle = createPaletteCycle(100);
  assert.equal(sample(cycle, 100 + HOLD / 2), 0);
  assert.equal(sample(cycle, 100 + HOLD + FADE), 1);
});

test('manual jump starts a fade toward the target with no visual jump', () => {
  const cycle = createPaletteCycle(0);
  const jumped = jumpPaletteCycle(cycle, 1, 1, HOLD, FADE); // 初始停留段内手动切到霓虹
  assert.equal(sample(jumped, 1), sample(cycle, 1)); // 点击瞬间混合值不变
  assert.equal(sample(jumped, 1 + FADE), 1); // 淡入结束到达霓虹
  assert.equal(sample(jumped, 1 + FADE + HOLD / 2), 1); // 完整停留
  assert.equal(sample(jumped, 1 + 2 * FADE + HOLD), 0); // 随后自动回到星夜
});

test('jumping back to starry while neon is held fades the other direction', () => {
  const cycle = createPaletteCycle(0);
  const neonAt = HOLD + FADE + 1;
  const jumped = jumpPaletteCycle(cycle, neonAt, 0, HOLD, FADE);
  assert.equal(sample(jumped, neonAt), 1);
  assert.equal(sample(jumped, neonAt + FADE), 0);
  assert.equal(sample(jumped, neonAt + FADE + HOLD), 0);
});

test('default timing constants are positive and give a slow ambient cadence', () => {
  assert.ok(PALETTE_HOLD_SECONDS >= 4);
  assert.ok(PALETTE_FADE_SECONDS >= 1);
  assert.ok(PALETTE_HOLD_SECONDS > PALETTE_FADE_SECONDS);
});
