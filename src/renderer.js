import { createRandom } from './math.js';
import { cameraFrame, createView, projectToScreen, screenToWorld } from './camera.js';
import { createFigure, sampleSurface } from './geometry.js';
import { createFallback } from './fallback.js';
import { isNarrowLayout } from './device.js';
import {
  fullscreenVertex, backgroundFragment, hologramVertex, hologramFragment,
  brushVertex, brushFragment, bloomFragment, compositeFragment,
} from './shaders.js';

const referenceHeight = 1716;
const brushWorldSize = 2 * 11.8 * Math.tan(54 * Math.PI / 360) / referenceHeight;

function createFlowParticles(count) {
  const random = createRandom(1889);
  const centers = [[-4.4, 2.5, -5], [1.0, 2.7, -5.5], [5.3, 1.5, -5], [-1.8, -0.8, -6], [5.0, -1.0, -4.5]];
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  for (let particle = 0; particle < count; particle += 1) {
    const center = centers[particle % centers.length];
    positions.set(center, particle * 3);
    normals.set([0.25 + Math.sqrt(random()) * 4.3, random() * Math.PI * 2, (random() * 0.35 + 0.15) * (particle % 2 ? 1 : -1)], particle * 3);
    seeds.set([random(), random(), random(), 0], particle * 4);
  }
  return { positions, normals, seeds };
}

function createRingParticles(count) {
  const random = createRandom(2079);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  for (let particle = 0; particle < count; particle += 1) {
    const radius = [0.88, 1.04, 1.29][particle % 3] + (random() - 0.5) * 0.018;
    normals.set([radius, random() * Math.PI * 2, 0], particle * 3);
    seeds.set([random(), random(), random(), 0], particle * 4);
  }
  return { positions, normals, seeds };
}

