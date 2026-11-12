import { mix } from './math.js';
import { createState, updateSetting, advanceClock } from './state.js';
import { cameraFrame, createView, flatCameraFrame, orbitView, panView, presetView, screenToWorld, zoomView } from './camera.js';
import { createOrbitControls } from './orbit-controls.js';
import { createRenderer } from './renderer.js';
import { createAmbientAudio } from './audio.js';

const canvas = document.querySelector('#artwork');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const state = createState(reducedMotion.matches);
const audio = createAmbientAudio();
const clock = { last: null, elapsed: 0 };
const view = createView();
const interaction = { pointer: [99, 99, 99], view, ripple: [0, 0, 0, -99] };
const targetPointer = [99, 99, 99];
const pauseButton = document.querySelector('#pause');
const paletteButton = document.querySelector('#palette');
const fullscreenButton = document.querySelector('#fullscreen');
const dialog = document.querySelector('#about-dialog');
let renderer;
let orbitControls;
let dirty = true;
let animationFrame;
let noticeTimeout;
let ripples = 0;

function notice(message, persistent = false) {
  clearTimeout(noticeTimeout);
  const element = document.querySelector('#notice');
  element.textContent = message;
  element.classList.add('visible');
  if (!persistent) noticeTimeout = setTimeout(() => element.classList.remove('visible'), 3500);
}

function syncControls() {
  for (const key of ['flow', 'hologram']) {
    const slider = document.querySelector(`#${key}`);
    slider.value = state[key];
    slider.style.setProperty('--fill', `${state[key]}%`);
    document.querySelector(`#${key}-value`).value = String(state[key]);
  }
  pauseButton.setAttribute('aria-pressed', String(state.paused));
  pauseButton.setAttribute('aria-label', state.paused ? '继续动画' : '暂停动画');
  pauseButton.querySelector('use').setAttribute('href', state.paused ? '#icon-play' : '#icon-pause');
  paletteButton.setAttribute('aria-pressed', String(state.palette === 1));
  paletteButton.setAttribute('aria-label', state.palette ? '切换到星夜色板' : '切换到霓虹色板');
  document.querySelector('#palette-label').innerHTML = state.palette ? '霓虹色板<span>NEON DREAM</span>' : '星夜色板<span>STARRY NIGHT</span>';
  document.querySelector('#signal-status').textContent = state.paused ? 'SIGNAL / PAUSED' : 'SIGNAL / STABLE';
  dirty = true;
}

function togglePause() {
  updateSetting(state, 'paused', !state.paused);
  syncControls();
}

function currentFrame() {
  const createFrame = renderer?.info.engine === 'canvas2d' ? flatCameraFrame : cameraFrame;
  return createFrame(view, canvas.clientWidth, canvas.clientHeight);
}

function clearPointer() {
  interaction.pointer = [99, 99, 99];
  targetPointer.fill(99);
  dirty = true;
}

function syncView() {
  document.documentElement.dataset.view = view.immersive ? 'free' : 'composition';
  document.querySelector('#free-view').setAttribute('aria-pressed', String(view.immersive));
  for (const name of ['front', 'side', 'back', 'face']) {
    document.querySelector(`#view-${name}`).setAttribute('aria-pressed', String(view.preset === name));
  }
  clearPointer();
}

function restoreView() {
  orbitControls?.cancel();
  presetView(view, 'composition');
  syncView();
}

function reset() {
  Object.assign(state, createState(reducedMotion.matches));
  restoreView();
  interaction.ripple = [0, 0, 0, -99];
  ripples = 0;
  canvas.dataset.ripples = '0';
  syncControls();
  notice('星流归位，夜色如初。');
}

function pointerPosition(point) {
  return screenToWorld(point[0], point[1], canvas.clientWidth, canvas.clientHeight, currentFrame());
}

function emitRipple(position) {
  interaction.ripple = [...position, clock.elapsed];
  canvas.dataset.ripples = String(++ripples);
  dirty = true;
}

document.querySelector('#free-view').addEventListener('click', () => {
  if (view.immersive) restoreView();
  else {
    presetView(view, 'front');
    syncView();
  }
});
for (const name of ['front', 'side', 'back', 'face']) {
  document.querySelector(`#view-${name}`).addEventListener('click', () => {
    orbitControls?.cancel();
    presetView(view, name);
    syncView();
  });
}
document.querySelector('#view-home').addEventListener('click', restoreView);

pauseButton.addEventListener('click', togglePause);
document.querySelector('#reset').addEventListener('click', reset);
for (const key of ['flow', 'hologram']) {
  document.querySelector(`#${key}`).addEventListener('input', event => {
    updateSetting(state, key, event.target.value);
    syncControls();
  });
}

paletteButton.addEventListener('click', () => {
  updateSetting(state, 'palette', state.palette ? 0 : 1);
  syncControls();
});

