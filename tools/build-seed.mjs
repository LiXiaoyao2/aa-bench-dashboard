#!/usr/bin/env node
/**
 * 生成 data/seed.json：抓一次 AA 榜单，作为项目自带的兜底数据。
 * 用法：node tools/build-seed.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, fetchLeaderboard, parseRows } from '../server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();

console.log(`抓取 ${cfg.sourceUrl} …`);
const html = await fetchLeaderboard(cfg);
const rows = parseRows(html);
if (rows.length < 50) {
  console.error(`只解析到 ${rows.length} 行，疑似页面结构变化，未写入 seed`);
  process.exit(1);
}

const seed = {
  fetchedAt: new Date().toISOString(),
  source: cfg.sourceUrl,
  rowCount: rows.length,
  rows,
  note: '项目自带兜底数据；启动时若 data/latest.json 不存在则用它初始化',
};

const out = path.join(__dirname, '..', 'data', 'seed.json');
const { writeFileSync, mkdirSync } = await import('node:fs');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(seed, null, 2));
console.log(`已写入 ${out}（${rows.length} 行）`);
