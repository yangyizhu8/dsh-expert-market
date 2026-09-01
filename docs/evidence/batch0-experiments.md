# 批次 0 实验报告 — dsh-expert-market

日期：2026-08-31 · 执行：本会话（审计方转实施）· 基线：standard preset `cb98756a…37f0`（apps/cli/config/agent-presets/standard/agent.cordis.yml）

## 实锤 1：persona 原位替换 mount — PASS

- 产物：`~/.dsh/.agent-presets/expert-0test/`（由 scripts/generate-preset.mjs 文本手术生成，persona 行原位替换为 `./expert-persona.js`）
- 通道：`agentPresets.standingKeyFor('expert-0test')` → 真实 `mountPreset`（loader 导入/行激活审计/根 realm 泄漏审计全链路）
- 结果：挂载成功，scopeKey `{"agentPreset":"expert-0test"}`
- 断言（systemPrompt.assemble({scope})）：
  - `deployment:persona` 段数量 = **1**（重复注册会在 NamedEntries.insert 抛错 → 挂载成功即证明单段）
  - 段文本含专家 MD 标记「批次0实验专家」= true（promptFile 读取生效）
  - 段文本含 `{{model}}`/`{{cwd}}` 原文占位符 = true；assembly.variables 含 model/cwd —— 插值由渲染层（renderPrompt）严格解析
- **关键实现发现（批次0 价值证明）**：相对行 `./expert-persona.js` 的行级加载由 mount.ts 的裸名重载解析（harness base），但插件模块**内部的 import 走标准 Node 解析**——preset 目录向上无 node_modules，`@deepseek-ai/schemastery`/`@deepseek-ai/dsh-system-prompt` 均不可达（实验第一次挂载即失败）。**修正：expert-persona.js 零裸名导入**（仅 node: 内置），PERSONA_SECTION/PERSONA_ORDER 以字面量内联并注明来源同步约束。第二次挂载通过。
- 推论：批次 1 服务半侧对外置专家包的任何"自带 JS 行"都不可能依赖 npm 依赖——专家 preset 的全部可执行面收敛到市场本体提供的零依赖插件，与 §5 信任收敛一致。

## 实锤 2：group 行级 disabled 子树行为 — PASS（免递归）

- 手术：`delegation` 组行（isolate.workflowEngine realm，内含 tool-subagent/tool-subagent-fork/workflow-worker-thread/tool-workflow/tool-ralph 等子行）直接 `disabled: true`
- 结果：**整组子行未注册** —— scoped tools 视图中 `subagent`/`subagent_fork`/`subagent_codex`/`subagent_claude_code`/`workflow`/`ralph` 全部缺席；standard 其余 112 工具完整（read/write/edit/glob/grep/skill/todo_write/ask_user_question 等在位；tool-bash/pwsh 的 !!js 平台条件式在手术中字节级保留并正常求值）
- 结论：生成器**无需递归子行**，组行 disabled 即完整减法；`tool-web` 简单行 disable 亦通过（web_search/fetch_page 缺席）

## 实锤 3：tool-subagent spawn 参数 — 结论：增强形态改道「成员独立 tool 行」

- 模型可见参数 schema 全集 = `{description, prompt, run_in_background}`（tool-subagent/src/index.ts L307-326）；**无 preset/persona 参数**——persona/toolFilter/maxDepth 均为行 config 静态配置
- spawn 请求字段全集（subagent/src/descriptor.ts L136）含 persona/outputSchema/toolFilter/maxDepth，但均为**行 config 传入**；子代理组合继承 = `composeFrom`（child-agent.ts L168，加入父 preset 同一 standing composition）
- **「出程子代理指定成员独立 preset」无原生通道 → 按批次 0 出口条件判定不采用**
- **增强形态替代（宿主同款机制）**：每个成员一条独立 tool-subagent 行——`{ id: expert-team-<member>, name: '@deepseek-ai/dsh-tool-subagent', config: { provider: spawn, toolName: delegate_<member>, persona: <成员MD全文> } }`——发行预设的 codex/claude-code 行即「同包多行不同 toolName」先例；persona 能力由 spawn-in-process provider 原生支持（capabilities.persona=true，子 scope 内 shadow deployment:persona）。lead 获得按成员命名的委派工具，真并行协作，零内核改动。Team MVP（lead MD 内嵌 SOP + fs 读成员 MD）仍为基线，成员独立 tool 行作为批次 3 的增强形态。