document.querySelector('#sound').addEventListener('click', async event => {
  const button = event.currentTarget;
  try {
    const enabled = await audio.toggle();
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? '关闭环境音' : '开启环境音');
    button.title = enabled ? '关闭环境音' : '开启环境音';
    button.querySelector('use').setAttribute('href', enabled ? '#icon-sound' : '#icon-muted');
    notice(enabled ? '夜色有了声音。' : '回到安静的星空。');
  } catch {
    notice('浏览器暂时无法开启声音，画面不受影响。');
  }
});

fullscreenButton.disabled = !document.fullscreenEnabled;
fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    notice('此浏览器暂不支持全屏。');
  }
});
document.addEventListener('fullscreenchange', () => {
  fullscreenButton.setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '进入全屏');
  fullscreenButton.title = document.fullscreenElement ? '退出全屏' : '进入全屏';
  renderer?.resize();
  dirty = true;
});

document.querySelector('#about').addEventListener('click', () => dialog.showModal());
document.querySelector('#close-about').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const bounds = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
});

document.addEventListener('keydown', event => {
  if (dialog.open || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest('button, input, textarea, select, a, [contenteditable="true"]')) return;
  if (event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat) togglePause();
  } else if (event.key.toLowerCase() === 'r') {
    if (!event.repeat) reset();
  } else if (event.target === canvas && event.key === 'Enter') {
    event.preventDefault();
    if (!event.repeat) emitRipple(currentFrame().target);
  } else if (event.target === canvas && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const horizontal = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const vertical = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    if (event.shiftKey || renderer.info.engine === 'canvas2d') panView(view, horizontal * 30, -vertical * 30, canvas.clientHeight, currentFrame());
    else orbitView(view, horizontal * 0.08, vertical * 0.08, currentFrame());
    syncView();
  } else if (event.target === canvas && ['+', '=', '-'].includes(event.key)) {
    event.preventDefault();
    zoomView(view, event.key === '-' ? 120 : -120, currentFrame());
    syncView();
  } else if (event.target === canvas && event.key === 'Home') {
    event.preventDefault();
    restoreView();
  }
});

reducedMotion.addEventListener('change', event => {
  updateSetting(state, 'paused', event.matches);
  syncControls();
});

document.addEventListener('visibilitychange', () => {
  clock.last = null;
  if (document.hidden) audio.suspend();
  else {
    audio.resume();
    dirty = true;
  }
});

window.addEventListener('resize', () => {
  renderer?.resize();
  dirty = true;
});

canvas.addEventListener('artwork-lost', () => {
  updateSetting(state, 'paused', true);
  syncControls();
  document.querySelector('#signal-status').textContent = 'SIGNAL / LOST';
  notice('投影连接中断，请刷新页面重新唤醒星空。', true);
});
canvas.addEventListener('artwork-restored', () => {
  notice('投影设备已恢复，请刷新页面重新初始化。', true);
});

function frame(now) {
  const active = !state.paused && !document.hidden;
  const time = advanceClock(clock, now, active);
  if (!document.hidden && (active || dirty)) {
    interaction.pointer = interaction.pointer.map((component, axis) => mix(component, targetPointer[axis], 0.14));
    canvas.dataset.yaw = view.yaw.toFixed(3);
    canvas.dataset.pitch = view.pitch.toFixed(3);
    canvas.dataset.distance = view.distance.toFixed(3);
    for (const [axis, name] of ['panX', 'panY', 'panZ'].entries()) canvas.dataset[name] = view.pan[axis].toFixed(3);
    renderer.render(time, interaction);
    dirty = false;
  }
  animationFrame = requestAnimationFrame(frame);
}

syncControls();
syncView();
try {
  renderer = createRenderer(canvas, state);
  orbitControls = createOrbitControls(canvas, view, {
    getFrame: currentFrame,
    canOrbit: () => renderer.info.engine === 'webgl',
    onChange: syncView,
    onLeave: clearPointer,
    onRipple: point => emitRipple(pointerPosition(point)),
    onPointer: point => {
      const position = pointerPosition(point);
      if (targetPointer[0] === 99) interaction.pointer = [...position];
      targetPointer.splice(0, 3, ...position);
      dirty = true;
    },
  });
  document.querySelector('#particle-count').textContent = renderer.info.particles.toLocaleString('en-US');
  renderer.render(0, interaction);
  document.documentElement.dataset.ready = 'true';
  animationFrame = requestAnimationFrame(frame);
  if (renderer.info.engine === 'canvas2d') {
    for (const id of ['free-view', 'view-side', 'view-back']) document.querySelector(`#${id}`).disabled = true;
    notice('轻量二维模式：支持缩放与平移，三维环绕暂不可用。', true);
  }
} catch (error) {
  document.querySelector('#loading').innerHTML = `<span>投影暂时无法启动<span>请尝试更新浏览器或开启硬件加速。</span></span>`;
  console.error(error);
}

window.addEventListener('pagehide', event => {
  cancelAnimationFrame(animationFrame);
  if (event.persisted) audio.suspend();
  else {
    orbitControls?.dispose();
    renderer?.dispose();
    audio.dispose();
  }
});

window.addEventListener('pageshow', event => {
  if (event.persisted && renderer) {
    clock.last = null;
    dirty = true;
    audio.resume();
    animationFrame = requestAnimationFrame(frame);
  }
});
