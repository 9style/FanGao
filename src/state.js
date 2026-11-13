import { clamp } from './math.js';

export function createState(reducedMotion = false) {
  return { flow: 65, hologram: 72, palette: 0, paletteBlend: 0, paused: reducedMotion };
}

export function updateSetting(state, key, value) {
  if (key === 'flow' || key === 'hologram') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) state[key] = clamp(numeric, 0, 100);
  } else if (key === 'palette') {
    state.palette = value === 1 ? 1 : 0;
  } else if (key === 'paused') {
    state.paused = Boolean(value);
  }
  return state;
}

export function advanceClock(clock, now, active) {
  if (clock.last !== null && active) {
    clock.elapsed += clamp((now - clock.last) / 1000, 0, 0.05);
  }
  clock.last = now;
  return clock.elapsed;
}

export function pointerToScene(positionX, positionY, width, height) {
  if (width <= 0 || height <= 0) return [0, 0];
  return [(positionX / width * 2 - 1) * width / height, 1 - positionY / height * 2];
}
