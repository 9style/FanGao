import test from 'node:test';
import assert from 'node:assert/strict';
import { isPhonePortrait, isNarrowLayout } from '../src/device.js';

test('without pointer media support, detection falls back to viewport width only', () => {
  assert.equal(isPhonePortrait(390, 844), false);
  assert.equal(isNarrowLayout(390, 844), true);
  assert.equal(isNarrowLayout(1440, 900), false);
  assert.equal(isNarrowLayout(980, 1716), false);
});

test('touch portrait phones are detected even with a 980px desktop layout viewport', () => {
  const original = globalThis.matchMedia;
  globalThis.matchMedia = query => ({ matches: query === '(pointer: coarse)' });
  try {
    assert.equal(isPhonePortrait(980, 1716), true);
    assert.equal(isNarrowLayout(980, 1716), true);
    assert.equal(isPhonePortrait(400, 700), true);
    // 触屏横屏不算手机竖屏形态
    assert.equal(isPhonePortrait(1716, 980), false);
  } finally {
    globalThis.matchMedia = original;
  }
});

test('touch devices in landscape keep the regular layout', () => {
  const original = globalThis.matchMedia;
  globalThis.matchMedia = query => ({ matches: query === '(pointer: coarse)' });
  try {
    assert.equal(isPhonePortrait(980, 500), false);
    assert.equal(isNarrowLayout(980, 500), false);
  } finally {
    globalThis.matchMedia = original;
  }
});
