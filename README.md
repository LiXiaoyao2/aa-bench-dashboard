# AA Benchmark 定制榜单

定制化的 **Artificial Analysis Intelligence Index** 排行榜看板：按自己的规则过滤档位、取前 N 名，外加一份自选的「性价比观察列表」，一键更新数据。

零依赖 —— 只有 Node.js（>= 18），不需要 `npm install`。

```bash
cd /home/lin/code/aa-bench-dashboard
node server.js            # 或 npm start
# 打开 http://localhost:8787
```

---

## 功能

| 功能 | 说明 |
|---|---|
| 档位过滤 | AA 榜单同一模型有 `max / xhigh / high / medium / low / non-reasoning` 多个变体，默认**只保留 `max` 和 `high`**，没有这两档的家族**整条移除**（单档位模型如 `Step 5 Preview`、`MiMo-V2.6-Pro` 保留） |
| 主榜 Top N | 档位过滤**之后**再取前 50 名重新编号，同时显示 AA 原始榜位次（`原 #30`） |
| 性价比观察列表 | 自选模型恒定展示，**忽略档位过滤**，自动挑该家族的最高档；与主榜重复时打 `主榜内` 标记 |
| 高亮 | 顶栏「★ 高亮」按钮：面板里增删关键字、点表格里的 ☆ 快捷开关；命中行整行高亮 + ★ + 徽标，写入 `config.json` 持久化 |
| 性价比列 | `智能指数 ÷ 单任务成本`（分/$），点击表头可排序 |
| 更新数据按钮 | 重新抓取 AA 榜单 → 解析 → 落盘 → 页面刷新；失败时保留旧数据并提示 |
| ▲▼ 变化对比 | 每次更新前把当前快照转存为 `previous.json`，下次渲染时算指数差；新模型标 `NEW` |
| 其他 | 模型名/厂商搜索、点击表头排序、数据超时预警（默认 72h）、关键模型高亮（Step 5） |

## 目录结构

```
aa-bench-dashboard/
├── server.js            # 单文件后端：抓取 + 解析 + 过滤 + HTTP 服务 + API
├── config.json          # 所有规则配置（改这个就行，不用动代码）
├── package.json         # 仅 scripts，无 dependencies
├── public/
│   ├── index.html       # 页面骨架
│   ├── style.css        # 暗色主题
│   └── app.js           # 渲染 / 排序 / 搜索 / 更新按钮
├── tools/
│   └── build-seed.mjs   # 重新生成 data/seed.json（自带兜底数据）
└── data/
    ├── seed.json        # 随仓库的兜底数据（首次运行自动初始化，不依赖外网）
    ├── latest.json      # 当前快照（每次更新覆盖）
    ├── previous.json    # 上一次快照（用于 ▲▼ 对比）
    └── raw/             # 历史快照归档，每次更新存一个带时间戳的文件
```

## 配置（config.json）

```jsonc
{
  "port": 8787,                  // 也可用 node server.js --port 8790 或 PORT=8790
  "sourceUrl": "https://artificialanalysis.ai/leaderboards/models",
  "topN": 50,                    // 主榜取前多少名（档位过滤后）
  "allowedTiers": ["max", "high", "default"],  // 保留哪些档位；default = 无档位后缀的单档模型
  "tierOrder": ["max", "high", "xhigh", "medium", "low", "non-reasoning", "default"], // 观察列表挑“最高档”的顺序
  "staleHours": 72,              // 数据超过多少小时算过期并预警
  "highlight": ["Step 5"],       // 高亮关键字：命中即整行高亮 + ★ + 徽标（也可在页面「★ 高亮」按钮里随时增删）
  "watchlist": [                 // 观察列表，忽略大小写和 -/_ 差异，如 "Ling 3.1 Flash" 能匹配 "Ling-3.1-Flash"
    "Qwen3.8 27B",
    "DeepSeek V4.1 Flash",
    "MiMo-V2.6-Pro"
  ]
}
```

改完 `config.json` 后**刷新页面即可生效**（档位 / 高亮规则在每次请求时实时计算，只有抓取数据才需要点更新）。

### 高亮怎么用

1. 点顶栏 **「★ 高亮 N」** 打开面板：当前所有关键字以芯片展示，点芯片上的 `×` 移除；
2. 输入框填模型名关键字（如 `Qwen3.8`、`DeepSeek`、`Claude`），回车或点「添加」；
3. 或者直接点表格模型名左边的 **☆ / ★** 快捷开关（主榜和观察列表都支持）；
4. 修改立即生效并写回 `config.json`，刷新 / 重启都不丢。

匹配规则与观察列表一致：忽略大小写和 `-` / `_` / 空格差异，所以 `step5`、`Step 5`、`GLM 5.3` 都能命中 `Step 5 Preview`、`GLM-5.3`。一个关键字可能同时命中多行（如 `Qwen3.8` 会同时点亮 `Qwen3.8 Max`、`Qwen3.8 27B`、`Qwen3.8-Flash-Next`）。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/data` | 当前榜单视图（主榜 + 观察列表 + 统计 + 当前高亮） |
| POST | `/api/update` | 触发一次抓取更新（并发点击会返回 409） |
| GET | `/api/status` | `updating` / `fetchedAt` / 行数 |
| GET | `/api/config` | 当前配置（highlight / watchlist / topN） |
| POST | `/api/config` | 在线修改高亮，body：`{"highlight":["Step 5","Qwen3.8"]}`；原子写回 `config.json` |

## 口径说明（重要）

- 排名依据是 **AA 智能指数**，这是一个综合分（AA-Briefcase、GDPval-AA、AutomationBench、Terminal-Bench 4.0、SciCode、HLE、GDP.pdf、CritPt、AA-Omniscience、AA-LCR 等 10 项评测加权）。
- 「原 #N」是模型在 **AA 完整榜单**（含所有档位、共约 265 行）中的位置；表格最左边的 `#` 是过滤档位后的名次，两者不同是正常的。
- 成本是 AA 实测「跑完一个指数任务」的平均花费，速度/延迟是 AA 实测的 API 表现，都随 AA 页面更新。
- 若 AA 改版导致解析失败，服务会保留旧数据并在页面上报错；此时检查 `server.js` 的解析规则（正则匹配 `font-semibold border-l-4 pl-2` 的行）。

## 常见问题

**端口被占用**：`node server.js --port 8790`（或 `PORT=8790 node server.js`）。

**更新失败 / 保留旧数据**：AA 偶发限流或改版。可重试；持续失败就看服务端日志里的错误信息。

**想加自己的模型到观察列表**：编辑 `config.json` 的 `watchlist`，写法随意（`Qwen3.8 27B`、`qwen3-8-27b`、`MiMo V2.6 Pro` 都能匹配），没匹配上会在表格里提示「未匹配到」。

**想导出当前数据**：`data/latest.json` 就是完整结构化数据（265 行原始解析结果），`data/raw/` 里有历史归档，可直接拿去做 diff。
