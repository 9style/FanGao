# Repository Guidelines

## Project Structure & Module Organization

Starry Echo is an offline interactive artwork built with native JavaScript, WebGL 2, and Web Audio.

- `index.html`: page markup, controls, and artwork introduction.
- `src/`: ES modules and `style.css`. Rendering lives in `renderer.js` and `shaders.js`; procedural assets in `geometry.js`; camera and input handling in `camera.js` and `orbit-controls.js`; lifecycle coordination in `main.js`.
- `tests/`: unit, lifecycle, camera, and browser checks.
- `docs/superpowers/`: design specifications and implementation plans.
- `artifacts/`: generated browser screenshots; ignored by Git alongside `.cache/`.
- `server.mjs`: dependency-free local static server with the public `/admin/stats` analytics dashboard.
- `stats-store.mjs`: first-party visit logging (daily JSONL under `stats/`) and PV/UV aggregation; `stats/` is git-ignored.

Visuals and audio are generated locally; there is no separate asset directory.

## Build, Test, and Development Commands

Use Node.js 20+ and a modern browser. Running the app requires no package installation.

- `npm run dev` or `npm start`: serve at `http://localhost:5173` or `http://<host-ip>:5173` over the LAN.
- `$env:PORT = 8080`: set a different port in PowerShell before starting.
- `npm test`: run the explicitly configured suites with Node's built-in test runner.
- `node --test tests/camera.test.mjs`: run a focused suite.
- `npm run test:browser`: run interaction and camera browser checks against a running server.

Browser checks require local Chrome and `playwright-core`, installed with `npm install --no-save playwright-core` or available at `.cache/playwright/package`. Set `CHROME_PATH` for another executable and `TEST_URL` for another server address. No build step is required; deploy `index.html` and `src/` together.

## Coding Style & Naming Conventions

Follow existing ES module syntax, explicit `.js` import extensions, two-space indentation, single-quoted JavaScript strings, and semicolons. Use camelCase identifiers and lowercase, hyphen-separated filenames where needed, such as `orbit-controls.js`. Keep modules focused. No formatter or linter is configured.

## Testing Guidelines

Use `node:test` with `node:assert/strict`; name unit suites `*.test.mjs` and describe behavior in test names. Register new suites in `package.json` because `npm test` lists files explicitly. No coverage threshold is configured. Add regression checks for changed behavior; rendering or input changes should also exercise browser tests, including mobile, reduced-motion, and 2D fallback behavior.

## Commit & Pull Request Guidelines

No historical commit convention is established yet. Use concise imperative subjects, such as `Fix camera bounds during zoom`. Pull requests should describe the change, link relevant issues, list validation commands and results, and attach screenshots for visual changes.

## Runtime Constraints

Preserve offline operation: avoid CDN dependencies, remote fonts, and required API keys. Maintain keyboard accessibility, reduced-motion support, and the Canvas 2D fallback.
