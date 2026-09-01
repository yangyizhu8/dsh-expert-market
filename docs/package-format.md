# dsh-expert-market 包格式定稿（批次 1）

版本：1.0（2026-09-01）· 状态：随批次 1 实现冻结；后续演进只加不改

## 1. 市场目录布局

```
<marketplacesRoot>/                        # 缺省 ~/.dsh/experts/marketplaces（Config: marketplacesRoot 可覆盖）
├── <marketplace-id>/                      # 如 official / my-experts
│   ├── .codebuddy-plugin/
│   │   └── marketplace.json               # {"name","title"}（WorkBuddy 兼容字段原样保留）
│   └── plugins/
│       └── <package-dir>/                 # 目录名任意；以 plugin.json 为准
│           ├── .codebuddy-plugin/         # WorkBuddy 原样保留（市场兼容）
│           ├── plugin.json                # 见 §2
│           ├── agents/<agentName>.md      # 主人格（必须）；团队时成员 MD 同目录
│           ├── skills/<name>/SKILL.md     # 可选；经 customSkillDirs 直指本目录（不拷贝，watch 热生效）
│           │   └── scripts/               # 脚本仅允许放这里（§4）
│           └── avatars/                   # 可选；png/jpg/webp/gif
```

## 2. plugin.json（WorkBuddy 1:1 + dsh 扩展块）

WorkBuddy 全字段保留（上游未知字段双向忽略，互通不破坏）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✓ | **即 preset id**，必须匹配 `expert-[a-z0-9][a-z0-9-]*`（前缀强制 + PRESET_ID 正则） |
| `agentName` | string | ✓ | 主人格文件名 stem（`agents/<agentName>.md`），`[a-z0-9-]+` |
| `expertType` | "agent"\|"team" | | 团队见批次 3 |
| `displayName` / `profession` / `displayDescription` / `tags` / `quickPrompts` / `defaultInitPrompt` / `categoryId` | WorkBuddy 1:1 | | zh/en 双语对象；zh 进 preset.yml name/description 与市场卡 |
| `dsh.baseline` | string | | 基线 preset id，缺省 `standard`；安装时必须可解析（fail loud） |
| `dsh.capabilities.disable[]` | string[] | | 基线组合行 id（含组 id）；未命中记 warning（漂移容忍） |
| `dsh.capabilities.enable[]` | string[] | | 仅限**静态** disabled 行；`!!js` 条件行拒绝；产品 provider 行（tool-subagent-codex/claude-code）前置 Bundle 在位检查，未装 → 保持 disabled + warning |

语义约束（v3 §4 定稿）：只减与开基线既有行；专家包新增能力只能来自 skills（shell 审批通道）——**包内禁止一切可执行文件**（§4）。

## 3. 安装产物（preset 目录）

```
~/.dsh/.agent-presets/<name>/             # 用户 preset 根（roster 实时发现，免重启）
├── agent.cordis.yml                      # 基线文本手术产物（回读断言通过才落盘）
├── expert-persona.js                     # 唯一可执行文件，来自市场插件本体 resources/（零裸名导入）
├── agents/                               # 包内 agents/ 全目录拷贝（团队成员 MD 供 lead fs 读取）
├── preset.yml                            # name/displayDescription.zh
└── .expert-meta.json                     # {baselineId, baselineHash, disable[], enable[],
                                          #  personaFile, personaHash, skillsDir, personaMode,
                                          #  displayName, profession, expertType, quickPrompts[],
                                          #  defaultInitPrompt, featured, marketplace,
                                          #  packageName, warnings[], appliedAt}
```

- `persona` 行原位替换，specifier **版本化**：`./expert-persona.js?v=<personaHash 前 8 位>`——重装更新脚本后 URL 变化强制 Node 加载新模块（否则模块缓存让新 standing generation 静默运行旧插件）；旧 generation 会话持用旧 URL 模块，与「活动会话保留原组合」语义吻合。
- `config.opening`（defaultInitPrompt）驱动 expert-persona.js 注册 `expert:opening` section：条件化开场合同（首轮无任务→自我介绍+抛 init 问题；首轮带任务→直接开工不介绍）。
- 重装/升级 = 覆盖目录；**进行中会话保留原组合，新会话生效**（宿主原生语义）。
- `baselineHash` ≠ 当前活基线 hash → 市场页显示「基线已演进，建议重装」。

## 4. 内容安全（v3 §5 定稿）

- 全包任何位置**绝对拒绝**：`.js .ts .mjs .cjs .node .exe .dll`
- `.py .sh .ps1 .bat .cmd` 仅允许 `skills/<name>/scripts/` 内（模型经 shell 审批主动执行；与挂载期自动加载是两种威胁等级）
- 其余放行：`.md .json .yaml .yml .txt .png .jpg .jpeg .webp .gif`
- 安装器对包内容**纯静态解析**（plugin.json/YAML frontmatter/JSON），永不执行包内任何文件（含"探针"脚本）

## 5. 安装摘要与日志

- API 返回 `InstallSummary`：`{ok, presetId, presetDir, baselineId, baselineHash, personaMode, warnings[]}`
- 追加写 `~/.dsh/experts/install-log.jsonl`：`{event: install|uninstall, presetId, marketplace, packageName, baselineId, baselineHash, warnings[], at}`
- 页面 banner 展示摘要；warnings 逐条列出（含 Bundle 前置检查降级、基线漂移容差、已禁用幂等）

## 6. RPC 面（webServer JSON API，批次 2 前端消费）

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| GET | `/api/expert-market` | — | 市场页（服务端渲染，双表 + 表单） |
| GET | `/api/expert-market/health` | — | `{plugin, version, ok}` |
| GET | `/api/expert-market/api/list` | — | `{packages: MarketPackage[], installed: roster[]}` |
| POST | `/api/expert-market/api/install` | `marketplace, expert[, format=json]` | 303 回页 / InstallSummary |
| POST | `/api/expert-market/api/uninstall` | `expert[, marketplace, dirName, keepPackage]` | `{ok, presetRemoved, packageRemoved}` |

## 7. 装配约束（批次 0/1 实证）

- 插件装载走 **profile 正式装配**（dev_install_package / bundles 列表）；super-injector isolate 注入通道解析影子 webServer（路由永不服务端口），路由类插件禁用该通道验证
- `ctx.effect(() => webServer.register(...))` —— register 返回值即注销函数；不可包一层箭头（会在销毁时反向重注册）
- 运行时依赖经 build.sh 链接进插件 node_modules：`@deepseek-ai/cordis-plugin-include`（vendor/include）、`js-yaml`（checkout .pnpm store）、`@types/react`（仅类型）
- expert-persona.js **零裸名导入**（preset 目录无 node_modules 上溯；行级 name 才有 harness base 解析）
