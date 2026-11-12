import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { createAmbientAudio } from '../src/audio.js';

test('the static server serves the artwork through a LAN IPv4 address', async context => {
  const networkAddress = Object.values(networkInterfaces()).flat()
    .find(address => address.family === 'IPv4' && !address.internal)?.address;
  if (!networkAddress) {
    context.skip('No non-loopback IPv4 interface is available.');
    return;
  }
  const script = `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import { syncBuiltinESMExports } from 'node:module';
    import { once } from 'node:events';
    let server;
    const originalCreateServer = http.createServer;
    http.createServer = (...parameters) => {
      server = originalCreateServer(...parameters);
      return server;
    };
    syncBuiltinESMExports();
    process.env.PORT = '0';
    await import('./server.mjs');
    if (!server.listening) await once(server, 'listening');
    try {
      for (const address of ['127.0.0.1', ${JSON.stringify(networkAddress)}]) {
        const base = 'http://' + address + ':' + server.address().port;
        const response = await fetch(base, { signal: AbortSignal.timeout(3000) });
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Starry Echo/);
        const asset = await fetch(base + '/src/main.js', { signal: AbortSignal.timeout(3000) });
        assert.equal(asset.status, 200);
        assert.match(asset.headers.get('content-type'), /text\\/javascript/);
        await asset.text();
      }
    } finally {
      server.closeAllConnections();
      server.close();
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd() });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  const exitCode = await new Promise(resolve => child.on('close', resolve));
  assert.equal(exitCode, 0, output);
});

test('the static server survives a file stream error after successful stat', async () => {
  const script = `
    import fs from 'node:fs';
    import http from 'node:http';
    import { syncBuiltinESMExports } from 'node:module';
    import { Readable } from 'node:stream';
    import { once } from 'node:events';
    let server;
    const originalCreateServer = http.createServer;
    http.createServer = (...parameters) => {
      server = originalCreateServer(...parameters);
      return server;
    };
    fs.createReadStream = () => new Readable({
      read() { this.destroy(new Error('Controlled file-read failure')); }
    });
    syncBuiltinESMExports();
    process.env.PORT = '0';
    await import('./server.mjs');
    if (!server.listening) await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port;
    try { const response = await fetch(base + '/package.json'); await response.text(); } catch {}
    const response = await fetch(base + '/missing-file');
    if (response.status !== 404) throw new Error('Server did not survive the failed read');
    server.close();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd() });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  const exitCode = await new Promise(resolve => child.on('exit', resolve));
  assert.equal(exitCode, 0, output);
});

test('enabled audio resumes after the browser interrupts its context', async () => {
  const previousWindow = globalThis.window;
  let audioContext;
  const parameter = () => ({
    value: 0,
    cancelScheduledValues() {},
    setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime(value) { this.value = value; },
  });
  const node = () => ({
    gain: parameter(), frequency: parameter(), detune: parameter(),
    connect() {}, disconnect() {}, start() {}, stop() {},
  });
  class TestAudioContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 0;
      this.destination = node();
      audioContext = this;
    }
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createOscillator() { return node(); }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
  }
  globalThis.window = { AudioContext: TestAudioContext };
  const audio = createAmbientAudio();
  try {
    await audio.toggle();
    audioContext.state = 'interrupted';
    await audio.resume();
    assert.equal(audioContext.state, 'running');
    await audio.suspend();
    assert.equal(audioContext.state, 'suspended');
    await audio.toggle();
    audioContext.state = 'suspended';
    await audio.resume();
    assert.equal(audioContext.state, 'suspended', 'Muted audio must stay suspended.');
  } finally {
    audio.dispose();
    globalThis.window = previousWindow;
  }
});
