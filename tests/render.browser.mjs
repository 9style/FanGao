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

async function openPhone(width, height, deviceScaleFactor = 1) {
  const page = await browser.newPage({
    viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor,
    reducedMotion: 'reduce',
  });
  await page.addInitScript(() => {
    globalThis.artworkPrograms = new Set();
    const original = WebGL2RenderingContext.prototype.useProgram;
    WebGL2RenderingContext.prototype.useProgram = function (program) {
      if (program && this.canvas.id === 'artwork') globalThis.artworkPrograms.add(program);
      return original.call(this, program);
    };
  });
  await page.goto(baseURL);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await page.waitForFunction(() => document.querySelector('#pause').getAttribute('aria-pressed') === 'true');
  return page;
}

async function brushMetrics(page) {
  return page.evaluate(async () => {
    const { projectToScreen } = await import('/src/camera.js');
    const { brushVertex, brushFragment } = await import('/src/shaders.js');
    const canvas = document.querySelector('#artwork');
    const sourceContext = canvas.getContext('webgl2');
    const sourceProgram = [...globalThis.artworkPrograms].find(program =>
      sourceContext.getAttribLocation(program, 'aCorner') >= 0);
    const frame = {
      viewProjection: sourceContext.getUniform(sourceProgram, sourceContext.getUniformLocation(sourceProgram, 'uViewProjection')),
    };
    const offset = sourceContext.getUniform(sourceProgram, sourceContext.getUniformLocation(sourceProgram, 'uOffset'));
    const bloomProgram = [...globalThis.artworkPrograms].find(program =>
      sourceContext.getUniformLocation(program, 'uExtract') !== null);
    const bloomDirection = sourceContext.getUniform(bloomProgram, sourceContext.getUniformLocation(bloomProgram, 'uDirection'));
    const context = document.createElement('canvas').getContext('webgl2');
    const program = context.createProgram();
    const shaders = [];
    for (const [type, source] of [[context.VERTEX_SHADER, brushVertex], [context.FRAGMENT_SHADER, brushFragment]]) {
      const shader = context.createShader(type);
      context.shaderSource(shader, source);
      context.compileShader(shader);
      if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error(context.getShaderInfoLog(shader));
      context.attachShader(program, shader);
      shaders.push(shader);
    }
    context.transformFeedbackVaryings(program, ['gl_Position'], context.INTERLEAVED_ATTRIBS);
    context.linkProgram(program);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) throw new Error(context.getProgramInfoLog(program));
    context.useProgram(program);
    for (let index = 0; index < sourceContext.getProgramParameter(sourceProgram, sourceContext.ACTIVE_UNIFORMS); index += 1) {
      const uniform = sourceContext.getActiveUniform(sourceProgram, index);
      const value = sourceContext.getUniform(sourceProgram, sourceContext.getUniformLocation(sourceProgram, uniform.name));
      const location = context.getUniformLocation(program, uniform.name);
      if (uniform.type === context.FLOAT) context.uniform1f(location, value);
      if (uniform.type === context.FLOAT_VEC2) context.uniform2fv(location, value);
      if (uniform.type === context.FLOAT_VEC3) context.uniform3fv(location, value);
      if (uniform.type === context.FLOAT_VEC4) context.uniform4fv(location, value);
      if (uniform.type === context.FLOAT_MAT4) context.uniformMatrix4fv(location, false, value);
    }
    context.uniform1f(context.getUniformLocation(program, 'uTime'), 0);
    context.uniform1f(context.getUniformLocation(program, 'uMode'), 0);
    context.uniform3f(context.getUniformLocation(program, 'uPointer'), 99, 99, 99);
    context.uniform4f(context.getUniformLocation(program, 'uRipple'), 0, 0, 0, -99);
    const vertexArray = context.createVertexArray();
    const corners = context.createBuffer();
    const output = context.createBuffer();
    const feedback = context.createTransformFeedback();
    context.bindVertexArray(vertexArray);
    context.bindBuffer(context.ARRAY_BUFFER, corners);
    context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, 0, 1, 0]), context.STATIC_DRAW);
    context.enableVertexAttribArray(0);
    context.vertexAttribPointer(0, 2, context.FLOAT, false, 0, 0);
    context.vertexAttrib3f(1, 0, 0, 0);
    context.vertexAttrib3f(2, 0, 0, 1);
    context.vertexAttrib4f(3, 0.4, 0.3, 0.2, 0);
    context.bindTransformFeedback(context.TRANSFORM_FEEDBACK, feedback);
    context.bindBuffer(context.TRANSFORM_FEEDBACK_BUFFER, output);
    context.bufferData(context.TRANSFORM_FEEDBACK_BUFFER, 32, context.STREAM_READ);
    context.bindBufferBase(context.TRANSFORM_FEEDBACK_BUFFER, 0, output);
    context.enable(context.RASTERIZER_DISCARD);
    context.beginTransformFeedback(context.POINTS);
    context.drawArrays(context.POINTS, 0, 2);
    context.endTransformFeedback();
    context.disable(context.RASTERIZER_DISCARD);
    const positions = new Float32Array(8);
    context.getBufferSubData(context.TRANSFORM_FEEDBACK_BUFFER, 0, positions);
    const error = context.getError();
    context.bindBufferBase(context.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    context.bindTransformFeedback(context.TRANSFORM_FEEDBACK, null);
    context.bindVertexArray(null);
    context.useProgram(null);
    context.deleteTransformFeedback(feedback);
    context.deleteBuffer(output);
    context.deleteBuffer(corners);
    context.deleteVertexArray(vertexArray);
    context.deleteProgram(program);
    shaders.forEach(shader => context.deleteShader(shader));
    context.getExtension('WEBGL_lose_context')?.loseContext();
    if (error) throw new Error(`Brush projection probe GL error: ${error}`);
    const top = projectToScreen([offset[0], 2.7 + offset[1], 0], frame);
    const bottom = projectToScreen([offset[0], -2.61 + offset[1], 0], frame);
    const horizontal = positions[4] / positions[7] - positions[0] / positions[3];
    const vertical = positions[5] / positions[7] - positions[1] / positions[3];
    return {
      stroke: Math.hypot(horizontal * canvas.clientWidth / canvas.clientHeight, vertical) / 2,
      figure: top[1] - bottom[1],
      bloom: Math.hypot(bloomDirection[0] * canvas.clientWidth / canvas.clientHeight, bloomDirection[1]),
      backingStore: [canvas.width, canvas.height],
    };
  });
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const width = innerWidth;
    const height = document.querySelector('#artwork').clientHeight;
    const dock = document.querySelector('.control-dock').getBoundingClientRect();
    const toolbar = document.querySelector('.view-toolbar').getBoundingClientRect();
    return {
      dockHeight: dock.height / height,
      dockWidth: dock.width / width,
      toolbarWidth: toolbar.width / width,
      brandFont: parseFloat(getComputedStyle(document.querySelector('.brand-wordmark')).fontSize) / width,
      overflow: document.documentElement.scrollWidth > width,
      toolbarClear: toolbar.bottom <= dock.top,
    };
  });
}

