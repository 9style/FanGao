import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  ({ chromium } = require('../.cache/playwright/package'));
}
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const baseURL = process.env.TEST_URL || 'http://127.0.0.1:5173';
await mkdir('artifacts', { recursive: true });

async function viewState(page) {
  return page.locator('#artwork').evaluate(canvas => new Promise(resolve => requestAnimationFrame(() => resolve({
    yaw: Number(canvas.dataset.yaw),
    pitch: Number(canvas.dataset.pitch),
    distance: Number(canvas.dataset.distance),
    pan: [Number(canvas.dataset.panX), Number(canvas.dataset.panY), Number(canvas.dataset.panZ)],
    eye: JSON.parse(canvas.dataset.eye),
    ripples: Number(canvas.dataset.ripples),
  }))));
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(baseURL);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await page.locator('#pause').click();
  const time = await page.locator('#artwork').getAttribute('data-time');
  const initialEye = (await viewState(page)).eye;
  await page.mouse.move(900, 420);
  await page.mouse.down();
  await page.mouse.move(908, 420);
  await page.mouse.up();
  let current = await viewState(page);
  assert.equal(await page.locator('#free-view').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.editorial').evaluate(element => getComputedStyle(element).opacity), '1', 'Ordinary dragging must not hide the title.');
  assert.ok(Math.hypot(...current.eye.map((value, axis) => value - initialEye[axis])) < 0.6, 'A small first drag must not reframe the camera.');
  assert.equal(current.ripples, 0);
  await page.screenshot({ path: 'artifacts/view-first-drag.png' });
  await page.locator('#view-home').click();
  await page.mouse.move(220, 420);
  await page.mouse.down();
  await page.mouse.move(1220, 540, { steps: 10 });
  await page.mouse.up();
  current = await viewState(page);
  assert.ok(current.yaw > Math.PI, 'Orbit is no longer limited to a small yaw.');
  assert.ok(current.pitch > 0.2, 'Vertical drag changes the orbit elevation.');
  assert.equal(current.ripples, 0, 'A drag must not also emit a ripple.');
  assert.equal(await page.locator('#artwork').getAttribute('data-time'), time, 'Camera controls work while animation is paused.');
  assert.equal(await page.locator('.editorial').evaluate(element => getComputedStyle(element).opacity), '1');

  const previousDistance = current.distance;
  await page.mouse.wheel(0, -500);
  await page.waitForFunction(distance => Number(document.querySelector('#artwork').dataset.distance) < distance, previousDistance);
  current = await viewState(page);
  assert.ok(current.distance < previousDistance);
  await page.mouse.move(700, 440);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(770, 500, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  current = await viewState(page);
  assert.ok(Math.hypot(...current.pan) > 0.2);

  await page.locator('#view-side').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.editorial')).opacity === '0');
  await page.waitForFunction(() => Number(document.querySelector('#artwork').dataset.yaw) > 1.5);
  current = await viewState(page);
  assert.ok(Math.abs(current.yaw - Math.PI / 2) < 0.001);
  assert.ok(current.eye[0] > 10);
  await page.screenshot({ path: 'artifacts/view-side.png' });
  await page.locator('#view-back').click();
  current = await viewState(page);
  assert.ok(Math.abs(current.yaw - Math.PI) < 0.001);
  assert.ok(current.eye[2] < -10);
  await page.screenshot({ path: 'artifacts/view-back.png' });
  await page.locator('#view-face').click();
  current = await viewState(page);
  assert.ok(current.distance < 4 && current.eye[1] > 2);
  await page.screenshot({ path: 'artifacts/view-face.png' });

  await page.locator('#artwork').focus();
  await page.keyboard.press('ArrowUp');
  current = await viewState(page);
  assert.ok(current.pitch > 0);
  await page.keyboard.press('Shift+ArrowRight');
  current = await viewState(page);
  assert.ok(Math.hypot(...current.pan) > 0);
  await page.keyboard.press('-');
  const zoomedOut = await viewState(page);
  assert.ok(zoomedOut.distance > current.distance);
  await page.keyboard.press('Enter');
  assert.equal((await viewState(page)).ripples, 1);
  await page.locator('#flow').fill('87');
  await page.locator('#flow').dispatchEvent('input');
  await page.locator('#view-home').click();
  await page.waitForFunction(() => document.documentElement.dataset.view === 'composition');
  assert.equal(await page.locator('#flow').inputValue(), '87', 'Restoring the view must not reset the artwork settings.');
  assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
  assert.deepEqual((await viewState(page)).eye, [0, 0.26, 11.8]);
  await page.locator('#free-view').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.editorial')).opacity === '0');
  assert.equal(await page.locator('#free-view').getAttribute('aria-pressed'), 'true');
  await page.locator('#free-view').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.editorial')).opacity === '1');
  assert.deepEqual((await viewState(page)).eye, [0, 0.26, 11.8]);
  await page.locator('#view-front').click();
  await page.mouse.move(700, 420);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(760, 460, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  assert.ok(Math.hypot(...(await viewState(page)).pan) > 0);
  assert.deepEqual(errors, []);
  console.log('PASS free view: full orbit, pitch, wheel, pan, presets, paused controls, keyboard, composition restore');
  await page.close();

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  await mobile.goto(baseURL);
  await mobile.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await mobile.locator('#pause').click();
  const session = await mobile.context().newCDPSession(mobile);
  const touch = (id, horizontal, vertical) => ({ id, x: horizontal, y: vertical, radiusX: 1, radiusY: 1, force: 1 });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, 130, 400), touch(2, 240, 400)] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, 90, 430), touch(2, 285, 430)] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForFunction(() => Number(document.querySelector('#artwork').dataset.distance) < 10);
  current = await viewState(mobile);
  assert.ok(current.distance < 10);
  assert.ok(Math.hypot(...current.pan) > 0.1);
  assert.equal(current.ripples, 0, 'A two-finger gesture must not emit a tap ripple.');
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(3, 160, 410)] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(3, 260, 350)] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  current = await viewState(mobile);
  assert.ok(Math.abs(current.yaw) > 1);
  assert.ok(current.pitch < 0);
  const toolbar = await mobile.locator('.view-toolbar').boundingBox();
  assert.ok(toolbar.x >= 0 && toolbar.x + toolbar.width <= 390);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.screenshot({ path: 'artifacts/view-mobile.png' });
  console.log('PASS touch view: single-finger orbit, pinch zoom, two-finger pan, no false taps, mobile toolbar');
  await mobile.close();

  const fallback = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...parameters) {
      return type.startsWith('webgl') ? null : original.call(this, type, ...parameters);
    };
  });
  await fallback.goto(baseURL);
  await fallback.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.equal(await fallback.locator('#artwork').getAttribute('data-engine'), 'canvas2d');
  assert.equal(await fallback.locator('#view-side').isDisabled(), true);
  assert.equal(await fallback.locator('#view-back').isDisabled(), true);
  await fallback.locator('#pause').click();
  await fallback.mouse.move(600, 350);
  await fallback.mouse.wheel(0, -350);
  await fallback.waitForFunction(() => Number(document.querySelector('#artwork').dataset.distance) < 10);
  await fallback.mouse.down();
  await fallback.mouse.move(660, 390, { steps: 4 });
  await fallback.mouse.up();
  assert.ok(Math.hypot(...(await viewState(fallback)).pan) > 0);
  assert.equal((await viewState(fallback)).yaw, 0, 'The 2D fallback must not pretend to rotate in 3D.');
  await fallback.locator('#view-home').click();
  await fallback.waitForFunction(() => document.documentElement.dataset.view === 'composition');
  await fallback.screenshot({ path: 'artifacts/view-fallback.png' });
  console.log('PASS 2D view: zoom and pan remain available, 3D-only views disabled');
  await fallback.close();
} finally {
  await browser.close();
}
