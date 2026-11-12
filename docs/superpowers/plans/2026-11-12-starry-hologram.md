# Starry Echo Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task. Use the
> executing-plans and test-driven-development workflows. No delegation,
> branch creation, or commits are requested.

**Goal:** Build an offline, interactive holographic woman inside a painterly starfield.

**Architecture:** Native WebGL renders a procedural 3D figure and instanced
surface brush strokes over an animated painterly sky. A downsampled bloom
pass adds projection glow. DOM controls drive a pure settings/clock model.

**Tech Stack:** JavaScript ES modules, WebGL, CSS, Node built-ins.

**Spec:** `docs/superpowers/specs/2026-11-12-starry-hologram-design.md`

## Global Constraints

- No external runtime dependencies or network-loaded assets.
- The figure is an original procedural sculpture, not a downloaded GLB.
- All controls work with pointer, touch, and keyboard where appropriate.
- Reduced motion, mobile layout, and no-WebGL fallback are required.
- No commits or new branches unless the user asks.

## Task 1: Testable scene foundations

**Files:** `package.json`, `server.mjs`, `src/math.js`, `src/state.js`,
`src/geometry.js`, `tests/core.test.mjs`.

**Interfaces:**
- `createRandom(seed) -> () => number`
- `perspective(fov, aspect, near, far) -> Float32Array(16)`
- `lookAt(eye, target, up) -> Float32Array(16)`
- `multiplyMatrices(left, right) -> Float32Array(16)`
- `createState(reducedMotion) -> settings`
- `updateSetting(state, key, value) -> state`
- `advanceClock(clock, now, active) -> simulationSeconds`
- `pointerToScene(x, y, width, height) -> [x, y]`
- `createFigure() -> { meshes, bounds }`
- `sampleSurface(meshes, count, seed) -> { positions, normals, seeds }`

- [x] Write failing behavioral tests with literal expectations:
  clamping settings, pause without clock jumps, center pointer projection,
  reproducible samples, finite mesh vertices, and unit sample normals.
- [x] Run `node --test tests/core.test.mjs` and observe missing implementation.
- [x] Implement pure math/state, a detailed original female sculpture,
  area-weighted triangle sampling, and a safe static server.
- [x] Run the tests and confirm passing behavior.

## Task 2: Render the living artwork

**Files:** `src/shaders.js`, `src/renderer.js`, `src/fallback.js`.

**Interfaces:**
- `createRenderer(canvas, state) -> { render, resize, dispose, info }`
- `render(time, interaction)` consumes `{ pointer, yaw, ripple }`.
- `createFallback(canvas, state)` exposes the same render interface.

- [x] Add browser smoke coverage requiring a nonempty scene and no GPU errors.
- [x] Render full-screen layered blue brush currents, crescent moon, and stars.
- [x] Render the transparent figure with Fresnel, scanlines, and brief glitches.
- [x] Render sampled elongated brush particles and local pointer/ripple motion.
- [x] Add low-resolution thresholded separable bloom and final tone composition.
- [x] Add resize limits, context-loss feedback, and the 2D fallback.
- [x] Run a real Chrome screenshot and inspect the figure and composition.

## Task 3: Build accessible interactive presentation

**Files:** `index.html`, `src/style.css`, `src/main.js`, `src/audio.js`.

**Interfaces:**
- DOM controls update the shared settings state.
- Pointer gestures update renderer interaction, not DOM layout.
- `createAmbientAudio() -> { toggle, dispose, enabled }`.

- [x] Extend browser tests for pause, sliders, palette, ripple, reset, and dialog.
- [x] Implement bilingual editorial layout and responsive glass controls.
- [x] Wire pointer movement, bounded dragging, clicks, and keyboard shortcuts.
- [x] Add opt-in ambient sound, fullscreen, and an honest credits/help dialog.
- [x] Respect reduced motion, tab visibility, and WebGL failure behavior.
- [x] Verify desktop/mobile screenshots and keyboard interaction.

## Task 4: Verify and document delivery

**Files:** `README.md`, `.gitignore`, `tests/browser.test.mjs`.

- [x] Run `npm test` for the full pure-function suite.
- [x] Run `node tests/browser.test.mjs` with the cached browser tooling.
- [x] Inspect desktop/mobile screenshots and correct concrete visual failures.
- [x] Document `npm run dev`, controls, local assets, and the network limitation.
- [x] Mark this plan's completed steps and report only verified results.

## Verification record

- `npm test`: 14 passing tests, 0 failures.
- `node tests/browser.test.mjs`: desktop, mobile, landscape, reduced motion,
  and no-WebGL fallback passed in installed Chrome using software WebGL.
- The browser test reads actual framebuffer pixels and checks GPU errors,
  rather than relying exclusively on renderer counters.
- Regression tests demonstrated and fixed static-server stream crashes,
  interrupted audio resumption, and repeated-spacebar pause toggling.
- Keyboard users can also emit ripples and rotate the figure.
- Desktop, mobile, landscape, and fallback screenshots are in `artifacts/`.
- Network reference acquisition remains unavailable; the implementation
  honestly uses procedural assets and native WebGL rather than Three.js.
- The workspace is not a Git repository. No branch, commit, or merge was made.