## 实锤 4：输入框回填通道 — 待办（进行中）

## 配套 A：!!js 文本手术 + 回读断言 — PASS

- scripts/generate-preset.mjs：行级手术（persona 替换/组行 disable/customSkillDirs 注入），!!js 条件式字节级保留
- 回读门抓到 2 个真实 bug 后放行（门有效）：
  1. collectRows 的 disabled 检测误将组**子行**的 `disabled: true` 归属父行 → 改为只读行直接属性（indent == dashIndent+2）
  2. 无 config: 行的 customSkillDirs 注入落在行级被 schema 丢弃 → 改为补 `config:` 块
- 断言集：行集保持（baseline ⊆ result）、persona 行 name/promptFile、disable 目标 disabled=true、customSkillDirs 精确匹配、其余行 disabled 位零变化、!!js 求值不变

## 配套 B：customSkillDirs 热生效 — PASS

- 生成时注入 `config.customSkillDirs: [<市场目录>/experiments/test-expert/skills]`（指向市场目录，不拷贝）
- `skills.snapshot()` 无参 = global 层 24 技能无 demo-skill；`snapshot({scope: standingKey})` = 35 技能含 **demo-skill**（name/description/invocation/source=custom/resourceBase 全解析，路径直指市场目录）
- scope 层隔离成立：其他 preset 会话不可见；watch 热生效由 skill-filesystem 的 chokidar 同路径覆盖（批次 1 联测）

## 实锤 4：输入框回填通道 — PASS

- `dsh-prompt-enhancer`（生产环境已装）的 EnhanceButton 组件实证官方回填通道：
  - 读：`props.input.draft`（当前输入框草稿）
  - **写：`props.inputActions.setDraft(text)`**（safeSetDraft 封装，生产可用）
  - 挂载：输入区 slots.inject，组件随 slot 渲染
- 结论：quickPrompts chip = 输入区 slot 按钮 + `inputActions.setDraft(quickPrompt 文本)`，用户回车发送。fill-not-send 方案实证可行，零 DOM hack、零协议风险。

## 配套 C：settings.section + server 路由页 — PASS（正式装配通道）

- 产物：`plugins/dsh-expert-market-scaffold`（tsdown 双半部构建：host lib/index.js + client lib/client.js ModuleLoader bundle）
- **host 路由**（经 dev_install_package 正式 profile 装配后验证）：
  - `/api/expert-market/health` → `{"plugin":"@dsh-external/dsh-expert-market","ok":true}` ✓
  - `/api/expert-market` → 市场骨架页，实时列出 expert-0test（`agentPresets.list()` live 发现，`expert-` 前缀过滤）✓
- **client 入口**：`slots.inject('settings.section', () => slots.register({name:'settings.section', id, order:30, label:'专家市场', component}))` —— 与 dsh-prompt-enhancer 生产入口同款写法；bundle 过注入器 client 预校验（ModuleLoader 特征 + inject 声明）。
- **✅ 浏览器目验通过（用户截图确认）**：设置导航出现「专家市场」且内容卡完整渲染。
- **⚠️ 注册契约修正（生产实证）**：settings.section 的组件是 `slots.register(options, ReactComponent)` 的**第二参**（React 函数组件；react 为 bundle external 由页面提供）。把组件放进 options.component 字段会被 shell 忽略——症状即「导航出现、内容空白」（首测截图实锤）。
- **⚠️ 关键环境约束（批次 1 必守）**：super-injector 的 `dev_inject_plugin`（isolate 通道）解析到**影子 webServer 实例**（同 listenedPort 元数据、独立路由表、不服务端口）——apply 正常执行但路由永远 404；`ctx.root` 亦跨不到真树（注入器插件挂在独立 Context 树）。**路由类插件的装配/验证必须走 `dev_install_package`（正式 profile 装配，真树服务）**。正式装配形态下 ctx.get 即根实例，无此问题。

