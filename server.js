#!/usr/bin/env node
/**
 * AA Benchmark Dashboard —— 零依赖单文件后端
 *
 * 数据源：Artificial Analysis LLM Leaderboard（服务端渲染的静态表格，直接抓 HTML 解析）
 * 功能：
 *   1. 抓取并解析榜单（含多档位拆分：max / high / xhigh / medium / low / non-reasoning）
 *   2. 按 config.json 规则过滤档位 + 取前 N 名 + 自选性价比观察列表
 *   3. 提供页面与 /api/data、/api/update（更新按钮）接口
 *   4. 每次更新留存快照，榜单上展示 ▲▼ 变化
 *
 * 用法：node server.js [--port 8787]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const PUBLIC_DIR = path.join(ROOT, 'public');
const LATEST_FILE = path.join(DATA_DIR, 'latest.json');
const PREVIOUS_FILE = path.join(DATA_DIR, 'previous.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');

/* ------------------------------------------------------------------ *
 * 配置
 * ------------------------------------------------------------------ */

const DEFAULT_CONFIG = {
  port: 8787,
  sourceUrl: 'https://artificialanalysis.ai/leaderboards/models',
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  fetchTimeoutMs: 45000,
  topN: 50,
  allowedTiers: ['max', 'high', 'default'],
  tierOrder: ['max', 'high', 'xhigh', 'medium', 'low', 'non-reasoning', 'default'],
  staleHours: 72,
  highlight: ['Step 5'],
  watchlist: [],
};

export function loadConfig() {
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  } catch (err) {
    console.warn('[config] 读取 config.json 失败，使用默认配置：', err.message);
  }
  const args = process.argv.slice(2);
  const portArgIdx = args.findIndex((a) => a === '--port' || a === '-p');
  const cliPort = portArgIdx >= 0 ? Number(args[portArgIdx + 1]) : undefined;
  return {
    ...DEFAULT_CONFIG,
    ...fileCfg,
    port: cliPort || Number(process.env.PORT) || fileCfg.port || DEFAULT_CONFIG.port,
  };
}

/* ------------------------------------------------------------------ *
 * 抓取 + 解析
 * ------------------------------------------------------------------ */

/** 已知档位关键字（用于从 "Claude Opus 5.5 (max with fallback)" 里拆出档位） */
const TIER_KEYWORDS = ['non-reasoning', 'xhigh', 'max', 'high', 'medium', 'low'];

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, '\u00A0')
    .replace(/&amp;/g, '&');
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * 把模型全名拆成 基础名 + 档位。
 *  - "Claude Opus 5.5 (max with fallback)" -> { base: "Claude Opus 5.5", tier: "max" }
 *  - "Step 5 Preview"                      -> { base: "Step 5 Preview", tier: "default" }
 *  - "Qwen3.8 Max (0902)" / "(June 2026)"   -> 括号不是档位，tier = "default"
 */
export function parseModelName(fullName) {
  const name = fullName.trim();
  const m = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (m) {
    const base = m[1].trim();
    // 括号里可能是 "max with fallback" / "non-reasoning" / "Daybreak Blue, max"，逐段判断
    const segments = m[2].toLowerCase().split(/[,\s]+/).filter(Boolean);
    const tier = TIER_KEYWORDS.find((t) => segments.includes(t));
    if (tier) return { base, tier };
  }
  return { base: name, tier: 'default' };
}