async function assertMobileCopy(page) {
  assert.equal(await page.locator('.controls-panel').count(), 1,
    'Mobile view and effect controls must share one panel.');
  const layout = await page.evaluate(() => {
    const bounds = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      width: innerWidth, height: document.querySelector('#artwork').clientHeight, viewportHeight: innerHeight,
      panel: bounds('.controls-panel'), toolbar: bounds('.view-toolbar'), dock: bounds('.control-dock'),
      copies: [['#artwork-title', 1], ['.english-title', 1], ['.intro', 2]].map(([selector, maxLines]) => ({
        selector, bounds: bounds(selector),
        display: getComputedStyle(document.querySelector(selector)).display,
        lineHeight: parseFloat(getComputedStyle(document.querySelector(selector)).lineHeight),
        scrollWidth: document.querySelector(selector).scrollWidth, maxLines,
      })),
      hidden: ['.editorial > .eyebrow', '.artwork-signature', '.figure-caption',
        '.specimen-label', '.specimen-rule', '.signal', '.hint-english'].map(selector => ({
        selector, display: getComputedStyle(document.querySelector(selector)).display,
      })),
    };
  });
  const overlaps = (first, second) => first.left < second.right && first.right > second.left
    && first.top < second.bottom && first.bottom > second.top;
  for (const copy of layout.copies) {
    assert.notEqual(copy.display, 'none', `Mobile ${copy.selector} must remain visible.`);
    assert.ok(copy.bounds.width > 0 && copy.bounds.height > 0);
    assert.ok(copy.bounds.left >= 0 && copy.bounds.right <= layout.width + 0.5,
      `${copy.selector} must fit within the phone width.`);
    assert.ok(copy.bounds.top >= 0 && copy.bounds.bottom <= layout.height + 0.5,
      `${copy.selector} must fit within the phone height.`);
    assert.equal(overlaps(copy.bounds, layout.toolbar), false,
      `${copy.selector} must not overlap the view toolbar.`);
    assert.equal(overlaps(copy.bounds, layout.dock), false,
      `${copy.selector} must not overlap artwork controls.`);
    assert.ok(copy.bounds.height <= copy.lineHeight * copy.maxLines + 0.5,
      `${copy.selector} must use no more than ${copy.maxLines} lines.`);
    assert.ok(copy.scrollWidth <= copy.bounds.width + 1, `${copy.selector} must not overflow horizontally.`);
  }
  for (let index = 1; index < layout.copies.length; index += 1) {
    assert.ok(layout.copies[index].bounds.top >= layout.copies[index - 1].bounds.bottom,
      'The bilingual title and introduction must have separate rows.');
  }
  assert.ok(layout.panel.left >= 0 && layout.panel.right <= layout.width + 0.5);
  assert.ok(layout.panel.top >= 0 && layout.panel.bottom <= layout.viewportHeight + 0.5);
  assert.ok(layout.toolbar.top >= layout.panel.top && layout.dock.bottom <= layout.panel.bottom);
  assert.ok(Math.abs(layout.toolbar.bottom - layout.dock.top) <= 1,
    'View and effect controls must be adjacent rows of the same panel.');
  for (const copy of layout.hidden) {
    assert.equal(copy.display, 'none', `${copy.selector} must not crowd the mobile artwork.`);
  }
  assert.ok((await page.locator('.intro').textContent()).includes('1889'));
  assert.equal((await page.locator('#artwork-title').textContent()).trim(), '让星夜，回响。');
  assert.equal((await page.locator('.english-title').textContent()).trim(), 'Somewhere between a memory and a dream.');
  assert.equal(await page.locator('.specimen-index').isVisible(), true);
  assert.equal(await page.locator('.hint-touch').isVisible(), true);
}

