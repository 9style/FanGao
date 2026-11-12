# 星夜回声 · Starry Echo

## Approved direction

An immersive, full-screen, interactive artwork combining the holographic
language of Joi in Blade Runner 2049 with the cobalt, gold, and flowing
brushwork of Vincent van Gogh's The Starry Night. The user approved the
dual-layer 3D figure and flowing starfield direction on 2026-11-12.

## Environment and assets

The workspace is a new project, not a Git checkout. Public search, MoMA,
and the npm registry could not be reached in this environment. There is
no available built-in image-generation tool. Do not imply that online
references, downloaded models, or AI-generated images were obtained.

Use dependency-free native WebGL for a runnable offline implementation.
Retain the proposed techniques: a translucent 3D figure, surface-sampled
brush particles, view-dependent rim light, scanning lines, signal
displacement, particle dissolution, a spiral vector field, and bloom.
The built-in woman is an original procedural, stylized sculpture wearing
a long dress, not a likeness of the actor or a production-quality GLB.

## Presentation

A dark, cinematic canvas with painterly blue currents and golden stars.
A recognizable feminine sculpture occupies the right of the desktop
composition, leaving the left for restrained editorial typography.
Hair, facial detail, a raised hand, and a flowing dress define the
silhouette. A gold projection ring grounds the hologram.

Minimal bilingual presentation: 星夜回声 / STARRY ECHO, a short headline,
small artwork labels, and a compact floating control panel. On mobile,
the figure moves to the center, the headline becomes smaller, and controls
reflow without horizontal scrolling.

## Interactions

- Pointer movement disturbs nearby particles and subtly follows the viewer.
- Pointer drag changes the figure's yaw within a small, safe viewing range.
- Clicking or tapping the artwork emits an expanding golden ripple.
- Pause freezes simulation; space toggles pause outside form controls.
- Sliders control starflow and hologram intensity, with visible values.
- A palette control switches between starry cobalt/gold and violet/cyan.
- Reset restores the view, palette, effects, and running state.
- Sound is optional, synthesized locally, and starts only after a user gesture.
- Fullscreen uses the browser API; unsupported browsers disable the control.
- An about dialog explains the work, controls, technical implementation,
  procedural assets, and the online-reference limitation.

## Architecture

- `src/math.js`: deterministic randomness, vector and matrix operations.
- `src/state.js`: validated artwork settings, simulation clock, pointer mapping.
- `src/geometry.js`: indexed female meshes and deterministic surface sampling.
- `src/shaders.js`: background, hologram, instanced brush, and bloom programs.
- `src/renderer.js`: GPU resources, render passes, resize, and adaptive resolution.
- `src/fallback.js`: useful 2D artwork when WebGL is unavailable.
- `src/audio.js`: user-initiated ambient synthesis and resource cleanup.
- `src/main.js`: accessible controls, pointer and keyboard interaction.
- `server.mjs`: local static server using Node built-ins only.

## Performance and failure handling

Use instanced, elongated brush sprites rather than thousands of mesh objects.
Limit pixel ratio to 1.5 on desktop and 1 on narrow screens. Reduce particles
and bloom resolution on low-performance devices. Respect reduced-motion
preferences and stop the clock while the tab is hidden. Recover from
WebGL context loss by offering a reload; unsupported WebGL gets a 2D
fallback rather than a blank page.

## Verification

Use Node's built-in test runner for settings, clocks, projection, matrices,
geometry, and sampling. Use a locally cached Playwright package with the
installed Chrome for a real browser check: successful WebGL rendering,
no shader errors, controls, pause, ripple, reset, dialog, mobile layout,
reduced motion, fallback, and screenshot inspection.

## Non-goals

No backend, remote tracking, login, external fonts, external runtime
dependencies, downloaded character animations, or full physics simulation.
No commits or new branches unless the user asks.
