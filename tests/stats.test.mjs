import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  getClientIp,
  recordVisit,
  loadVisits,
  summarizeVisits,
} from '../stats-store.mjs';

const request = (headers = {}, remoteAddress = '203.0.113.7') => ({
  headers,
  socket: { remoteAddress },
  method: 'GET',
});

let statsDir;
test.beforeEach(async () => {
  statsDir = await mkdtemp(path.join(os.tmpdir(), 'starry-stats-'));
});
test.afterEach(async () => {
  await rm(statsDir, { recursive: true, force: true });
});

test('client IP prefers the first X-Forwarded-For hop, then the socket', () => {
  assert.equal(getClientIp(request({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' })), '198.51.100.2');
  assert.equal(getClientIp(request({}, '192.0.2.9')), '192.0.2.9');
});

test('recordVisit appends one JSON line per page view to a daily file', async () => {
  await recordVisit(statsDir, request({ 'user-agent': 'MiuiBrowser/1.0' }), '/');
  await recordVisit(statsDir, request({ referer: 'https://example.test/' }), '/index.html');
  const records = await loadVisits(statsDir);
  assert.equal(records.length, 2);
  assert.equal(records[0].ip, '203.0.113.7');
  assert.equal(records[0].path, '/');
  assert.equal(records[0].status, 200);
  assert.equal(records[0].userAgent, 'MiuiBrowser/1.0');
  assert.equal(records[1].referer, 'https://example.test/');
  const today = new Date().toISOString().slice(0, 10);
  const raw = await readFile(path.join(statsDir, `visits-${today}.jsonl`), 'utf8');
  assert.equal(raw.trim().split('\n').length, 2);
});

test('loadVisits merges daily files and tolerates corrupt lines', async () => {
  await writeFile(path.join(statsDir, 'visits-2026-11-12.jsonl'),
    `${JSON.stringify({ time: '2026-11-12T08:00:00.000Z', ip: '1.1.1.1', path: '/' })}\nnot-json\n`);
  await writeFile(path.join(statsDir, 'visits-2026-11-13.jsonl'),
    `${JSON.stringify({ time: '2026-11-13T09:00:00.000Z', ip: '2.2.2.2', path: '/' })}\n`);
  const records = await loadVisits(statsDir);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(r => r.ip), ['1.1.1.1', '2.2.2.2']);
});

test('loadVisits returns an empty list when the directory does not exist', async () => {
  const records = await loadVisits(path.join(statsDir, 'missing'));
  assert.deepEqual(records, []);
});

test('summarizeVisits counts PV, UV, per-day rollups and top IPs and paths', () => {
  const records = [
    { time: '2026-11-12T08:00:00.000Z', ip: '1.1.1.1', path: '/', userAgent: 'A' },
    { time: '2026-11-12T09:00:00.000Z', ip: '1.1.1.1', path: '/', userAgent: 'A' },
    { time: '2026-11-12T10:00:00.000Z', ip: '2.2.2.2', path: '/index.html', userAgent: 'B' },
    { time: '2026-11-13T09:00:00.000Z', ip: '2.2.2.2', path: '/', userAgent: 'B' },
  ];
  const summary = summarizeVisits(records, new Date('2026-11-13T12:00:00.000Z'));
  assert.deepEqual(summary.total, { pv: 4, uv: 2, days: 2 });
  assert.deepEqual(summary.today, { date: '2026-11-13', pv: 1, uv: 1 });
  assert.deepEqual(summary.perDay.map(d => d.date), ['2026-11-13', '2026-11-12']);
  assert.deepEqual(summary.perDay[1], { date: '2026-11-12', pv: 3, uv: 2 });
  assert.equal(summary.topIps[0].ip, '2.2.2.2');
  assert.equal(summary.topIps[0].visits, 2);
  assert.deepEqual(summary.topPaths, [
    { path: '/', visits: 3 },
    { path: '/index.html', visits: 1 },
  ]);
  assert.equal(summary.recent[0].time, '2026-11-13T09:00:00.000Z');
});
