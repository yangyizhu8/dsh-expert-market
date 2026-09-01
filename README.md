# dsh-expert-market · DSH 专家市场

[English](#english) | [中文](#中文)

<a id="english"></a>

## English

**Expert Market for DeepSeek Harness (dsh)** — the WorkBuddy expert/expert-team system, ported 1:1 onto dsh's native agent-preset mechanics with zero kernel changes.

Installing an **expert** generates a real dsh **agent preset** (persona file, capability restrictions, skills, team delegation tools) through line-level composition surgery with a loader-dialect read-back gate. Experts appear in the new-session preset picker and run as first-class agent presets.

```sh
dsh plugin --profile web add dsh-expert-market
```

### Highlights

- **425-expert official catalog, install on demand** — browse the WorkBuddy expert center (12+ industries, curated picks, expert teams) in the built-in market page at `/api/expert-market`; installing one downloads its persona + avatars from the public CDN, then generates the preset locally.
- **Two curated experts ship enabled by default** — the finance team 腾讯自选股股票投研专家团 (multi-analyst stock research team) and the content-creation expert 腾讯云知（乐享）(PPT creation). Delete them in the market page if you don't need them.
- **Capability subtraction** — experts declare baseline rows to disable/enable (`tool-web`, `planning`, delegation, …) via a `dsh` block in `plugin.json`; the generator applies them to the preset composition, so "a local-docs expert with no web and no plan mode" is one line of metadata.
- **Opening convention & quick prompts** — a conditional first-turn greeting (self-intro + init question only when the first message carries no task) and in-composer quick-prompt chips that fill (never auto-send) the input box.
- **Expert teams** — each member ships as its own delegation tool (`delegate_researcher`, …) whose persona is the member's own MD; the lead orchestrates via hard routing rules.
- **Safety posture** — expert packages are prompt-content only (executables are rejected anywhere in a package; shell scripts only under `skills/<name>/scripts/`); the only executable an installed expert preset carries is the market's own zero-dependency persona plugin; installs never execute package content.

### Use

- Market page: `http://127.0.0.1:3080/api/expert-market` (browse / search / category chips / detail with capability chips / install / uninstall).
- In a session: pick an expert preset (or use the new-session chip), open with a greeting or a task.
- Programmatic: `POST /api/expert-market/api/install` `{marketplace: official|workbuddy-remote, expert: <dirName>}`; uninstall with `keepPackage=true` to keep the package on disk.
- Create your own experts with the companion skill `expert-manager` (installed to `~/.dsh/skills/expert-manager/`).

### Notes

- The remote catalog metadata comes from WorkBuddy's public expert center; expert text/avatars are fetched from its public CDN at install time and remain the property of their authors — for interoperability and personal use.
- Presets are cheap: uninstalling an expert never touches running sessions, and packages stay on disk for one-click reinstall.

<a id="中文"></a>

## 中文

**DeepSeek Harness（dsh）专家市场** — WorkBuddy 专家/专家团体系 1:1 移植，构建在 dsh 原生 agent-preset 机制上，零内核改动。

安装一个**专家** = 通过逐行组合手术（带 loader 方言回读断言）生成一个真实的 dsh **agent preset**（人格文件、能力裁剪、技能、团队委派工具）。专家直接出现在新会话的 preset 选择器中，作为一等公民运行。

```sh
dsh plugin --profile web add dsh-expert-market
```

### 特性

- **425 个官方专家目录，按需安装** — 内置市场页 `/api/expert-market` 可浏览 WorkBuddy 专家中心（12+ 行业、官方精选、专家团）；点安装才从公共 CDN 下载人格与头像，并在本地生成 preset。
- **默认内置 2 个精选专家** — 金融类「腾讯自选股股票投研专家团」（多分析师投研团队）与内容创作类「腾讯云知（乐享）」（PPT 创作）；不需要可在市场页删除。
- **能力减法声明** — 专家通过 `plugin.json` 的 `dsh` 块声明基线裁剪/开启（`tool-web`、`planning`、委派等），生成期写入 preset 组合——"无联网无计划模式的本地文档专家"就是一行元数据。
- **开场约定与快捷提示词** — 条件化首轮开场（首条消息无任务时才自我介绍+抛 init 问题）+ 输入区快捷 chip（点击回填，绝不代发）。
- **专家团** — 每个成员是独立委派工具（`delegate_researcher`…），成员人格即成员 MD；lead 按硬性路由规则编排。
- **安全姿态** — 专家包只允许提示词内容（可执行文件全包拒绝；脚本仅限 `skills/<name>/scripts/`）；安装产物中唯一可执行是市场自带零依赖 persona 插件；安装过程永不执行包内容。

### 使用

- 市场页：`http://127.0.0.1:3080/api/expert-market`（浏览/搜索/行业筛选/详情能力 chips/安装/卸载）。
- 会话内：新会话选专家 preset，打招呼或直接派任务。
- 编程接口：`POST /api/expert-market/api/install`；卸载带 `keepPackage=true` 可保留包以便一键重装。
- 用伴随技能 `expert-manager`（自动装到 `~/.dsh/skills/expert-manager/`）创建你自己的专家。

### 说明

- 远程目录元数据来自 WorkBuddy 公开专家中心；专家文本与头像在安装时从其公共 CDN 获取，版权归原作者——用于互操作与个人使用。
- preset 很轻：卸载专家绝不影响进行中的会话；包保留在盘上，可一键重装。

## License / 许可

Plugin code: MIT. Bundled WorkBuddy expert text/avatars: property of their respective authors (Tencent WorkBuddy public expert center), redistributed for interoperability; contact the maintainers for removal requests. / 插件代码 MIT；内置的 WorkBuddy 专家文本/头像版权归原作者所有，为互操作目的分发，如有侵权请联系维护者处理。