export function createRenderer(canvas, state) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
  if (!gl) return createFallback(canvas, state);

  const resources = [];
  const programs = [];
  let eye = [0, 0.26, 11.8];
  let width = 1;
  let height = 1;
  let bloomWidth = 1;
  let bloomHeight = 1;
  let resolutionScale = 1;
  let frameCount = 0;
  let lost = false;
  let disposed = false;
  let frameCost = 0;
  let lastFrameTime = null;
  let viewProjection;
  let frame;
  let backdropFrame;
  let offset = [1.65, 0];
  const narrow = () => isNarrowLayout();
  const lowPower = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4;
  const figure = createFigure();
  const sampleCount = narrow() || lowPower ? 11500 : 19500;
  const figureSamples = sampleSurface(figure.meshes, sampleCount, 79);
  const flowSamples = createFlowParticles(narrow() || lowPower ? 4800 : 10500);
  const ringSamples = createRingParticles(1350);
  const info = {
    engine: 'webgl',
    particles: sampleCount + flowSamples.positions.length / 3,
    meshes: figure.meshes.length,
    contextAttributes: gl.getContextAttributes(),
    firstGlError: null,
  };

  function program(vertexSource, fragmentSource) {
    const compiled = [];
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Projection shader could not compile: ${message}`);
      }
      compiled.push(shader);
    }
    const linked = gl.createProgram();
    compiled.forEach(shader => gl.attachShader(linked, shader));
    gl.linkProgram(linked);
    compiled.forEach(shader => gl.deleteShader(shader));
    if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(linked));
    const uniforms = new Map();
    programs.push(linked);
    return {
      handle: linked,
      uniform(name) {
        if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(linked, name));
        return uniforms.get(name);
      },
    };
  }

  const background = program(fullscreenVertex, backgroundFragment);
  const hologram = program(hologramVertex, hologramFragment);
  const brushes = program(brushVertex, brushFragment);
  const bloom = program(fullscreenVertex, bloomFragment);
  const composite = program(fullscreenVertex, compositeFragment);

  function buffer(data, target = gl.ARRAY_BUFFER) {
    const created = gl.createBuffer();
    resources.push(['buffer', created]);
    gl.bindBuffer(target, created);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return created;
  }

  function attribute(location, size, data, divisor = 0) {
    buffer(data);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(location, divisor);
  }

  const gpuMeshes = figure.meshes.map(mesh => {
    const vertexArray = gl.createVertexArray();
    resources.push(['vertexArray', vertexArray]);
    gl.bindVertexArray(vertexArray);
    attribute(0, 3, mesh.positions);
    attribute(1, 3, mesh.normals);
    buffer(mesh.indices, gl.ELEMENT_ARRAY_BUFFER);
    return { vertexArray, count: mesh.indices.length, kind: mesh.kind };
  });

  function particleMesh(samples) {
    const vertexArray = gl.createVertexArray();
    resources.push(['vertexArray', vertexArray]);
    gl.bindVertexArray(vertexArray);
    attribute(0, 2, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]));
    attribute(1, 3, samples.positions, 1);
    attribute(2, 3, samples.normals, 1);
    attribute(3, 4, samples.seeds, 1);
    return { vertexArray, count: samples.positions.length / 3 };
  }

  const figureParticles = particleMesh(figureSamples);
  const flowParticles = particleMesh(flowSamples);
  const ringParticles = particleMesh(ringSamples);
  gl.bindVertexArray(null);

  // 探测用最小着色器与几何：验证帧缓冲不仅"声明完整"，而且真正可清除、可绘制
  const probeProgram = program(`#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`, `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(1.0); }`);
  const probeVao = gl.createVertexArray();
  resources.push(['vertexArray', probeVao]);
  gl.bindVertexArray(probeVao);
  const probeBuffer = gl.createBuffer();
  resources.push(['buffer', probeBuffer]);
  gl.bindBuffer(gl.ARRAY_BUFFER, probeBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  function target(name, depth = false) {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    resources.push(['texture', texture], ['framebuffer', framebuffer]);
    return {
      name, texture, framebuffer, wantsDepth: depth, hasDepth: false,
      depthRenderbuffer: null, depthTexture: null,
      chosenColor: null, chosenDepth: null, attempts: [],
    };
  }

  const sceneTarget = target('scene', true);
  const firstBloom = target('bloom-a');
  const secondBloom = target('bloom-b');

  const framebufferStatusName = status => ({
    [gl.FRAMEBUFFER_COMPLETE]: 'COMPLETE',
    [gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT]: 'INCOMPLETE_ATTACHMENT',
    [gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT]: 'INCOMPLETE_MISSING_ATTACHMENT',
    [gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS]: 'INCOMPLETE_DIMENSIONS',
    [gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE]: 'INCOMPLETE_MULTISAMPLE',
    [gl.FRAMEBUFFER_UNSUPPORTED]: 'UNSUPPORTED',
  })[status] || `UNKNOWN_${status}`;

  // 个别移动 GPU 驱动（Adreno + 厂商浏览器内核）状态检查返回完整，实际 clear/draw 却报
  // INVALID_FRAMEBUFFER_OPERATION(1286)。因此同时尝试渲染缓冲、深度纹理与无深度多种组合，
  // 并以真实操作结果而非状态枚举作为选择依据。
  const hasFloatDepth = Boolean(gl.getExtension('EXT_color_buffer_float'));
  function depthModes(wantsDepth) {
    if (!wantsDepth) return [{ label: 'none' }];
    const modes = [
      { label: 'RB:DEPTH_COMPONENT16', kind: 'renderbuffer', format: gl.DEPTH_COMPONENT16, attachment: gl.DEPTH_ATTACHMENT },
      { label: 'RB:DEPTH_COMPONENT24', kind: 'renderbuffer', format: gl.DEPTH_COMPONENT24, attachment: gl.DEPTH_ATTACHMENT },
      { label: 'RB:DEPTH24_STENCIL8', kind: 'renderbuffer', format: gl.DEPTH24_STENCIL8, attachment: gl.DEPTH_STENCIL_ATTACHMENT },
    ];
    if (hasFloatDepth) {
      modes.push({ label: 'RB:DEPTH_COMPONENT32F', kind: 'renderbuffer', format: gl.DEPTH_COMPONENT32F, attachment: gl.DEPTH_ATTACHMENT });
    }
    modes.push(
      { label: 'TEX:DEPTH_COMPONENT24', kind: 'texture', format: gl.DEPTH_COMPONENT24, type: gl.UNSIGNED_INT },
      { label: 'TEX:DEPTH_COMPONENT16', kind: 'texture', format: gl.DEPTH_COMPONENT16, type: gl.UNSIGNED_SHORT },
      { label: 'none' },
    );
    return modes;
  }

  function detachDepth(renderTarget) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget.framebuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, null, 0);
  }

  function allocate(renderTarget, targetWidth, targetHeight) {
    renderTarget.attempts = [];
    const modes = depthModes(renderTarget.wantsDepth);
    for (const colorFormat of [gl.RGBA8, gl.RGBA]) {
      const colorLabel = colorFormat === gl.RGBA8 ? 'RGBA8' : 'RGBA';
      gl.bindTexture(gl.TEXTURE_2D, renderTarget.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, colorFormat, targetWidth, targetHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const mode of modes) {
        detachDepth(renderTarget);
        if (mode.kind === 'renderbuffer') {
          if (!renderTarget.depthRenderbuffer) {
            renderTarget.depthRenderbuffer = gl.createRenderbuffer();
            resources.push(['renderbuffer', renderTarget.depthRenderbuffer]);
          }
          gl.bindRenderbuffer(gl.RENDERBUFFER, renderTarget.depthRenderbuffer);
          gl.renderbufferStorage(gl.RENDERBUFFER, mode.format, targetWidth, targetHeight);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, mode.attachment, gl.RENDERBUFFER, renderTarget.depthRenderbuffer);
        } else if (mode.kind === 'texture') {
          if (!renderTarget.depthTexture) {
            renderTarget.depthTexture = gl.createTexture();
            resources.push(['texture', renderTarget.depthTexture]);
            gl.bindTexture(gl.TEXTURE_2D, renderTarget.depthTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          } else {
            gl.bindTexture(gl.TEXTURE_2D, renderTarget.depthTexture);
          }
          gl.texImage2D(gl.TEXTURE_2D, 0, mode.format, targetWidth, targetHeight, 0, gl.DEPTH_COMPONENT, mode.type, null);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, renderTarget.depthTexture, 0);
        }
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        let opError = 0;
        let probePixel = null;
        let pixelOk = false;
        if (status === gl.FRAMEBUFFER_COMPLETE) {
          // 实测可渲染性：部分驱动状态返回完整、getError 也为 0，却静默丢弃所有绘制导致整帧黑屏。
          // 因此画白色三角形后必须 readPixels 回读，确认像素真正写入才算可用组合。
          gl.viewport(0, 0, targetWidth, targetHeight);
          gl.disable(gl.BLEND);
          gl.disable(gl.DEPTH_TEST);
          gl.clearColor(0, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT | (mode.label === 'none' ? 0 : gl.DEPTH_BUFFER_BIT));
          gl.useProgram(probeProgram.handle);
          gl.bindVertexArray(probeVao);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          probePixel = new Uint8Array(4);
          gl.readPixels(
            Math.max(0, Math.floor(targetWidth / 2)),
            Math.max(0, Math.floor(targetHeight / 2)),
            1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probePixel,
          );
          opError = gl.getError();
          gl.bindVertexArray(null);
          pixelOk = opError === 0 && probePixel[0] > 200 && probePixel[1] > 200 && probePixel[2] > 200;
        }
        renderTarget.attempts.push(
          `${colorLabel}+${mode.label} => ${framebufferStatusName(status)}`
          + `${status === gl.FRAMEBUFFER_COMPLETE ? ` / opError=${opError} / px=${probePixel ? Array.from(probePixel).join(',') : 'n/a'} / ${pixelOk ? 'USABLE' : 'DEAD'}` : ''}`,
        );
        if (status === gl.FRAMEBUFFER_COMPLETE && opError === 0 && pixelOk) {
          renderTarget.hasDepth = mode.label !== 'none';
          renderTarget.chosenColor = colorLabel;
          renderTarget.chosenDepth = mode.label;
          return;
        }
      }
    }
    throw new Error(
      `Projection framebuffer "${renderTarget.name}" (${targetWidth}x${targetHeight}) has no usable configuration. Attempts: ${renderTarget.attempts.join('; ')}`,
    );
  }

  function resize() {
    if (lost || disposed) return;
    const pixelLimit = narrow() ? 980 / Math.max(1, canvas.clientWidth) : 1.5;
    const ratio = Math.min(devicePixelRatio || 1, pixelLimit) * resolutionScale;
    width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    canvas.width = width;
    canvas.height = height;
    bloomWidth = Math.max(1, Math.floor(width / 4));
    bloomHeight = Math.max(1, Math.floor(height / 4));
    try {
      allocate(sceneTarget, width, height);
      allocate(firstBloom, bloomWidth, bloomHeight);
      allocate(secondBloom, bloomWidth, bloomHeight);
    } catch (error) {
      // 个别驱动在高分辨率下拒绝帧缓冲：降低渲染分辨率后整体重试，仍失败则交给上层降级到 2D
      if (resolutionScale <= 0.3) throw error;
      resolutionScale = Math.max(0.25, resolutionScale * 0.5);
      resize();
      return;
    }
    info.framebuffers = {
      scene: { config: `${sceneTarget.chosenColor}+${sceneTarget.chosenDepth}`, attempts: sceneTarget.attempts },
      'bloom-a': { config: `${firstBloom.chosenColor}+${firstBloom.chosenDepth}`, attempts: firstBloom.attempts },
      'bloom-b': { config: `${secondBloom.chosenColor}+${secondBloom.chosenDepth}`, attempts: secondBloom.attempts },
    };
    info.backingStore = { width, height, resolutionScale };
    backdropFrame = cameraFrame(createView(), canvas.clientWidth, canvas.clientHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function scalar(activeProgram, name, value) {
    gl.uniform1f(activeProgram.uniform(name), value);
  }

  function common(activeProgram, time, interaction) {
    gl.useProgram(activeProgram.handle);
    scalar(activeProgram, 'uTime', time);
    scalar(activeProgram, 'uFlow', state.flow / 65);
    scalar(activeProgram, 'uHologram', state.hologram / 100);
    scalar(activeProgram, 'uPalette', state.paletteBlend ?? state.palette);
    scalar(activeProgram, 'uYaw', 0);
    gl.uniform2fv(activeProgram.uniform('uOffset'), offset);
    const brushProjection = brushWorldSize / Math.tan(frame.fov / 2);
    gl.uniform2fv(activeProgram.uniform('uBrushScale'), [
      brushProjection * canvas.clientHeight / canvas.clientWidth, brushProjection,
    ]);
    gl.uniform3fv(activeProgram.uniform('uPointer'), interaction.pointer);
    gl.uniform4fv(activeProgram.uniform('uRipple'), interaction.ripple);
    gl.uniformMatrix4fv(activeProgram.uniform('uViewProjection'), false, viewProjection);
  }

  function fullscreen(activeProgram, renderTarget, targetWidth, targetHeight) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget ? renderTarget.framebuffer : null);
    gl.viewport(0, 0, targetWidth, targetHeight);
    gl.useProgram(activeProgram.handle);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function texture(activeProgram, name, source, unit = 0) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(activeProgram.uniform(name), unit);
  }

  function drawParticles(mesh, mode) {
    scalar(brushes, 'uMode', mode);
    gl.bindVertexArray(mesh.vertexArray);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, mesh.count);
  }

  // 首帧分段记录 GL 错误，定位驱动具体拒绝了哪一步
  function checkpoint(stage) {
    if (frameCount !== 0) return;
    const error = gl.getError();
    if (error !== 0) {
      info.firstFrameErrors = info.firstFrameErrors || [];
      info.firstFrameErrors.push({ stage, error });
    }
  }

  function render(time, interaction) {
    if (lost || disposed) return;
    frame = cameraFrame(interaction.view, canvas.clientWidth, canvas.clientHeight);
    eye = frame.eye;
    offset = frame.offset;
    viewProjection = frame.viewProjection;
    canvas.dataset.eye = JSON.stringify(eye);
    const wallTime = performance.now();
    if (lastFrameTime !== null && !state.paused) frameCost = frameCost * 0.97 + (wallTime - lastFrameTime) * 0.03;
    lastFrameTime = wallTime;
    if (frameCount === 100 && frameCost > 38 && resolutionScale === 1) {
      resolutionScale = 0.72;
      resize();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | (sceneTarget.hasDepth ? gl.DEPTH_BUFFER_BIT : 0));
    checkpoint('scene-clear');

    common(background, time, interaction);
    scalar(background, 'uAspect', width / height);
    gl.uniform2fv(background.uniform('uFloor'), projectToScreen([offset[0], -2.61 + offset[1], 0], frame));
    const rippleScreen = projectToScreen(interaction.ripple.slice(0, 3), frame);
    gl.uniform3fv(background.uniform('uScreenRipple'), [
      (rippleScreen[0] - 0.5) * width / height * 8.8, (rippleScreen[1] - 0.5) * 8.8, interaction.ripple[3],
    ]);
    fullscreen(background, sceneTarget, width, height);
    checkpoint('background');

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    common(brushes, time, interaction);
    gl.uniformMatrix4fv(brushes.uniform('uViewProjection'), false, backdropFrame.viewProjection);
    const pointerScreen = projectToScreen(interaction.pointer, frame);
    const backdropPointer = screenToWorld(pointerScreen[0] * canvas.clientWidth, (1 - pointerScreen[1]) * canvas.clientHeight, canvas.clientWidth, canvas.clientHeight, backdropFrame);
    const backdropRipple = screenToWorld(rippleScreen[0] * canvas.clientWidth, (1 - rippleScreen[1]) * canvas.clientHeight, canvas.clientWidth, canvas.clientHeight, backdropFrame);
    gl.uniform3fv(brushes.uniform('uPointer'), interaction.pointer[0] === 99 ? [99, 99, 99] : backdropPointer);
    gl.uniform4fv(brushes.uniform('uRipple'), [...backdropRipple, interaction.ripple[3]]);
    drawParticles(flowParticles, 1);
    common(brushes, time, interaction);
    drawParticles(ringParticles, 2);
    checkpoint('backdrop-particles');

    // 无可用深度附件时跳过深度测试，全息网格按半透明混合直接绘制
    if (sceneTarget.hasDepth) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    common(hologram, time, interaction);
    gl.uniform3fv(hologram.uniform('uEye'), eye);
    for (const mesh of gpuMeshes) {
      scalar(hologram, 'uKind', mesh.kind);
      gl.bindVertexArray(mesh.vertexArray);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    }
    checkpoint('hologram-meshes');

    if (sceneTarget.hasDepth) gl.depthMask(false);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    common(brushes, time, interaction);
    drawParticles(figureParticles, 0);
    checkpoint('figure-particles');
    if (sceneTarget.hasDepth) {
      gl.depthMask(true);
      gl.disable(gl.DEPTH_TEST);
    }
    gl.disable(gl.BLEND);

    gl.useProgram(bloom.handle);
    texture(bloom, 'uTexture', sceneTarget.texture);
    gl.uniform2fv(bloom.uniform('uDirection'), [height / width / referenceHeight, 0]);
    scalar(bloom, 'uExtract', 1);
    fullscreen(bloom, firstBloom, bloomWidth, bloomHeight);
    texture(bloom, 'uTexture', firstBloom.texture);
    gl.uniform2fv(bloom.uniform('uDirection'), [0, 8 / referenceHeight]);
    scalar(bloom, 'uExtract', 0);
    fullscreen(bloom, secondBloom, bloomWidth, bloomHeight);
    texture(bloom, 'uTexture', secondBloom.texture);
    gl.uniform2fv(bloom.uniform('uDirection'), [8 * height / width / referenceHeight, 0]);
    fullscreen(bloom, firstBloom, bloomWidth, bloomHeight);
    checkpoint('bloom-passes');

    gl.useProgram(composite.handle);
    texture(composite, 'uTexture', sceneTarget.texture, 0);
    texture(composite, 'uBloom', firstBloom.texture, 1);
    scalar(composite, 'uHologram', state.hologram / 100);
    fullscreen(composite, null, width, height);
    checkpoint('bloom-composite');
    if (frameCount === 0) info.firstGlError = gl.getError();
    frameCount += 1;
    canvas.dataset.frames = String(frameCount);
    canvas.dataset.time = time.toFixed(3);
  }

  function contextLost(event) {
    event.preventDefault();
    lost = true;
    canvas.dispatchEvent(new CustomEvent('artwork-lost'));
  }

  function contextRestored() {
    canvas.dispatchEvent(new CustomEvent('artwork-restored'));
  }

  function dispose() {
    disposed = true;
    canvas.removeEventListener('webglcontextlost', contextLost);
    canvas.removeEventListener('webglcontextrestored', contextRestored);
    for (const [type, resource] of resources) {
      const deleters = {
        buffer: 'deleteBuffer', vertexArray: 'deleteVertexArray', texture: 'deleteTexture',
        framebuffer: 'deleteFramebuffer', renderbuffer: 'deleteRenderbuffer',
      };
      gl[deleters[type]](resource);
    }
    programs.forEach(handle => gl.deleteProgram(handle));
  }

  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  canvas.dataset.engine = info.engine;
  canvas.dataset.particles = String(info.particles);
  resize();

  // 默认帧缓冲（画布本身）探针：初始化期间加载遮罩不透明，用户看不到这次探测绘制。
  // 若离屏目标全部可用而此处回读失败，说明画布表面本身在该驱动上不可写。
  {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, Math.min(width, 64), Math.min(height, 64));
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(probeProgram.handle);
    gl.bindVertexArray(probeVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const canvasPixel = new Uint8Array(4);
    gl.readPixels(Math.min(width, 32), Math.min(height, 32), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, canvasPixel);
    info.defaultFramebufferProbe = { px: Array.from(canvasPixel), error: gl.getError() };
    gl.bindVertexArray(null);
  }

  return { render, resize, dispose, info };
}
