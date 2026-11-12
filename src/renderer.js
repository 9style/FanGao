import { createRandom } from './math.js';
import { cameraFrame, createView, projectToScreen, screenToWorld } from './camera.js';
import { createFigure, sampleSurface } from './geometry.js';
import { createFallback } from './fallback.js';
import {
  fullscreenVertex, backgroundFragment, hologramVertex, hologramFragment,
  brushVertex, brushFragment, bloomFragment, compositeFragment,
} from './shaders.js';

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
  const narrow = () => innerWidth < 700;
  const lowPower = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4;
  const figure = createFigure();
  const sampleCount = narrow() || lowPower ? 11500 : 19500;
  const figureSamples = sampleSurface(figure.meshes, sampleCount, 79);
  const flowSamples = createFlowParticles(narrow() || lowPower ? 4800 : 10500);
  const ringSamples = createRingParticles(1350);
  const info = { engine: 'webgl', particles: sampleCount + flowSamples.positions.length / 3, meshes: figure.meshes.length };

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

  function target(depth = false) {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    let depthBuffer = null;
    if (depth) {
      depthBuffer = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
      resources.push(['renderbuffer', depthBuffer]);
    }
    resources.push(['texture', texture], ['framebuffer', framebuffer]);
    return { texture, framebuffer, depthBuffer };
  }

  const sceneTarget = target(true);
  const firstBloom = target();
  const secondBloom = target();

  function allocate(renderTarget, targetWidth, targetHeight) {
    gl.bindTexture(gl.TEXTURE_2D, renderTarget.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, targetWidth, targetHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    if (renderTarget.depthBuffer) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, renderTarget.depthBuffer);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, targetWidth, targetHeight);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget.framebuffer);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Projection framebuffer is incomplete.');
  }

  function resize() {
    if (lost || disposed) return;
    const ratio = Math.min(devicePixelRatio || 1, narrow() ? 1 : 1.5) * resolutionScale;
    width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    canvas.width = width;
    canvas.height = height;
    bloomWidth = Math.max(1, Math.floor(width / 4));
    bloomHeight = Math.max(1, Math.floor(height / 4));
    allocate(sceneTarget, width, height);
    allocate(firstBloom, bloomWidth, bloomHeight);
    allocate(secondBloom, bloomWidth, bloomHeight);
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
    scalar(activeProgram, 'uPalette', state.palette);
    scalar(activeProgram, 'uYaw', 0);
    gl.uniform2fv(activeProgram.uniform('uOffset'), offset);
    gl.uniform2fv(activeProgram.uniform('uResolution'), [width, height]);
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
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    common(background, time, interaction);
    scalar(background, 'uAspect', width / height);
    gl.uniform2fv(background.uniform('uFloor'), projectToScreen([offset[0], -2.61 + offset[1], 0], frame));
    const rippleScreen = projectToScreen(interaction.ripple.slice(0, 3), frame);
    gl.uniform3fv(background.uniform('uScreenRipple'), [
      (rippleScreen[0] - 0.5) * width / height * 8.8, (rippleScreen[1] - 0.5) * 8.8, interaction.ripple[3],
    ]);
    fullscreen(background, sceneTarget, width, height);

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

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    common(hologram, time, interaction);
    gl.uniform3fv(hologram.uniform('uEye'), eye);
    for (const mesh of gpuMeshes) {
      scalar(hologram, 'uKind', mesh.kind);
      gl.bindVertexArray(mesh.vertexArray);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    }

    gl.depthMask(false);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    common(brushes, time, interaction);
    drawParticles(figureParticles, 0);
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    gl.useProgram(bloom.handle);
    texture(bloom, 'uTexture', sceneTarget.texture);
    gl.uniform2fv(bloom.uniform('uDirection'), [1 / width, 0]);
    scalar(bloom, 'uExtract', 1);
    fullscreen(bloom, firstBloom, bloomWidth, bloomHeight);
    texture(bloom, 'uTexture', firstBloom.texture);
    gl.uniform2fv(bloom.uniform('uDirection'), [0, 2 / bloomHeight]);
    scalar(bloom, 'uExtract', 0);
    fullscreen(bloom, secondBloom, bloomWidth, bloomHeight);
    texture(bloom, 'uTexture', secondBloom.texture);
    gl.uniform2fv(bloom.uniform('uDirection'), [2 / bloomWidth, 0]);
    fullscreen(bloom, firstBloom, bloomWidth, bloomHeight);

    gl.useProgram(composite.handle);
    texture(composite, 'uTexture', sceneTarget.texture, 0);
    texture(composite, 'uBloom', firstBloom.texture, 1);
    scalar(composite, 'uHologram', state.hologram / 100);
    fullscreen(composite, null, width, height);
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
  return { render, resize, dispose, info };
}
