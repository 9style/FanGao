import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadVisits,
  recordVisit,
  summarizeVisits,
} from './stats-store.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);
const statsDir = path.join(root, 'stats');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function renderStatsHtml(summary) {
  const rows = (cells, tag = 'td') => `<tr>${cells.map(cell => `<${tag}>${cell}</${tag}>`).join('')}</tr>`;
  const dayRows = summary.perDay
    .map(day => rows([day.date, day.pv, day.uv]))
    .join('');
  const ipRows = summary.topIps
    .map(row => rows([
      escapeHtml(row.ip),
      row.visits,
      escapeHtml(row.firstSeen),
      escapeHtml(row.lastSeen),
      escapeHtml(row.userAgents[0] || ''),
    ]))
    .join('');
  const pathRows = summary.topPaths
    .map(row => rows([escapeHtml(row.path), row.visits]))
    .join('');
  const recentRows = summary.recent
    .map(record => rows([
      escapeHtml(record.time),
      escapeHtml(record.ip),
      escapeHtml(record.path),
      record.status,
      escapeHtml(record.referer),
      escapeHtml(record.userAgent),
    ]))
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>访问统计 · Starry Echo</title>
<style>
  body { margin: 0; padding: 28px; background: #080e19; color: #d9dbe4;
    font: 14px/1.6 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 22px; font-weight: 500; color: #eee9db; margin: 0 0 6px; }
  h2 { font-size: 15px; font-weight: 500; color: #d4b47a; margin: 28px 0 10px; }
  .meta { color: #7f8798; font-size: 12px; margin-bottom: 20px; }
  .cards { display: flex; flex-wrap: wrap; gap: 12px; }
  .card { border: 1px solid #a6b6cf20; border-radius: 10px; background: #0d1522;
    padding: 14px 20px; min-width: 120px; }
  .card b { display: block; font-size: 26px; color: #eee9db; font-weight: 500; }
  .card span { font-size: 12px; color: #7f8798; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid #a6b6cf14; vertical-align: top; }
  th { color: #b3a388; font-weight: 500; }
  td { color: #aab2c2; word-break: break-all; }
  .wrap { overflow-x: auto; border: 1px solid #a6b6cf14; border-radius: 10px; }
</style>
</head>
<body>
  <h1>访问统计</h1>
  <div class="meta">生成时间 ${escapeHtml(summary.generatedAt)}（UTC）· 仅记录 HTML 页面访问，静态资源不计</div>
  <div class="cards">
    <div class="card"><b>${summary.total.pv}</b><span>总访问量 PV</span></div>
    <div class="card"><b>${summary.total.uv}</b><span>独立 IP 数 UV</span></div>
    <div class="card"><b>${summary.today.pv}</b><span>今日 PV（${escapeHtml(summary.today.date)}）</span></div>
    <div class="card"><b>${summary.today.uv}</b><span>今日 UV</span></div>
    <div class="card"><b>${summary.total.days}</b><span>有记录的天数</span></div>
  </div>

  <h2>按日趋势</h2>
  <div class="wrap"><table>
    <thead><tr><th>日期（UTC）</th><th>PV</th><th>UV</th></tr></thead>
    <tbody>${dayRows || rows(['暂无数据', '', ''])}</tbody>
  </table></div>

  <h2>访问最多的 IP</h2>
  <div class="wrap"><table>
    <thead><tr><th>IP</th><th>次数</th><th>首次访问</th><th>最近访问</th><th>User-Agent</th></tr></thead>
    <tbody>${ipRows || rows(['暂无数据', '', '', '', ''])}</tbody>
  </table></div>

  <h2>热门页面</h2>
  <div class="wrap"><table>
    <thead><tr><th>路径</th><th>访问次数</th></tr></thead>
    <tbody>${pathRows || rows(['暂无数据', ''])}</tbody>
  </table></div>

  <h2>最近 ${summary.recent.length} 次访问</h2>
  <div class="wrap"><table>
    <thead><tr><th>时间（UTC）</th><th>IP</th><th>路径</th><th>状态</th><th>来源</th><th>User-Agent</th></tr></thead>
    <tbody>${recentRows || rows(['暂无数据', '', '', '', '', ''])}</tbody>
  </table></div>
</body>
</html>`;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/admin/stats') {
      if (request.method !== 'GET') {
        response.writeHead(405).end('Method not allowed');
        return;
      }
      const summary = summarizeVisits(await loadVisits(statsDir));
      const wantsJson = url.searchParams.get('format') === 'json'
        || (request.headers.accept || '').includes('application/json');
      if (wantsJson) {
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify(summary, null, 2));
      } else {
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(renderStatsHtml(summary));
      }
      return;
    }

    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`) || relative.split(/[\\/]/).some(segment => segment.startsWith('.'))) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const information = await stat(target);
    if (!information.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    const contentType = mimeTypes[path.extname(target)] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    pipeline(createReadStream(target), response, () => {});
    // 只统计 HTML 文档请求（页面访问），JS/CSS/图片等静态资源不产生记录
    if (request.method === 'GET' && contentType.startsWith('text/html')) {
      recordVisit(statsDir, request, pathname).catch(() => {});
    }
  } catch {
    response.writeHead(404).end('Not found');
  }
});

server.on('error', error => {
  console.error(`Cannot start the artwork: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '0.0.0.0', () => {
  console.log(`Starry Echo is ready at http://localhost:${port}`);
});
