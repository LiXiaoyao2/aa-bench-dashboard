/* AA Benchmark 定制榜单 - 前端逻辑（无框架，无依赖） */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const mainBody = $('mainBody');
  const watchBody = $('watchBody');

  let DATA = null;               // /api/data 返回的完整数据
  let mainSort = { key: 'index', dir: -1 };
  let watchSort = { key: 'index', dir: -1 };
  let searchText = '';

  /* ---------------- 工具 ---------------- */

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  const fmtNum = (v, digits = 0) =>
    v == null ? '—' : Number(v).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });

  const fmtCost = (v) => (v == null ? '—' : '$' + Number(v).toFixed(2));
  const fmtVpd = (v) => (v == null ? '—' : fmtNum(v));
  const fmtTps = (v) => (v == null ? '—' : fmtNum(v));
  const fmtSec = (v) => (v == null ? '—' : Number(v).toFixed(2));

  /** 模型名归一化：忽略大小写与 -/_ /空格 差异，用于高亮/观察列表匹配 */
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

  /** 行内 ☆/★ 快捷高亮开关 */
  const starBtn = (r) =>
    `<button class="star ${r.highlighted ? 'on' : ''}" data-base="${esc(r.base)}" ` +
    `title="${r.highlighted ? '取消高亮 ' + esc(r.base) : '高亮 ' + esc(r.base)}">` +
    `${r.highlighted ? '★' : '☆'}</button>`;

  function relTime(iso) {
    if (!iso) return '未知时间';
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min} 分钟前`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} 小时 ${min % 60} 分前`;
    const d = Math.floor(h / 24);
    return `${d} 天 ${h % 24} 小时前`;
  }

  function deltaHtml(delta, isNew) {
    if (isNew) return '<span class="delta new">NEW</span>';
    if (delta == null) return '<span class="delta flat">—</span>';
    if (delta === 0) return '<span class="delta flat">±0</span>';
    if (delta > 0) return `<span class="delta up">▲ +${delta}</span>`;
    return `<span class="delta down">▼ ${delta}</span>`;
  }

  function toast(kind, title, body, ms = 4200) {
    const el = $('toast');
    el.className = `toast ${kind}`;
    el.innerHTML = `<div class="t-title">${esc(title)}</div><div class="t-body">${esc(body)}</div>`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), ms);
  }

  /* ---------------- 渲染：统计 ---------------- */

  function renderStats(p, s) {
    const items = [
      ['原始解析行数', fmtNum(s.rawRows)],
      ['档位过滤后', fmtNum(s.afterTierFilter)],
      ['主榜展示', fmtNum(s.mainShown)],
      ['观察列表命中', `${s.watchlistMatched} / ${(DATA.watchlist || []).length}`],
      ['榜首指数', fmtNum(s.topIndex)],
      ['全榜中位指数', fmtNum(s.medianIndex)],
      ['上次更新', p.fetchedAt ? new Date(p.fetchedAt).toLocaleString('zh-CN', { hour12: false }) : '—'],
    ];
    $('stats').innerHTML = items
      .map(
        ([k, v]) =>
          `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`
      )
      .join('');
    $('topNLabel').textContent = String(s.mainShown);
  }

  /* ---------------- 渲染：主榜 ---------------- */

  function sortedMainRows() {
    const rows = (DATA.mainTop || []).filter((r) => {
      if (!searchText) return true;
      const hay = `${r.name} ${r.base} ${r.creator} ${r.tier}`.toLowerCase();
      return hay.includes(searchText);
    });
    const { key, dir } = mainSort;
    const val = (r) => {
      switch (key) {
        case 'rank': return r.rank;
        case 'index': return r.index ?? -1;
        case 'cost': return r.cost ?? 1e9;
        case 'vpd': return r.vpd ?? -1;
        case 'tps': return r.tps ?? -1;
        case 'ttft': return r.ttft ?? 1e9;
        default: return String(r[key] ?? '').toLowerCase();
      }
    };
    return rows.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
  }

  function mainRowHtml(r, displayRank) {
    const hl = r.highlighted ? ' class="hl"' : '';
    const swatch = r.color
      ? `<span class="swatch" style="background:${esc(r.color)}"></span>`
      : '';
    const link = r.url
      ? `<a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.base)}</a>`
      : esc(r.base);
    const tierText = r.tier === 'default' ? '' : esc(r.tier);
    const orig = r.origRank && r.origRank !== displayRank
      ? ` <span class="orig">原 #${r.origRank}</span>` : '';
    return `<tr${hl}>
      <td class="num rank ${displayRank <= 3 ? 'top' : ''}">${displayRank}</td>
      <td><div class="model-cell">${swatch}${starBtn(r)}<span class="model-name">${link}${
        r.highlighted ? ' <span class="badge">高亮</span>' : ''
      }${orig}</span></div></td>
      <td><span class="tier t-${esc(r.tier)}">${tierText || '<span class="dim">单档</span>'}</span></td>
      <td class="creator">${esc(r.creator)}</td>
      <td class="num strong">${fmtNum(r.index)}${r.estimated ? '<span class="dim">*</span>' : ''} ${deltaHtml(r.delta, r.isNew)}</td>
      <td class="num">${fmtCost(r.cost)}</td>
      <td class="num vpd">${fmtVpd(r.vpd)}</td>
      <td class="num">${fmtTps(r.tps)}</td>
      <td class="num hide-sm">${fmtSec(r.ttft)}</td>
      <td class="hide-sm dim">${esc(r.context || '—')}</td>
    </tr>`;
  }

  function renderMain() {
    const rows = sortedMainRows();
    mainBody.innerHTML = rows.map((r, i) => mainRowHtml(r, i + 1)).join('');
    $('mainEmpty').classList.toggle('hidden', rows.length > 0);
    $('rowCount').textContent = searchText
      ? `匹配 ${rows.length} / ${(DATA.mainTop || []).length}`
      : `共 ${(DATA.mainTop || []).length} 条`;
  }

  /* ---------------- 渲染：观察列表 ---------------- */

  function sortedWatchRows() {
    const rows = (DATA.watchlist || []).slice();
    const { key, dir } = watchSort;
    const val = (r) => {
      if (r.missing) return key === 'index' ? -1 : '';
      switch (key) {
        case 'index': return r.index ?? -1;
        case 'cost': return r.cost ?? 1e9;
        case 'vpd': return r.vpd ?? -1;
        case 'tps': return r.tps ?? -1;
        case 'rank': return r.rank ?? 1e9;
        default: return String(r[key] ?? '').toLowerCase();
      }
    };
    return rows.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
  }

  function watchRowHtml(r) {
    if (r.missing) {
      return `<tr class="watch-missing">
        <td>${esc(r.pattern)}</td>
        <td colspan="7">未匹配到 —— 模型可能已改名，请在 config.json 的 watchlist 中修正</td>
      </tr>`;
    }
    const swatch = r.color ? `<span class="swatch" style="background:${esc(r.color)}"></span>` : '';
    const link = r.url
      ? `<a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.name)}</a>`
      : esc(r.name);
    const fam = r.familySize ? `该家族共 ${r.familySize} 个档位` : '';
    return `<tr${r.highlighted ? ' class="hl"' : ''}>
      <td>${esc(r.pattern)}</td>
      <td><div class="model-cell">${swatch}${starBtn(r)}<span class="model-name">${link}${
        r.inMain ? ' <span class="badge inmain">主榜内</span>' : ''
      }${r.highlighted ? ' <span class="badge">高亮</span>' : ''}</span></div>${
        fam ? `<span class="orig">${fam}</span>` : ''
      }</td>
      <td><span class="tier t-${esc(r.tier)}">${esc(r.tier)}</span></td>
      <td class="num rank">${r.origRank ? '#' + r.origRank : '—'}</td>
      <td class="num strong">${fmtNum(r.index)}${r.estimated ? '<span class="dim">*</span>' : ''}</td>
      <td class="num">${fmtCost(r.cost)}</td>
      <td class="num vpd">${fmtVpd(r.vpd)}</td>
      <td class="num">${fmtTps(r.tps)}</td>
      <td>${deltaHtml(r.delta, r.isNew)}</td>
    </tr>`;
  }

  function renderWatch() {
    watchBody.innerHTML = sortedWatchRows().map(watchRowHtml).join('');
  }

  /* ---------------- 状态栏 / 头部 ---------------- */

  function renderStatus(p) {
    const dot = $('statusDot');
    dot.className = 'dot ' + (p.ok ? (p.stale ? 'stale' : 'ok') : 'err');
    let text;
    if (!p.ok) {
      text = '暂无数据';
    } else if (p.fromSeed) {
      text = `首次运行 · 兜底数据（${relTime(p.fetchedAt)}）`;
    } else if (p.stale) {
      text = `已 ${relTime(p.fetchedAt)}更新 · 偏旧`;
    } else {
      text = `更新于 ${relTime(p.fetchedAt)}${p.hasPrevious ? ' · 含变化对比' : ''}`;
    }
    $('statusText').textContent = text;
    $('staleBanner').classList.toggle('hidden', !(p.ok && p.stale));
    if (p.ok && p.stale) {
      $('staleHours').textContent = String(Math.round(p.ageHours));
    }
  }

  /* ---------------- 数据加载 ---------------- */

  async function loadData() {
    try {
      const res = await fetch('/api/data', { cache: 'no-store' });
      const p = await res.json();
      if (!p.ok) throw new Error(p.error || '接口返回异常');
      DATA = p;
      renderStatus(p);
      renderStats(p, p.stats);
      renderMain();
      renderWatch();
      renderHlUi();
      $('errorBanner').classList.add('hidden');
    } catch (err) {
      $('statusDot').className = 'dot err';
      $('statusText').textContent = '加载失败';
      showError(String(err.message || err));
    }
  }

  function showError(msg) {
    const el = $('errorBanner');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  async function updateData() {
    const btn = $('updateBtn');
    btn.disabled = true;
    btn.classList.add('loading');
    $('updateLabel').textContent = '更新中…';
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      const p = await res.json().catch(() => ({}));
      if (!res.ok || !p.ok) throw new Error(p.error || `HTTP ${res.status}`);
      DATA = p;
      renderStatus(p);
      renderStats(p, p.stats);
      renderMain();
      renderWatch();
      renderHlUi();
      toast(
        'ok',
        '更新完成',
        `解析 ${p.rowCount} 行 · 主榜 ${p.stats.mainShown} 条 · 耗时 ${((p.updateMs || 0) / 1000).toFixed(1)}s`
      );
    } catch (err) {
      showError(String(err.message || err));
      toast('err', '更新失败', String(err.message || err), 7000);
      loadData(); // 回显当前服务端仍持有的数据
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
      $('updateLabel').textContent = '更新数据';
    }
  }

  /* ---------------- 高亮管理 ---------------- */

  const currentHighlights = () =>
    Array.isArray(DATA && DATA.highlight) ? DATA.highlight.slice() : [];

  function renderHlUi() {
    const list = currentHighlights();
    $('hlCount').textContent = String(list.length);
    $('hlBtn').classList.toggle('active', list.length > 0);
    $('hlChips').innerHTML = list.length
      ? list
          .map(
            (h) =>
              `<span class="chip"><span>${esc(h)}</span>` +
              `<button data-hl="${esc(h)}" title="移除 ${esc(h)}" type="button">×</button></span>`
          )
          .join('')
      : '<span class="hint">暂无高亮关键字。点表格里的 ☆，或在下方输入添加。</span>';
  }

  async function setHighlights(list) {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ highlight: list }),
      });
      const p = await res.json().catch(() => ({}));
      if (!res.ok || !p.ok) throw new Error(p.error || `HTTP ${res.status}`);
      await loadData();
      toast('ok', '高亮已更新', list.length ? list.join('、') : '已清空全部高亮');
    } catch (err) {
      showError(String(err.message || err));
      toast('err', '高亮更新失败', String(err.message || err));
    }
  }

  function toggleHighlight(base) {
    const list = currentHighlights();
    const has = list.some((h) => norm(h) === norm(base));
    setHighlights(has ? list.filter((h) => norm(h) !== norm(base)) : [...list, base]);
  }

  /* ---------------- 事件绑定 ---------------- */

  $('updateBtn').addEventListener('click', updateData);

  $('searchBox').addEventListener('input', (e) => {
    searchText = e.target.value.trim().toLowerCase();
    renderMain();
  });

  document.querySelectorAll('thead th').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      const table = th.closest('table').id;
      if (table === 'mainTable') {
        if (mainSort.key === key) mainSort.dir *= -1;
        else mainSort = { key, dir: key === 'name' || key === 'creator' || key === 'tier' || key === 'context' ? 1 : -1 };
        th.closest('thead').querySelectorAll('th').forEach((x) => x.classList.remove('sorted-asc', 'sorted-desc'));
        th.classList.add(mainSort.dir === 1 ? 'sorted-asc' : 'sorted-desc');
        renderMain();
      } else {
        if (watchSort.key === key) watchSort.dir *= -1;
        else watchSort = { key, dir: key === 'name' || key === 'pattern' || key === 'tier' ? 1 : -1 };
        th.closest('thead').querySelectorAll('th').forEach((x) => x.classList.remove('sorted-asc', 'sorted-desc'));
        th.classList.add(watchSort.dir === 1 ? 'sorted-asc' : 'sorted-desc');
        renderWatch();
      }
    });
  });

  // 「x 分钟前」定时刷新（只刷文案，不重新抓数据）
  setInterval(() => {
    if (DATA) renderStatus(DATA);
  }, 30000);

  // ---------- 高亮面板 ----------
  $('hlBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = $('hlPanel');
    const open = panel.classList.toggle('hidden') === false;
    $('hlBtn').setAttribute('aria-expanded', String(open));
    if (open) $('hlInput').focus();
  });

  // 点面板/按钮之外收起
  document.addEventListener('click', (e) => {
    const panel = $('hlPanel');
    if (panel.classList.contains('hidden')) return;
    if (panel.contains(e.target) || $('hlBtn').contains(e.target)) return;
    panel.classList.add('hidden');
    $('hlBtn').setAttribute('aria-expanded', 'false');
  });

  $('hlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('hlInput').value.trim();
    if (!v) return;
    const list = currentHighlights();
    if (list.some((h) => norm(h) === norm(v))) {
      toast('err', '已存在', `「${v}」已经在高亮列表里`);
      return;
    }
    setHighlights([...list, v]);
    $('hlInput').value = '';
  });

  $('hlChips').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-hl]');
    if (!btn) return;
    setHighlights(currentHighlights().filter((h) => h !== btn.dataset.hl));
  });

  // 两个表格里的 ☆/★（事件委托，渲染后依然有效）
  document.querySelectorAll('tbody').forEach((tb) =>
    tb.addEventListener('click', (e) => {
      const btn = e.target.closest('button.star');
      if (!btn) return;
      toggleHighlight(btn.dataset.base);
    })
  );

  loadData();
})();