## 环境事实（批次 1 输入）

- 用户 preset 根：`C:\Users\Administrator\.dsh\.agent-presets\`（discovery 每次调用重扫 → 免重启可见，已实测）
- staging 工具通道 args 为 JSON 字符串需自解析；返回值需 JSON.stringify
- 本机无 DEEPSEEK_API_KEY / root .env；模型路由在运行中的 web 实例内配置

## 批次 1 补充验证（同文件归档）

- **settings.section 契约修正**：组件是 `slots.register(options, ReactComponent)` 第二参（React 函数组件）——放进 options.component 被忽略（「导航出现内容空白」截图实锤）。修复后用户截图确认渲染正常。
- **路由 effect 契约修正**：`webServer.register` 的返回值就是注销函数——effect 回调必须直接返回它；写 `() => () => register(...)` 会在 fiber 销毁时**反向重注册**，造成旧 handler 永久残留遮蔽新路由（旧页面 404 幽灵，dev_clear_routes 清表后定位）。
- **市场包内容扫描**：validatePackageContent 放行 .md/.json/.yaml/.yml/.txt/图片；.py/.sh 等仅限 skills/<name>/scripts/；.js/.ts/.exe/.dll 全包拒绝。
- **enable[] Bundle 前置检查**：tool-subagent-codex/claude-code 需 profile 已装对应 Bundle，未装 → 保持 disabled + warning；未知 id 仅 warning。
- **端到端（市场 API 全流程）**：uninstall（preset+包删除、幂等）→ install（内容校验→活基线读取→手术→回读断言→preset 换入→install-log）→ standingKeyFor 真实挂载 → persona 单段+专家标记 ✓、减法 ✓（111 工具）、skills ✓（demo-skill）。
- **baselineHash 语义**：以部署侧活基线为准（与仓库工作区文件 hash 不同属预期——部署 config 与仓库可能版本不同），「基线已演进」提示以此对比。
- **热重载注意**：dev_reload_package 报 failed 可能是重建瞬间快照误报——以 entry fiber 存在性 + 路由实际行为为准；「清缓存 1 模块」只清 index.js，**包内多模块热重载需传 `包目录/lib` 作子串**（清 3 模块）。

## 批次 2 补充验证（同文件归档）

- **市场页全要素**（server 渲染，`/api/expert-market`）：专家/专家团双页签、12 行业分类 chips（占位集，批次 4 可换 WorkBuddy 目录）、综合/最热（install-log 计数）/最新（包 mtime）排序、搜索（名称/描述/标签）、特邀徽章（`dsh.featured`）精选横排、详情页（能力裁剪 chips 带人类可读标签/快捷提示词/开场问题/安装热度/成员列表位）。
- **开场白段**：生成期把 defaultInitPrompt 写入 persona 行 `config.opening`（YAML 块字面量 `|-`，字节安全）；expert-persona.js 注册 `expert:opening` section（order 1），条件化合同（首轮无任务→自我介绍+抛问题；首轮带任务→直接开工）。挂载断言四要素全过。
- **quickPrompts 回填 chip**：客户端注册 `conversation.input.right`（与 prompt-enhancer 同 slot、order 30）；读会话 preset（useSessions hook 优先/host session-chips API 兜底）；命中 `expert-` 前缀即拉取该专家 quickPrompts 渲染 chip；点击 `inputActions.setDraft(text)` 回填输入框（fill-not-send）。host `GET /api/session-chips?sessionId=|preset=` 读 preset 目录 `.expert-meta.json`（安装时固化 quickPrompts/defaultInitPrompt/displayName/profession，浏览器与包扫描解耦）。
- **⚠️ 关键发现——模块缓存与 standing 重挂载**：expert-persona.js 按固定 URL 导入，重装后内容变 URL 不变 → Node ESM 模块缓存命中旧模块，新 standing generation 静默运行旧插件（opening 缺席的根因；run config 已含 opening 但旧 apply 不注册）。**修复：persona 行 specifier 版本化** `./expert-persona.js?v=<sha256 前 8 位>`（market.ts 安装时算内容 hash）——重装后 URL 变化强制新模块，旧 generation 会话继续持用旧 URL 模块，与「活动会话保留原组合」语义完美吻合。assertSurgeryResult 同步断言版本化 specifier。
- **✅ 批次 2 浏览器目验（用户截图×2）**：①开场白条件化合同真实会话完美执行——第一轮自我介绍（`{{model}}`/`{{cwd}}` 插值正确）+抛 init 问题，第二轮「你好」不再重复介绍直接要需求；②三枚 quickPrompts chip 在输入区渲染、点击回填输入框（fill-not-send）。
- **⚠️ chip 排查教训（两层）**：①slot props 形态以生产实证为准（prompt-enhancer：`props.session.sessionId` + `props.inputActions`，contract 文档的 session kit 描述与实际渲染合并形态有出入）；②**会话 preset 解析必须实现 resolveSessionPreset 全语义**——hero-chip 流程先按默认建会话再 blank 窗口内提交 `agent-preset/selected` 事件，header.agentPreset 是创建时旧值，只查 header 会漏掉全部 chip 流程创建的专家会话。

## 批次 3 补充验证（同文件归档）

- **团队包样例**：`expert-0team`（lead=team-lead.md，成员 researcher/reviewer，members 元数据 + team-demo 技能 + featured）。
- **成员独立 tool 行（增强形态定稿）**：每成员一条 `tool-subagent` 行（`provider: spawn`、`toolName: delegate_<memberAgent 去 member- 前缀>`、`backgroundMode: continuable`、`persona: |-<成员 MD 全文>`）——spawn provider 的 persona 能力在子 scope shadow deployment:persona，发行预设 codex/claude-code 同包多行先例。
- **端到端断言**：挂载 ✓；`delegate_researcher`/`delegate_reviewer` 工具在专家工具目录 ✓（standard 面完整）；team-demo 技能 ✓；lead 人格（含 {{model}}/{{cwd}}）+ opening ✓。
- **回读门再拦一坑**：块字面量 `|-` 剥离尾部换行导致 persona 文本比对失败——断言改为 trimEnd 归一化（语义无损）。
- **BOM 容错**：Windows 编辑器写出的 UTF-8 BOM 会让 JSON.parse 拒绝包元数据——readJson 去 BOM（批次 3 实测命中）。
- **✅ 批次 3 浏览器目验（用户轨迹截图）**：真实 A 股调研任务中团队协作闭环——`delegate_reviewer` 直接调用证据（输入「审校今日A股终稿」，输出「A. 审校结论 修订后可用…」**正是 member-reviewer.md 的「结论/问题/建议」三段格式** = 成员 persona 隔离生效铁证）；`delegate_researcher` 间接证据（Background subagent report + lead「调研员交卷了」+ 会话「4个子代理」计数）；lead 汇总注明成员贡献并按流程交审校终审。
- **首轮未委派的教训**：无硬性纪律时 lead 选择自己干（直接 web_search/TDX）——team-lead.md 改为硬性委派路由规则（检索必 delegate_researcher、交付前必 delegate_reviewer、例外仅纯闲聊）后复测即按纪律执行。团队系统 = 机制 + SOP，WorkBuddy 同理。
- **⚠️ 插件三件套门禁合规（2026-08-31 新纪律）**：check-plugin-ready.mjs 首跑 FAIL——bundle patch 的 insert id（`expert-market`）与插件目录名不匹配；修正为 `dsh-expert-market-scaffold` + 补 `config.marketplacesRoot` 后 1/1 PASS。同时清理 profile patch 中 uninject 时代的 `dsh-expert-market disabled: true` 死条目（退役清四）。

## 批次 4 补充验证（同文件归档）

- **WorkBuddy 目录勘察**：安装目录 = Electron 壳（app.asar 278MB + app.asar.unpacked）；专家数据三层定位——unpacked `resources/builtin-skills/expert-manager/`（**原版 6 Python 脚本 + 4 spec references + 245 行 SKILL.md 完整拿到**）、unpacked `resources/builtin-plugins/.codebuddy-plugin/marketplace.json`（内置市场元数据）、asar 内 `scenes.json/scenes-en.json`（8 个精选场景，design 模式）+ `workbuddy-expert-prompt.tpl` 等 36KB 专家提示词模板。
- **专家市场目录 = 远程**（cos CDN `expert_center.json` + default-avatar.png）——v3 §12 预判成立，本期按方案落本地 JSON。
- **提取通道**：`npx @electron/asar extract-file`（**必须反斜杠相对路径**；正斜杠静默失败）；自研 asar 头解析脚本遇 278MB 大文件超时弃用。
- **落地**：official 市场 `catalog/scenes{,-en}.json` + `assets/*.tpl`；市场页「精选场景（8）」横排（卡片悬浮展示 promptTitles）+ 12 行业目录 1:1 校准（`01-ProductDesign`…`12-IndustryConsultant` 原版 id）。
- **expert-manager skill 升级为原版移植**：245 行 SKILL.md + 6 脚本 + 4 references 全量落 `~/.dsh/skills/expert-manager/`，追加「dsh 适配层」章节（目录映射/前缀强制/能力声明/内容安全/安装 API 生效通道/校验补充/验证清单）——比批次 3 的 API 等价版信息量大一个量级（原版含 plugin-json/agent-md/team/avatar 四份权威规范）。

## 批量导入与按需精简（批次 4 收尾）

- **全量导入（临时插件模式）**：`@dsh-external/dsh-expert-importer` 注入即自动跑批（8 并发下载/4 并发安装，进度落 `~/.dsh/experts/import-state.json`）→ CDN 源头 404 的 181 个专家（目录元数据与 CDN 不同步，腾讯侧下架/未发布，含 5 个 Smb 系列）无法恢复，**243/425 成功导入并全部安装（0 安装失败）**；用完即卸（junction/registry/patch 条目/源码目录四清，零残留）。
- **按类目精简（用户要求：性能负担）**：卸载全部已装 preset（**keepPackage=true，包留盘随装随用**），每类目重装 1 名 winner——选择规则 = 官方精选位（displayPosition）> 腾讯官方作者 > 最新。**教训：trim 脚本 v1 的 slug→catalog 反查全量未命中（原因未明，同逻辑独立脚本命中），导致 245 全卸**——恢复脚本 v2 改为**读包内 plugin.json 元数据**（权威、零反查），13 类目 winner + expert-0team = **最终 14 个 preset**，磁盘 245 包随装随用。
- **保留清单**：11 类目的单专家（调度达/数字生命卡兹克(curation#6)/助推推/律守正/海跨洋/暖心心/单必成/节点通/林正刚 + 腾讯云知）+ 2 个腾讯官方团队（腾讯自选股投研专家团/腾讯云技术支持(curation#6)/RUM 全链路专家团）+ expert-0team 演示。exact per-cat 明细见 `docs/evidence/trim-report.json`。