function num(v) {
  if (v == null) return null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 从 AA 榜单页 HTML 解析出全部行 */
export function parseRows(html) {
  const rows = [];
  const seen = new Set();

  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
  let tr;
  while ((tr = trRe.exec(html)) !== null) {
    const chunk = tr[1];

    // 模型名 + 品牌色
    const nameM = chunk.match(
      /<div class="font-semibold border-l-4 pl-2"[^>]*>([\s\S]*?)<\/div>/,
    );
    if (!nameM) continue;
    const fullName = stripTags(nameM[1]);
    if (!fullName || seen.has(fullName)) continue;
    seen.add(fullName);

    const colorM = chunk.match(/border-left-color:\s*(#[0-9a-fA-F]{3,8})/);
    const slugM = chunk.match(/href="\/models\/([^"/?]+)"/);

    const tds = [...chunk.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
    if (tds.length < 8) continue;

    const creatorM = tds[2].match(/alt="([^"]*)"/);
    const { base, tier } = parseModelName(fullName);

    const indexText = stripTags(tds[3]);

    rows.push({
      name: fullName,
      base,
      tier,
      creator: creatorM ? decodeEntities(creatorM[1]) : stripTags(tds[2]),
      slug: slugM ? slugM[1] : null,
      url: slugM ? `https://artificialanalysis.ai/models/${slugM[1]}` : null,
      color: colorM ? colorM[1] : null,
      context: stripTags(tds[1]) || null,
      index: num(indexText),
      estimated: /\*/.test(indexText),
      cost: num(stripTags(tds[4])),
      tps: num(stripTags(tds[5])),
      ttft: num(stripTags(tds[6])),
      total: num(stripTags(tds[7])),
    });
  }
  return rows;
}

/** 抓取榜单页 HTML */
export async function fetchLeaderboard(cfg) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.fetchTimeoutMs || 45000);
  try {
    const res = await fetch(cfg.sourceUrl, {
      headers: {
        'User-Agent': cfg.userAgent,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: ac.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    if (!html || html.length < 100000) {
      throw new Error(`返回内容异常（${html ? html.length : 0} 字节），疑似被反爬拦截`);
    }
    return html;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * 视图构建：档位过滤 / 排名 / 观察列表 / 性价比
 * ------------------------------------------------------------------ */

function valuePerDollar(row) {
  if (row.index == null || row.cost == null || row.cost <= 0) return null;
  return row.index / row.cost;
}

function sortByIndex(a, b) {
  return (
    (b.index ?? -1) - (a.index ?? -1) ||
    (a.cost ?? 1e9) - (b.cost ?? 1e9) ||
    a.name.localeCompare(b.name)
  );
}

/**
 * rows: 原始解析行（按榜单顺序）
 * previous: 上一次快照的 rows，用于算 ▲▼
 */
export function buildView(rows, cfg, previousRows = []) {
  const hasPrev = Array.isArray(previousRows) && previousRows.length > 0;
  const prevByName = new Map((previousRows || []).map((r) => [r.name, r]));

  // 观察列表匹配用的「归一化」名称：忽略大小写和 -/_ /空格 差异
  const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

  const enrich = (row, originalRank) => {
    const prev = prevByName.get(row.name);
    const delta =
      hasPrev && prev && prev.index != null && row.index != null
        ? row.index - prev.index
        : null;
    return {
      rank: originalRank, // 注意：主榜会用 map 覆盖为过滤后的名次，这里保留的是 AA 原始榜位次
      name: row.name,
      base: row.base,
      tier: row.tier,
      creator: row.creator,
      slug: row.slug,
      url: row.url,
      color: row.color,
      context: row.context,
      index: row.index,
      estimated: row.estimated,
      cost: row.cost,
      tps: row.tps,
      ttft: row.ttft,
      total: row.total,
      vpd: valuePerDollar(row) == null ? null : Math.round(valuePerDollar(row)),
      delta,
      isNew: hasPrev && !prev,
      // 高亮：命中 config.highlight 任一关键字即高亮（与观察列表同样忽略大小写/-/_/空格差异）
      highlighted: (cfg.highlight || []).some((h) => normalize(row.base).includes(normalize(h))),
    };
  };

  const allowed = new Set(cfg.allowedTiers || DEFAULT_CONFIG.allowedTiers);

  // 主榜：只保留 max / high / default 三档，按指数排序取前 topN
  const filtered = rows
    .filter((r) => allowed.has(r.tier))
    .slice()
    .sort(sortByIndex)
    .map((r, i) => enrich(r, rows.indexOf(r) + 1));

  const mainTop = filtered
    .slice(0, cfg.topN || 50)
    .map((r, i) => ({ ...r, rank: i + 1, origRank: r.rank }));
  const inMain = new Set(mainTop.map((r) => r.name));

  // 观察列表：忽略档位过滤，按文件名模糊匹配，挑该家族最高档/最高分的那一条
  const tierRank = (t) => {
    const order = cfg.tierOrder || DEFAULT_CONFIG.tierOrder;
    const i = order.indexOf(t);
    return i < 0 ? order.length : i;
  };
  const watchlist = [];
  for (const pattern of cfg.watchlist || []) {
    const needle = normalize(pattern);
    const family = rows.filter((r) => normalize(r.base).includes(needle));
    if (!family.length) {
      watchlist.push({
        pattern,
        name: null,
        base: pattern,
        missing: true,
        rank: null,
        origRank: null,
        index: null,
        cost: null,
        tps: null,
        vpd: null,
        delta: null,
        isNew: false,
        inMain: false,
        highlighted: false,
      });
      continue;
    }
    const best = family
      .slice()
      .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || (b.index ?? -1) - (a.index ?? -1))[0];
    const enriched = enrich(best, rows.indexOf(best) + 1);
    watchlist.push({
      ...enriched,
      origRank: enriched.rank,
      pattern,
      familySize: family.length,
      inMain: inMain.has(best.name),
    });
  }

  const stats = {
    rawRows: rows.length,
    afterTierFilter: filtered.length,
    mainShown: mainTop.length,
    watchlistMatched: watchlist.filter((w) => !w.missing).length,
    watchlistMissing: watchlist.filter((w) => w.missing).map((w) => w.pattern),
    topIndex: rows.length ? Math.max(...rows.map((r) => r.index ?? -1)) : null,
    medianIndex: (() => {
      const vals = rows.map((r) => r.index).filter((v) => v != null).sort((a, b) => a - b);
      if (!vals.length) return null;
      return vals[Math.floor(vals.length / 2)];
    })(),
  };

  return { mainTop, watchlist, stats };
}

/* ------------------------------------------------------------------ *
 * 快照存储
 * ------------------------------------------------------------------ */

function ensureDirs() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
}

function writeJson(file, obj) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file); // 原子替换，避免写一半
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 内存中的当前快照 */
let current = null;

function loadInitialSnapshot(cfg) {
  ensureDirs();
  let snap = readJson(LATEST_FILE);
  if (!snap) {
    // 首次运行：用随仓库提供的 seed.json 兜底，保证不依赖外网也能看到数据
    snap = readJson(SEED_FILE);
    if (snap) {
      snap.fromSeed = true;
      writeJson(LATEST_FILE, snap);
      console.log('[store] 首次运行，已用 data/seed.json 初始化');
    }
  }
  current = snap;
  return snap;
}

async function refreshData(cfg) {
  ensureDirs();
  const html = await fetchLeaderboard(cfg);
  const rows = parseRows(html);
  if (rows.length < 50) {
    throw new Error(`只解析到 ${rows.length} 行，疑似页面结构变化或被拦截，已保留旧数据`);
  }

  // 留档：上一次 -> previous.json，历史 -> data/raw/<ts>.json
  const prev = current;
  if (prev) {
    writeJson(PREVIOUS_FILE, prev);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    writeJson(path.join(RAW_DIR, `${ts}.json`), prev);
  }

  const snap = {
    fetchedAt: new Date().toISOString(),
    source: cfg.sourceUrl,
    rowCount: rows.length,
    rows,
  };
  writeJson(LATEST_FILE, snap);
  current = snap;
  return snap;
}

/* ------------------------------------------------------------------ *
 * HTTP 服务
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  });
}

let updating = false;

function payload(cfg) {
  if (!current) {
    return { ok: false, error: '还没有数据，请点击「更新数据」按钮首次抓取' };
  }
  const previousRows = readJson(PREVIOUS_FILE)?.rows || null;
  const view = buildView(current.rows, cfg, previousRows);
  const ageHours = current.fetchedAt
    ? (Date.now() - new Date(current.fetchedAt).getTime()) / 36e5
    : null;
  return {
    ok: true,
    fetchedAt: current.fetchedAt,
    source: current.source,
    fromSeed: !!current.fromSeed,
    ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
    stale: ageHours != null && ageHours > (cfg.staleHours || 72),
    hasPrevious: !!previousRows,
    highlight: (cfg.highlight || []).slice(),
    ...view,
  };
}

export function createServer(cfg) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    try {
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        return serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));
      }
      if (req.method === 'GET' && (pathname === '/app.js' || pathname === '/style.css')) {
        return serveStatic(res, path.join(PUBLIC_DIR, pathname));
      }
      if (req.method === 'GET' && pathname === '/api/data') {
        return sendJson(res, 200, payload(cfg));
      }
      if (req.method === 'GET' && pathname === '/api/config') {
        return sendJson(res, 200, {
          ok: true,
          highlight: (cfg.highlight || []).slice(),
          watchlist: (cfg.watchlist || []).slice(),
          topN: cfg.topN,
        });
      }
      if (req.method === 'POST' && pathname === '/api/config') {
        // 目前支持在线修改的只有 highlight（高亮关键字），写回 config.json 并同步内存
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1e6) break;
        }
        let parsed;
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
        }
        const hl = parsed.highlight;
        if (!Array.isArray(hl) || hl.some((h) => typeof h !== 'string' || !h.trim())) {
          return sendJson(res, 400, { ok: false, error: 'highlight 必须是非空字符串数组' });
        }
        const cleaned = [...new Set(hl.map((h) => h.trim()).filter(Boolean))];

        const cfgPath = path.join(ROOT, 'config.json');
        let fileCfg = {};
        try {
          fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        } catch {
          /* 文件不存在或损坏时从默认值重建 */
        }
        fileCfg.highlight = cleaned;
        try {
          writeJson(cfgPath, fileCfg); // 原子写回，避免写一半损坏配置
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: `写回 config.json 失败：${err.message}` });
        }
        cfg.highlight = cleaned; // 内存同步，下一次 /api/data 立即生效
        return sendJson(res, 200, { ok: true, highlight: cleaned });
      }
      if (req.method === 'GET' && pathname === '/api/status') {
        return sendJson(res, 200, {
          ok: true,
          updating,
          fetchedAt: current?.fetchedAt || null,
          rowCount: current?.rowCount ?? null,
        });
      }
      if (req.method === 'POST' && pathname === '/api/update') {
        if (updating) {
          return sendJson(res, 409, { ok: false, error: '正在更新中，请稍候…' });
        }
        updating = true;
        const startedAt = Date.now();
        try {
          const snap = await refreshData(cfg);
          return sendJson(res, 200, {
            ...payload(cfg),
            justUpdated: true,
            updateMs: Date.now() - startedAt,
            rowCount: snap.rowCount,
          });
        } catch (err) {
          console.error('[update] 抓取失败：', err.message);
          return sendJson(res, 502, {
            ok: false,
            error: `更新失败：${err.message}（已保留上一次的数据）`,
          });
        } finally {
          updating = false;
        }
      }
      if (req.method === 'POST' && pathname === '/api/shutdown') {
        return sendJson(res, 200, { ok: true });
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    } catch (err) {
      console.error('[server] 未处理异常：', err);
      sendJson(res, 500, { ok: false, error: String(err.message || err) });
    }
  });
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

export function main() {
  const cfg = loadConfig();
  loadInitialSnapshot(cfg);
  const server = createServer(cfg);
  server.listen(cfg.port, () => {
    console.log('');
    console.log('  AA Benchmark Dashboard');
    console.log(`  ➜  http://localhost:${cfg.port}`);
    console.log(`  数据源：${cfg.sourceUrl}`);
    console.log(`  规则：仅保留 [${cfg.allowedTiers.join(' / ')}] 档位，取前 ${cfg.topN} 名`);
    if (!current) console.log('  提示：当前无数据，打开页面后点「更新数据」首次抓取');
    console.log('');
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`端口 ${cfg.port} 被占用，换个端口：node server.js --port 8790`);
      process.exit(1);
    }
    throw err;
  });
}

if (isMain()) main();

export { __dirname, DATA_DIR, LATEST_FILE, PREVIOUS_FILE, SEED_FILE };
