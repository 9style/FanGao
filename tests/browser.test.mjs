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

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(baseURL);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.equal(await page.locator('#artwork').getAttribute('data-engine'), 'webgl');
  await page.waitForFunction(() => Number(document.querySelector('#artwork').dataset.frames) >= 4);
  assert.ok(await page.evaluate(() => Number(document.querySelector('#artwork').dataset.particles) > 5000));
  const pixels = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
    const context = document.querySelector('#artwork').getContext('webgl2');
    const buffer = new Uint8Array(context.drawingBufferWidth * context.drawingBufferHeight * 4);
    context.readPixels(0, 0, context.drawingBufferWidth, context.drawingBufferHeight, context.RGBA, context.UNSIGNED_BYTE, buffer);
    let illuminated = 0;
    for (let offset = 0; offset < buffer.length; offset += 128) {
      if (Math.max(buffer[offset], buffer[offset + 1], buffer[offset + 2]) > 70) illuminated += 1;
    }
    resolve({ illuminated, error: context.getError() });
  })));
  assert.ok(pixels.illuminated > 300, 'The GPU must draw visible colored pixels, not just update counters.');
  assert.equal(pixels.error, 0);
  await page.screenshot({ path: 'artifacts/desktop.png' });

  await page.locator('#pause').click();
  assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
  const frozenTime = await page.locator('#artwork').getAttribute('data-time');
  await page.waitForTimeout(120);
  assert.equal(await page.locator('#artwork').getAttribute('data-time'), frozenTime);

  await page.locator('#flow').fill('90');
  await page.locator('#flow').dispatchEvent('input');
  assert.equal(await page.locator('#flow-value').textContent(), '90');
  await page.locator('#hologram').fill('40');
  await page.locator('#hologram').dispatchEvent('input');
  assert.equal(await page.locator('#hologram-value').textContent(), '40');
  await page.locator('#palette').click();
  assert.equal(await page.locator('#palette').getAttribute('aria-pressed'), 'true');
  await page.locator('#pause').click();
  await page.mouse.click(960, 450);
  assert.ok(Number(await page.locator('#artwork').getAttribute('data-ripples')) >= 1);
  await page.locator('#reset').click();
  assert.equal(await page.locator('#flow').inputValue(), '65');
  assert.equal(await page.locator('#hologram').inputValue(), '72');
  assert.equal(await page.locator('#palette').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'false');

  await page.locator('#about').click();
  assert.equal(await page.locator('#about-dialog').evaluate(dialog => dialog.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#about-dialog').evaluate(dialog => dialog.open), false);
  await page.locator('#about').focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await page.locator('#artwork').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
  await page.locator('#artwork').dispatchEvent('keydown', { key: ' ', code: 'Space', repeat: true });
  assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true', 'Holding Space must not repeatedly toggle playback.');
  await page.keyboard.press('Enter');
  assert.ok(Number(await page.locator('#artwork').getAttribute('data-ripples')) >= 1, 'Keyboard users can emit a ripple.');
  const eyeBeforeArrow = await page.locator('#artwork').evaluate(canvas => JSON.parse(canvas.dataset.eye));
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(previous => {
    const eye = JSON.parse(document.querySelector('#artwork').dataset.eye);
    return Math.hypot(...eye.map((value, axis) => value - previous[axis])) > 0.05;
  }, eyeBeforeArrow);
  await page.keyboard.press('r');
  assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'false');
  await page.locator('#sound').click();
  assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'true');
  await page.locator('#sound').click();
  assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false');
  await page.screenshot({ path: 'artifacts/desktop-interactive.png' });
  assert.deepEqual(errors, []);
  console.log('PASS desktop: WebGL, pause, sliders, palette, ripple, reset, dialog, keyboard, audio');
  await page.close();

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  });
  await mobile.goto(baseURL);
  await mobile.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await mobile.waitForFunction(() => Number(document.querySelector('#artwork').dataset.frames) >= 4);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.touchscreen.tap(210, 380);
  assert.ok(Number(await mobile.locator('#artwork').getAttribute('data-ripples')) >= 1);
  await mobile.screenshot({ path: 'artifacts/mobile.png' });
  console.log('PASS mobile: responsive layout and touch ripple');
  await mobile.close();

  const landscape = await browser.newPage({ viewport: { width: 640, height: 360 }, hasTouch: true });
  await landscape.goto(baseURL);
  await landscape.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.ok(await landscape.evaluate(() => document.querySelector('.experience').getBoundingClientRect().height <= innerHeight));
  const dock = await landscape.locator('.control-dock').boundingBox();
  assert.ok(dock.y >= 0 && dock.y + dock.height <= 360);
  await landscape.screenshot({ path: 'artifacts/landscape.png' });
  await landscape.close();
  console.log('PASS landscape: controls fit a short viewport');

  const reduced = await browser.newPage({ reducedMotion: 'reduce' });
  await reduced.goto(baseURL);
  await reduced.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.equal(await reduced.locator('#pause').getAttribute('aria-pressed'), 'true');
  console.log('PASS reduced motion: starts paused');
  await reduced.close();

  const fallback = await browser.newPage();
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...parameters) {
      if (type.startsWith('webgl')) return null;
      return original.call(this, type, ...parameters);
    };
  });
  await fallback.goto(baseURL);
  await fallback.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.equal(await fallback.locator('#artwork').getAttribute('data-engine'), 'canvas2d');
  await fallback.screenshot({ path: 'artifacts/fallback.png' });
  console.log('PASS fallback: 2D artwork instead of blank canvas');
} finally {
  await browser.close();
}
