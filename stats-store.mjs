// 第一方访问统计：页面访问按天追加到 JSONL，并提供聚合汇总。
// 只使用 Node 内置模块，不依赖外部服务或数据库。
import path from 'node:path';
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';

const FILE_PREFIX = 'visits-';
const RECENT_LIMIT = 50;
const TOP_LIMIT = 20;

function dayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// 反向代理在 X-Forwarded-For 中给出真实客户端 IP，取链路第一个；直连时用 socket 地址
export function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket?.remoteAddress || '';
}

// 记录一次页面访问（仅 HTML 文档请求调用，静态资源不记录）
export async function recordVisit(statsDir, request, pathname, status = 200) {
  const record = {
    time: new Date().toISOString(),
    ip: getClientIp(request),
    method: request.method,
    path: pathname,
    status,
    referer: request.headers.referer || '',
    language: request.headers['accept-language'] || '',
    userAgent: request.headers['user-agent'] || '',
  };
  await mkdir(statsDir, { recursive: true });
  const file = path.join(statsDir, `${FILE_PREFIX}${dayStamp()}.jsonl`);
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
}

export async function loadVisits(statsDir) {
  let files;
  try {
    files = (await readdir(statsDir))
      .filter(name => name.startsWith(FILE_PREFIX) && name.endsWith('.jsonl'))
      .sort();
  } catch {
    return [];
  }
  const records = [];
  for (const name of files) {
    const text = await readFile(path.join(statsDir, name), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // 跳过损坏的行，不影响其余统计
      }
    }
  }
  return records;
}

export function summarizeVisits(records, now = new Date()) {
  const today = dayStamp(now);
  const ipSet = new Set();
  const todayIpSet = new Set();
  const perDayMap = new Map();
  const ipMap = new Map();
  const pathMap = new Map();
  let todayPv = 0;

  for (const record of records) {
    const ip = record.ip || 'unknown';
    const day = String(record.time || '').slice(0, 10);
    ipSet.add(ip);

    let dayRow = perDayMap.get(day);
    if (!dayRow) {
      dayRow = { date: day, pv: 0, uv: new Set() };
      perDayMap.set(day, dayRow);
    }
    dayRow.pv += 1;
    dayRow.uv.add(ip);

    if (day === today) {
      todayPv += 1;
      todayIpSet.add(ip);
    }

    let ipRow = ipMap.get(ip);
    if (!ipRow) {
      ipRow = { ip, visits: 0, firstSeen: record.time, lastSeen: record.time, userAgents: new Set() };
      ipMap.set(ip, ipRow);
    }
    ipRow.visits += 1;
    ipRow.lastSeen = record.time;
    if (record.userAgent) ipRow.userAgents.add(record.userAgent);

    const page = record.path || '/';
    pathMap.set(page, (pathMap.get(page) || 0) + 1);
  }

  const perDay = [...perDayMap.values()]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(row => ({ date: row.date, pv: row.pv, uv: row.uv.size }));
  const topIps = [...ipMap.values()]
    .sort((a, b) => (b.visits - a.visits) || (a.lastSeen < b.lastSeen ? 1 : -1))
    .slice(0, TOP_LIMIT)
    .map(row => ({ ...row, userAgents: [...row.userAgents].slice(0, 3) }));
  const topPaths = [...pathMap.entries()]
    .map(([page, visits]) => ({ path: page, visits }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, TOP_LIMIT);

  return {
    generatedAt: now.toISOString(),
    total: { pv: records.length, uv: ipSet.size, days: perDayMap.size },
    today: { date: today, pv: todayPv, uv: todayIpSet.size },
    perDay,
    topIps,
    topPaths,
    recent: records.slice(-RECENT_LIMIT).reverse(),
  };
}