async function assertAboutCopy(page) {
  await page.locator('#about').click();
  const copy = page.locator('#about-dialog .about-copy');
  assert.equal(await copy.count(), 1, 'Secondary artwork copy must remain available in the about dialog.');
  assert.equal(await copy.isVisible(), true);
  const text = await copy.textContent();
  for (const phrase of ['Somewhere between', 'a memory and a dream.', 'VAN GOGH', 'HOLOGRAPHIC FUTURES',
    '她不是幻影。', '只是星光的另一种形状。']) {
    assert.ok(text.includes(phrase), `About dialog must retain "${phrase}".`);
  }
  await page.locator('#close-about').click();
}

try {
  const phone = await openPhone(390, 732);
  const errors = [];
  phone.on('pageerror', error => errors.push(error.message));
  const initial = await brushMetrics(phone);
  await phone.locator('#artwork').focus();
  for (let step = 0; step < 6; step += 1) await phone.keyboard.press('-');
  await phone.waitForFunction(() => Number(document.querySelector('#artwork').dataset.distance) > 20);
  const zoomed = await brushMetrics(phone);
  assert.ok(zoomed.figure < initial.figure * 0.65, 'The GPU projection must actually zoom out.');
  assert.ok(Math.abs(zoomed.stroke / zoomed.figure / (initial.stroke / initial.figure) - 1) < 0.03,
    'Zooming out must shrink GPU brush strokes with the figure, not pile fixed-size strokes onto a smaller body.');
  await phone.screenshot({ path: 'artifacts/render-phone-zoomed-out.png' });
  await phone.locator('#view-home').click();
  await phone.locator('#artwork').focus();
  for (let step = 0; step < 6; step += 1) await phone.keyboard.press('+');
  await phone.waitForFunction(() => Number(document.querySelector('#artwork').dataset.distance) < 7);
  const close = await brushMetrics(phone);
  assert.ok(Math.abs(close.stroke / close.figure / (initial.stroke / initial.figure) - 1) < 0.03,
    'Zooming in must preserve brush size relative to the figure.');
  await phone.locator('#view-home').click();
  await phone.waitForFunction(() => document.querySelector('#artwork').dataset.distance === '13.300');
  await assertMobileCopy(phone);
  await assertAboutCopy(phone);
  await phone.locator('#free-view').click();
  assert.equal(await phone.locator('.editorial').evaluate(element => getComputedStyle(element).opacity), '0',
    'Immersive observation must still fade the title and introduction.');
  await phone.locator('#view-home').click();
  assert.equal(await phone.locator('.editorial').evaluate(element => getComputedStyle(element).opacity), '1');
  await phone.screenshot({ path: 'artifacts/render-phone.png' });
  console.log('PASS brush zoom: real GPU strokes retain their size relative to the sculpture');

  const wide = await openPhone(980, 1840);
  const wideBrush = await brushMetrics(wide);
  assert.ok(Math.abs(wideBrush.stroke / initial.stroke - 1) < 0.01,
    'A 980px layout viewport must not change the screen-relative brush size.');
  assert.ok(Math.abs(wideBrush.bloom / initial.bloom - 1) < 0.01,
    'A 980px layout viewport must not change the screen-relative bloom radius.');
  const phoneLayout = await layoutMetrics(phone);
  const wideLayout = await layoutMetrics(wide);
  for (const name of ['dockHeight', 'dockWidth', 'toolbarWidth', 'brandFont']) {
    assert.ok(Math.abs(phoneLayout[name] / wideLayout[name] - 1) < 0.04,
      `${name} must have the same visual proportion in normal and 980px phone viewports.`);
  }
  assert.equal(phoneLayout.overflow, false);
  assert.equal(wideLayout.overflow, false);
  assert.equal(phoneLayout.toolbarClear, true);
  assert.equal(wideLayout.toolbarClear, true);
  await assertMobileCopy(wide);
  await assertAboutCopy(wide);
  await wide.screenshot({ path: 'artifacts/render-wide-phone.png' });
  await wide.close();
  console.log('PASS phone viewports: consistent particle and control proportions at 390px and 980px');

  const shortPhone = await openPhone(360, 600);
  const shortWide = await openPhone(980, 1633);
  const shortLayout = await layoutMetrics(shortPhone);
  const shortWideLayout = await layoutMetrics(shortWide);
  assert.ok(Math.abs(shortLayout.dockHeight / shortWideLayout.dockHeight - 1) < 0.04,
    'Short phones must not revert to fixed-pixel controls in only one viewport branch.');
  assert.equal(shortLayout.toolbarClear, true);
  assert.equal(shortWideLayout.toolbarClear, true);
  assert.equal(shortLayout.overflow, false);
  assert.equal(shortWideLayout.overflow, false);
  await assertMobileCopy(shortPhone);
  await assertMobileCopy(shortWide);
  await shortPhone.screenshot({ path: 'artifacts/mobile-copy-short.png' });
  await shortPhone.close();
  await shortWide.close();
  console.log('PASS short portrait: compact controls stay clear in both phone viewport branches');

  const landscape = await openPhone(667, 375);
  await assertMobileCopy(landscape);
  await landscape.screenshot({ path: 'artifacts/mobile-copy-landscape.png' });
  await landscape.locator('#flow').fill('89');
  await landscape.locator('#flow').dispatchEvent('input');
  const paletteText = await landscape.locator('#palette-label > span').boundingBox();
  await landscape.mouse.click(paletteText.x + paletteText.width - 2, paletteText.y + paletteText.height / 2);
  assert.equal(await landscape.locator('#flow').inputValue(), '89',
    'Tapping visible palette text in landscape must not hit the expanded reset target.');
  assert.equal(await landscape.locator('#palette').getAttribute('aria-pressed'), 'true');
  await landscape.close();
  console.log('PASS landscape targets: visible palette text cannot accidentally reset the artwork');

  for (const viewport of [{ width: 568, height: 320 }, { width: 568, height: 300 }, { width: 667, height: 300 },
    { width: 568, height: 260 }, { width: 568, height: 240 },
    { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    const compact = await openPhone(viewport.width, viewport.height);
    await assertMobileCopy(compact);
    await assertAboutCopy(compact);
    if (viewport.width === 320 && viewport.height === 568) {
      await compact.locator('#flow').fill('89');
      await compact.locator('#flow').dispatchEvent('input');
      await compact.locator('#hologram').fill('90');
      await compact.locator('#hologram').dispatchEvent('input');
      const slider = await compact.locator('#hologram').boundingBox();
      const touchPoint = {
        horizontal: slider.x + slider.width * 0.9 - 3, vertical: slider.y + slider.height / 2 + 2.5,
      };
      const target = await compact.evaluate(point =>
        document.elementFromPoint(point.horizontal, point.vertical)?.closest('button, input')?.id, touchPoint);
      assert.equal(target, 'hologram', 'The visible lower half of a slider thumb must not be covered by reset.');
      await compact.touchscreen.tap(touchPoint.horizontal, touchPoint.vertical);
      assert.equal(await compact.locator('#flow').inputValue(), '89',
        'Tapping the visible hologram slider must not hit the expanded reset target.');
      assert.ok(Number(await compact.locator('#hologram').inputValue()) >= 85);
    }
    await compact.screenshot({ path: `artifacts/mobile-copy-${viewport.width}x${viewport.height}.png` });
    await compact.close();
  }

  const densePhone = await openPhone(390, 732, 3);
  const denseWide = await openPhone(980, 1840, 3);
  const denseBrush = await brushMetrics(densePhone);
  const denseWideBrush = await brushMetrics(denseWide);
  assert.ok(denseBrush.backingStore[0] >= 780,
    'High-DPI phones must retain enough pixels for smooth facial details.');
  assert.ok(denseBrush.backingStore[0] <= 1024 && denseWideBrush.backingStore[0] <= 1024,
    'Phone viewports must share a bounded pixel budget rather than rendering at unrestricted DPR.');
  assert.equal(denseBrush.backingStore[0], denseWideBrush.backingStore[0],
    'Normal and 980px high-DPI phone viewports must use the same render width.');
  await densePhone.screenshot({ path: 'artifacts/render-phone-high-dpi.png', scale: 'css' });
  await densePhone.close();
  await denseWide.close();
  console.log('PASS high DPI: smooth details with a shared bounded mobile render width');

  const beforeReduction = await brushMetrics(phone);
  await phone.evaluate(() => {
    const original = performance.now.bind(performance);
    let delay = 0;
    performance.now = () => original() + (delay += 70);
  });
  await phone.locator('#pause').click();
  await phone.waitForFunction(() => Number(document.querySelector('#artwork').dataset.frames) >= 102);
  await phone.locator('#pause').click();
  const reduced = await brushMetrics(phone);
  assert.ok(reduced.backingStore[0] < beforeReduction.backingStore[0],
    'The slow-frame fixture must exercise actual adaptive resolution.');
  assert.ok(Math.abs(reduced.stroke / beforeReduction.stroke - 1) < 0.01,
    'Adaptive resolution must not enlarge the screen-relative GPU brush strokes.');
  assert.ok(Math.abs(reduced.bloom / beforeReduction.bloom - 1) < 0.01,
    'Adaptive resolution must not enlarge the screen-relative bloom radius.');
  assert.deepEqual(errors, []);
  await phone.close();
  console.log('PASS adaptive resolution: lower pixel count without thicker particle strokes');

  const fallback = await browser.newPage({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce',
  });
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...parameters) {
      return type.startsWith('webgl') ? null : original.call(this, type, ...parameters);
    };
  });
  await fallback.goto(baseURL);
  await fallback.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.equal(await fallback.locator('#artwork').getAttribute('data-engine'), 'canvas2d');
  await assertMobileCopy(fallback);
  await assertAboutCopy(fallback);
  await fallback.close();
  console.log('PASS mobile copy: Chinese title and introduction stay readable; secondary copy remains in the about dialog');

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await desktop.goto(baseURL);
  await desktop.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  for (const selector of ['.editorial > .eyebrow', '.english-title', '.intro', '.artwork-signature',
    '.figure-caption', '.specimen-label', '.signal', '.hint-english']) {
    assert.equal(await desktop.locator(selector).isVisible(), true, `${selector} must remain on the desktop artwork.`);
  }
  await desktop.close();
  console.log('PASS desktop copy: the existing full editorial layout is preserved');

  const shortDesktop = await browser.newPage({ viewport: { width: 1440, height: 480 }, reducedMotion: 'reduce' });
  await shortDesktop.goto(baseURL);
  await shortDesktop.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.equal(await shortDesktop.locator('.english-title').isVisible(), true);
  for (const selector of ['.intro', '.artwork-signature', '.figure-caption']) {
    assert.equal(await shortDesktop.locator(selector).isVisible(), false,
      'A short desktop window must keep the original compact desktop treatment, not the mobile override.');
  }
  const desktopControls = await shortDesktop.evaluate(() => ({
    toolbar: document.querySelector('.view-toolbar').getBoundingClientRect().toJSON(),
    dock: document.querySelector('.control-dock').getBoundingClientRect().toJSON(),
  }));
  assert.ok(desktopControls.toolbar.bottom < desktopControls.dock.top,
    'Desktop controls must retain their independent positioning.');
  await shortDesktop.close();
  console.log('PASS short desktop: mobile panel and copy overrides do not leak into desktop layout');
} finally {
  await browser.close();
}
