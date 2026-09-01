/**
 * dsh-expert-market — host half.
 *
 * Batch 1: install bridge (scan / install / uninstall over the batch-0
 * surgery pipeline). Batch 2: full market page (featured strip, expert/team
 * tabs, category chips, sort, search, detail view with capability chips,
 * quickPrompts display) plus the session-chips API the input-area chip
 * component consumes.
 *
 * Routes:
 * - GET  /api/expert-market                     — market page
 * - GET  /api/expert-market/health              — health JSON
 * - GET  /api/expert-market/api/list            — scan JSON
 * - GET  /api/expert-market/api/detail          — one package's full card (?marketplace=&expert=)
 * - GET  /api/expert-market/api/session-chips   — quickPrompts for a session (?sessionId= or ?preset=)
 * - POST /api/expert-market/api/install         — {marketplace, expert[, format=json]}
 * - POST /api/expert-market/api/uninstall       — {expert[, marketplace, dirName, keepPackage]}
 */
import type { Context } from 'cordis'
import { MarketService, type AgentPresetsLike, type MarketPackage, type InstallSummary, type PluginJson } from './market.js'
import z from 'schemastery'
import { existsSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ID = 'dsh-expert-market'
const PAGE_PATH = '/api/expert-market'
const HEALTH_PATH = '/api/expert-market/health'

type RouteResponse = {
  writeHead(status: number, headers: Record<string, string>): RouteResponse
  end(body?: string): RouteResponse
}

type RouteHandler = (req: IncomingRequest, res: RouteResponse) => void

interface IncomingRequest {
  url?: string
  on(event: string, listener: (chunk?: Buffer) => void): IncomingRequest
}

type WebServer = {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: RouteHandler }): () => void
}

interface SessionHeaderLike {
  agentPreset?: string
}

type AppContext = Context & {
  webServer?: WebServer
  agentPresets?: AgentPresetsLike
  sessions?: { list(): Array<{ id?: string; header?: SessionHeaderLike }> }
}

declare module 'cordis' {
  interface Context {
    webServer?: WebServer
    agentPresets?: AgentPresetsLike
    sessions?: { list(): Array<{ id?: string; header?: SessionHeaderLike }> }
  }
}

/** Plugin config (deployment-varying choice, no hardcoded root). */
export interface Config {
  /** Marketplaces root; empty resolves to <dshHome>/experts/marketplaces. */
  marketplacesRoot: string
}

export const name = PLUGIN_ID
// webServer is OPTIONAL (headless profiles compose none): the market routes
// and the chips API simply skip. A hard inject would pend forever on
// headless stacks and fail the whole plugin tree (trial-boot finding).
export const inject = []

export const Config = z.object({
  marketplacesRoot: z.string().default(''),
})

interface RosterEntry {
  id: string
  name?: string
  description?: string
  broken?: string
}

/** Human-readable labels for the known capability row ids (detail view). */
const CAPABILITY_LABELS: Record<string, string> = {
  'tool-web': '联网检索',
  planning: '计划模式',
  delegation: '子代理委派',
  'tool-jobs': '后台任务',
  'tool-goal': '目标系统',
  'tool-subagent': '子代理(spawn)',
  'tool-subagent-fork': '子代理(fork)',
  'tool-subagent-codex': 'Codex 子代理',
  'tool-subagent-claude-code': 'Claude Code 子代理',
  'tool-workflow': '工作流编排',
  'tool-ralph': 'Ralph 循环',
  compaction: '上下文压缩',
  'skill-filesystem': '本地技能发现',
  'tool-skill': '技能目录/加载',
  'tool-bash': 'Bash 终端',
  'tool-pwsh': 'PowerShell 终端',
  'tool-fs': '文件系统',
  'tool-todo': '任务清单',
  'tool-ask-user': '用户提问',
}

function capLabel(id: string): string {
  return CAPABILITY_LABELS[id] ?? id
}

function json(res: RouteResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(payload)) })
  res.end(payload)
}

function html(res: RouteResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(Buffer.byteLength(body)) })
  res.end(body)
}

function redirect(res: RouteResponse, location: string): void {
  res.writeHead(303, { location })
  res.end()
}

async function readBody(req: IncomingRequest): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = ''
    req.on('data', (chunk?: Buffer) => { body += chunk === undefined ? '' : String(chunk) })
    req.on('end', () => resolvePromise(body))
    req.on('error', () => rejectPromise(new Error('request stream error')))
  })
}

function escapeHtml(text: unknown): string {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)
}

interface PageState {
  error?: string
  summary?: InstallSummary
}

/**
 * The 12-industry category set, 1:1 from the WorkBuddy expert-manager spec
 * (builtin-skills/expert-manager/SKILL.md, section 行业分类). Category ids
 * are the canonical WorkBuddy categoryId values.
 */
const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'all', label: '全部' },
  { id: '01-ProductDesign', label: '产品设计' },
  { id: '02-Engineering', label: '技术工程' },
  { id: '03-GameSpatial', label: '游戏空间' },
  { id: '04-DataAI', label: '数据智能' },
  { id: '05-MarketingGrowth', label: '营销增长' },
  { id: '06-ContentCreative', label: '内容创作' },
  { id: '07-SalesCommerce', label: '销售商务' },
  { id: '08-FinanceInvestment', label: '金融投资' },
  { id: '09-OperationsHR', label: '运营人力' },
  { id: '10-ProjectQuality', label: '项目质量' },
  { id: '11-SecurityCompliance', label: '法务安全' },
  { id: '12-IndustryConsultant', label: '行业顾问' },
]

function capChips(caps: { disable?: string[]; enable?: string[] } | undefined): string {
  if (caps === undefined) return '<span class="chip none">标准能力</span>'
  const parts: string[] = []
  if (caps.disable?.length) {
    parts.push(...caps.disable.map(id => `<span class="chip off" title="此专家不可用：${escapeHtml(capLabel(id))}">−${escapeHtml(capLabel(id))}</span>`))
  }
  if (caps.enable?.length) {
    parts.push(...caps.enable.map(id => `<span class="chip on" title="此专家额外启用：${escapeHtml(capLabel(id))}">+${escapeHtml(capLabel(id))}</span>`))
  }
  return parts.length > 0 ? parts.join(' ') : '<span class="chip none">标准能力</span>'
}

function pageCss(): string {
  return `
body{font-family:system-ui,sans-serif;margin:0;background:#0f1115;color:#e6e6e6}
.wrap{max-width:1100px;margin:0 auto;padding:24px 20px}
h1{font-size:20px;margin:0 0 4px}
.muted{color:#8b93a1;font-size:13px}
code{font-size:12px;color:#9fb3d1}
a{color:#7aa2ff;text-decoration:none}
table{border-collapse:collapse;width:100%;margin-top:12px}
td,th{border:1px solid #2a2f3a;padding:6px 10px;text-align:left;font-size:13px;vertical-align:top}
th{background:#171b23}
.ok{color:#67c23a}.ok2{color:#67c23a}.bad{color:#e66}.warn{color:#e6a23c}
.banner{border:1px solid #2a2f3a;border-radius:6px;padding:10px 14px;margin:12px 0;font-size:13px}
.banner ul{margin:6px 0 0 18px}
button{background:#2f6fed;color:#fff;border:0;border-radius:5px;padding:4px 12px;font-size:13px;cursor:pointer}
button.ghost{background:transparent;border:1px solid #3a4152;color:#c6cfdd}
form.inline{display:inline;margin:0}
.tabs{display:flex;gap:8px;margin:18px 0 10px}
.tabs a{padding:5px 14px;border:1px solid #2a2f3a;border-radius:16px;font-size:13px;color:#c6cfdd}
.tabs a.active{background:#2f6fed;border-color:#2f6fed;color:#fff}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.chips a{padding:3px 10px;border:1px solid #2a2f3a;border-radius:12px;font-size:12px;color:#9fb3d1}
.chips a.active{background:#22304d;border-color:#2f6fed;color:#cfe0ff}
.chip{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;margin:1px}
.chip.off{background:#3a1f22;color:#f0a8a8}
.chip.on{background:#17301f;color:#8fe3a6}
.chip.none{background:#1c2230;color:#8b93a1}
.featured{display:flex;gap:12px;overflow-x:auto;margin:12px 0;padding-bottom:6px}
.fcard{min-width:220px;border:1px solid #2a2f3a;border-radius:8px;padding:12px;background:#141922}
.fcard .cover{height:72px;border-radius:6px;background:linear-gradient(135deg,#22304d,#17301f);display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:8px}
.fcard b{font-size:14px}
.badge{display:inline-block;background:#5b2f6e;color:#f2c1ff;border-radius:4px;padding:1px 6px;font-size:11px;margin-left:6px}
.search{display:flex;gap:8px;margin:10px 0}
.search input[type=text]{flex:1;background:#141922;border:1px solid #2a2f3a;border-radius:6px;color:#e6e6e6;padding:7px 10px;font-size:13px}
.card{border:1px solid #2a2f3a;border-radius:8px;padding:16px;background:#141922;margin-top:12px}
.card h3{margin:0 0 4px;font-size:16px}
.kv{font-size:13px;margin:4px 0}
.kv b{color:#9fb3d1;font-weight:500}
.back{font-size:13px}
`
}

interface ViewParams {
  tab: string
  cat: string
  sort: string
  q: string
  detailMarketplace: string
  detailExpert: string
}

function parseView(url: string | undefined): ViewParams {
  const u = new URL(url ?? '/', 'http://dsh.internal')
  return {
    tab: u.searchParams.get('tab') === 'teams' ? 'teams' : 'experts',
    cat: u.searchParams.get('cat') ?? 'all',
    sort: u.searchParams.get('sort') ?? 'default',
    q: u.searchParams.get('q') ?? '',
    detailMarketplace: u.searchParams.get('marketplace') ?? '',
    detailExpert: u.searchParams.get('detail') ?? '',
  }
}

function navUrl(view: ViewParams, overrides?: Partial<Record<'tab' | 'cat' | 'sort' | 'q', string>>): string {
  const merged = { tab: view.tab, cat: view.cat, sort: view.sort, q: view.q, ...overrides }
  const params = new URLSearchParams()
  if (merged.tab !== 'experts') params.set('tab', merged.tab)
  if (merged.cat !== 'all') params.set('cat', merged.cat)
  if (merged.sort !== 'default') params.set('sort', merged.sort)
  if (merged.q !== '') params.set('q', merged.q)
  const query = params.toString()
  return PAGE_PATH + (query === '' ? '' : '?' + query)
}

function installCount(logs: Array<{ event?: string; presetId?: string }>, presetId: string): number {
  return logs.filter(entry => entry.event === 'install' && entry.presetId === presetId).length
}

async function plugin_mtime(market: MarketService, p: MarketPackage): Promise<number> {
  const { stat } = await import('node:fs/promises')
  try {
    return (await stat(market.packageDir(p.marketplace, p.dirName))).mtimeMs
  } catch {
    return 0
  }
}

function renderDetail(market: MarketService, p: MarketPackage, view: ViewParams, driftFlag: boolean | undefined, logs: Array<{ event?: string; presetId?: string }>): string {
  const plugin = p.plugin as PluginJson
  const zh = plugin.displayName?.zh ?? p.dirName
  const caps = plugin.dsh?.capabilities
  const featured = plugin.dsh?.featured === true ? '<span class="badge">特邀</span>' : ''
  const isTeam = plugin.expertType === 'team'
  const members = plugin.members ?? []
  const backUrl = navUrl(view)
  const memberRows = members.map((m) => {
    const mName = m.displayName?.zh ?? m.agentName ?? m.name ?? '?'
    return `<div class="kv"><b>成员</b> ${escapeHtml(mName)}${m.description !== undefined && m.description !== '' ? ` — ${escapeHtml(m.description)}` : ''}</div>`
  }).join('')
  const quickRows = (plugin.quickPrompts ?? []).map(q => `<div class="kv"><b>快捷</b> ${escapeHtml(q.zh ?? q.en ?? '')}</div>`).join('')
  const initRow = plugin.defaultInitPrompt !== undefined && plugin.defaultInitPrompt.zh !== undefined
    ? `<div class="kv"><b>开场问题</b> ${escapeHtml(plugin.defaultInitPrompt.zh)}</div>`
    : ''
  const driftNote = driftFlag === true ? '<div class="kv warn">基线已演进，建议卸载后重新安装以重应用能力裁剪。</div>' : ''
  const action = p.installed
    ? `<form method="post" action="/api/expert-market/api/uninstall" class="inline"><input type="hidden" name="expert" value="${escapeHtml(plugin.name)}"><input type="hidden" name="marketplace" value="${escapeHtml(p.marketplace)}"><input type="hidden" name="dirName" value="${escapeHtml(p.dirName)}"><button type="submit" class="ghost">卸载</button></form> <span class="ok">已安装</span>`
    : `<form method="post" action="/api/expert-market/api/install" class="inline"><input type="hidden" name="marketplace" value="${escapeHtml(p.marketplace)}"><input type="hidden" name="expert" value="${escapeHtml(p.dirName)}"><button type="submit">安装专家</button></form>`
  return `<div class="wrap">
<p class="back"><a href="${escapeHtml(backUrl)}">← 返回市场</a></p>
<div class="card">
<h3>${escapeHtml(zh)}${featured}<span class="badge" style="background:#22304d;color:#9fb3d1">${isTeam ? '专家团' : '专家'}</span></h3>
<div class="kv"><b>id</b> <code>${escapeHtml(plugin.name)}</code> · <b>职业</b> ${escapeHtml(plugin.profession?.zh ?? '—')} · <b>市场</b> ${escapeHtml(p.marketplace)} · <b>安装热度</b> ${installCount(logs, plugin.name)} 次</div>
<div class="kv">${escapeHtml(plugin.displayDescription?.zh ?? '')}</div>
<div class="kv"><b>标签</b> ${(plugin.tags ?? []).map(t => `<span class="chip none">${escapeHtml(t.zh ?? t.en ?? '')}</span>`).join(' ')}</div>
<div class="kv"><b>能力裁剪</b> ${capChips(caps)}</div>
${initRow}
${quickRows}
${memberRows}
${driftNote}
<p style="margin:14px 0 0">${action}</p>
</div>
</div>`
}

async function renderPage(market: MarketService, packages: MarketPackage[], installed: RosterEntry[], drift: Map<string, boolean>, view: ViewParams, logs: Array<{ event?: string; presetId?: string }>, state: PageState): Promise<string> {
  // Detail view short-circuits the list.
  if (view.detailExpert !== '') {
    const target = packages.find(p => p.dirName === view.detailExpert && (view.detailMarketplace === '' || p.marketplace === view.detailMarketplace))
    if (target !== undefined && target.plugin !== undefined && target.parseError === undefined) {
      const driftFlag = target.plugin.name !== undefined ? drift.get(target.plugin.name) : undefined
      return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>专家详情 · DSH 专家市场</title><style>${pageCss()}</style></head><body>${renderDetail(market, target, view, driftFlag, logs)}</body></html>`
    }
  }

  const term = view.q.trim().toLowerCase()
  const inTab = packages.filter((p) => {
    if (p.plugin === undefined || p.parseError !== undefined) return view.tab === 'experts' && term !== '' ? false : false
    const isTeam = p.plugin.expertType === 'team'
    if (view.tab === 'teams' ? !isTeam : isTeam) return false
    if (view.cat !== 'all' && (p.plugin.categoryId ?? 'other') !== view.cat) return false
    if (term !== '') {
      const haystack = [p.plugin.name, p.plugin.displayName?.zh, p.plugin.displayName?.en, p.plugin.displayDescription?.zh, p.plugin.profession?.zh, ...(p.plugin.tags ?? []).map(t => t.zh ?? t.en ?? '')]
        .filter(v => typeof v === 'string').join(' ').toLowerCase()
      if (!haystack.includes(term)) return false
    }
    return true
  })
  const sorted = [...inTab]
  if (view.sort === 'hot') {
    sorted.sort((a, b) => {
      const an = a.plugin?.name !== undefined ? installCount(logs, a.plugin.name) : 0
      const bn = b.plugin?.name !== undefined ? installCount(logs, b.plugin.name) : 0
      return bn - an
    })
  } else if (view.sort === 'new') {
    const mtimes = new Map<string, number>()
    for (const p of sorted) mtimes.set(`${p.marketplace}/${p.dirName}`, await plugin_mtime(market, p))
    sorted.sort((a, b) => (mtimes.get(`${b.marketplace}/${b.dirName}`) ?? 0) - (mtimes.get(`${a.marketplace}/${a.dirName}`) ?? 0))
  }

  const featured = packages.filter(p => p.plugin?.dsh?.featured === true && (p.plugin.expertType === 'team') === (view.tab === 'teams'))
  const featuredHtml = featured.length > 0
    ? `<div class="featured">${featured.map((p) => {
        const cover = '🧠'
        return `<a class="fcard" href="${escapeHtml(navUrl(view, {}))}&marketplace=${encodeURIComponent(p.marketplace)}&detail=${encodeURIComponent(p.dirName)}"><div class="cover">${cover}</div><b>${escapeHtml(p.plugin?.displayName?.zh ?? p.dirName)}</b><span class="badge">特邀</span><div class="muted">${escapeHtml(p.plugin?.profession?.zh ?? '')}</div></a>`
      }).join('')}</div>`
    : ''

  // Featured scenes strip (WorkBuddy scenes.json, extracted to the official
  // marketplace catalog): one card per scene, chips of its prompt titles as
  // a tooltip; the prompts themselves copy on click via copy(promptTitle).
  const scenes = market.readScenes()
  const scenesHtml = scenes.length > 0
    ? `<h2>精选场景（${scenes.length}）</h2><div class="featured">${scenes.map((scene) => {
        const first = (scene.promptTitles ?? [])[0] ?? scene.name
        return `<a class="fcard" title="${escapeHtml((scene.promptTitles ?? []).join(' / '))}" href="${escapeHtml(navUrl(view, {}))}"><div class="cover">${escapeHtml(scene.icon ?? '🎬')}</div><b>${escapeHtml(scene.name)}</b><div class="muted">${escapeHtml(first).slice(0, 40)}…</div></a>`
      }).join('')}</div>`
    : ''

  const packageRows = sorted.map((p) => {
    const name = p.plugin?.name
    const zh = p.plugin?.displayName?.zh ?? p.dirName
    const prof = p.plugin?.profession?.zh ?? ''
    const desc = p.plugin?.displayDescription?.zh ?? ''
    const detailUrl = `${navUrl(view, {})}&marketplace=${encodeURIComponent(p.marketplace)}&detail=${encodeURIComponent(p.dirName)}`
    const status = p.contentProblems.length > 0
      ? '<span class="bad">内容校验问题</span>'
      : p.installed ? '<span class="ok">已安装</span>' : '未安装'
    const action = name !== undefined && !p.installed && p.contentProblems.length === 0
      ? `<form method="post" action="/api/expert-market/api/install" class="inline"><input type="hidden" name="marketplace" value="${escapeHtml(p.marketplace)}"><input type="hidden" name="expert" value="${escapeHtml(p.dirName)}"><button type="submit">安装</button></form>`
      : name !== undefined && p.installed
        ? `<form method="post" action="/api/expert-market/api/uninstall" class="inline"><input type="hidden" name="expert" value="${escapeHtml(name)}"><input type="hidden" name="marketplace" value="${escapeHtml(p.marketplace)}"><input type="hidden" name="dirName" value="${escapeHtml(p.dirName)}"><button type="submit" class="ghost">卸载</button></form>`
        : ''
    const idCell = name === undefined ? escapeHtml(p.dirName) : `${escapeHtml(name)}${drift.get(name) === true ? ' <span class="warn">基线已演进</span>' : ''}`
    const teamMark = p.plugin?.expertType === 'team' ? '<span class="badge" style="background:#22304d;color:#9fb3d1">团</span>' : ''
    return `<tr><td>${escapeHtml(p.marketplace)}</td><td>${idCell}${teamMark}</td><td><a href="${escapeHtml(detailUrl)}">${escapeHtml(zh)}</a> <span class="muted">${escapeHtml(prof)}</span></td><td>${escapeHtml(desc)}</td><td>${capChips(p.plugin?.dsh?.capabilities)}</td><td>${status}</td><td>${action}</td></tr>`
  }).join('\n')

  const expertRows = installed.map((e) => {
    const driftMark = drift.get(e.id) === true ? ' <span class="warn">基线已演进</span>' : ''
    return `<tr><td>${escapeHtml(e.id)}${driftMark}</td><td>${escapeHtml(e.name ?? '')}</td><td>${escapeHtml(e.description ?? '')}</td><td>${e.broken === undefined ? '<span class="ok">ok</span>' : `<span class="bad">broken: ${escapeHtml(e.broken)}</span>`}</td></tr>`
  }).join('\n')

  const banner = state.summary !== undefined
    ? `<div class="banner ok2">已安装 <b>${escapeHtml(state.summary.presetId)}</b>（基线 ${escapeHtml(state.summary.baselineId)} · persona ${escapeHtml(state.summary.personaMode)}）${state.summary.warnings.length > 0 ? `；警告 ${state.summary.warnings.length} 条：<ul>${state.summary.warnings.map((w: string) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '，无警告'}</div>`
    : state.error !== undefined
      ? `<div class="banner bad">失败：${escapeHtml(state.error)}</div>`
      : ''

  const tabUrl = (tab: string): string => navUrl(view, { tab })
  const catChips = CATEGORIES.map((c) => {
    const active = view.cat === c.id
    return `<a class="${active ? 'active' : ''}" href="${escapeHtml(navUrl(view, { cat: c.id }))}">${escapeHtml(c.label)}</a>`
  }).join('')
  const sortChips = [
    { id: 'default', label: '综合' },
    { id: 'hot', label: '最热' },
    { id: 'new', label: '最新' },
  ].map(s => `<a class="${view.sort === s.id ? 'active' : ''}" href="${escapeHtml(navUrl(view, { sort: s.id }))}">${s.label}</a>`).join('')

  return `<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>DSH 专家市场</title><style>${pageCss()}</style></head>
<body><div class="wrap">
<h1>DSH 专家市场</h1>
<p class="muted">安装专家 = 生成 agent preset（文本手术 + 回读断言）；卸载保留进行中会话。根目录：${escapeHtml(market.marketplaceRoot)}</p>
${banner}
<div class="tabs">
<a class="${view.tab === 'experts' ? 'active' : ''}" href="${escapeHtml(tabUrl('experts'))}">专家</a>
<a class="${view.tab === 'teams' ? 'active' : ''}" href="${escapeHtml(tabUrl('teams'))}">专家团</a>
</div>
<div class="search"><form method="get" action="${PAGE_PATH}" class="inline" style="flex:1;display:flex;gap:8px">
<input type="hidden" name="tab" value="${escapeHtml(view.tab)}"><input type="hidden" name="cat" value="${escapeHtml(view.cat)}"><input type="hidden" name="sort" value="${escapeHtml(view.sort)}">
<input type="text" name="q" value="${escapeHtml(view.q)}" placeholder="搜索专家名称 / 描述 / 标签…">
<button type="submit">搜索</button>
</form></div>
<div class="chips">${catChips}</div>
<div class="chips">${sortChips}</div>
${featuredHtml}
${scenesHtml}
<h2>市场包（${sorted.length}）</h2>
<table><tr><th>市场</th><th>preset id</th><th>名称 / 职业</th><th>描述</th><th>能力裁剪</th><th>状态</th><th></th></tr>
${packageRows === '' ? '<tr><td colspan="7">（本页签暂无匹配的专家包）</td></tr>' : packageRows}
</table>
<h2>已安装专家（roster 实时）</h2>
<table><tr><th>preset id</th><th>名称</th><th>描述</th><th>状态</th></tr>
${expertRows === '' ? '<tr><td colspan="4">（暂无）</td></tr>' : expertRows}
</table>
<p class="muted">安装后：新会话选择该专家 preset 即以专家人格对话；能力裁剪随组合生效；会话输入区出现该专家的快捷提示词 chip。</p>
</div></body></html>`
}

interface SessionsLike {
  list(): Array<{ id?: string; header?: SessionHeaderLike }>
}

export function apply(ctx: AppContext, config: Config): void {
  const rootCtx = (ctx as unknown as { root: AppContext }).root
  // Resolve through the process ROOT store — see batch-0 note on injector
  // scope isolation (shadow instances). Under formal profile assembly this
  // is identical to ctx.get.
  const webServer = rootCtx.get('webServer' as never) as WebServer | undefined
  const presets = () => rootCtx.get('agentPresets' as never) as AgentPresetsLike | undefined
  const sessions = (): SessionsLike | undefined => rootCtx.get('sessions' as never) as SessionsLike | undefined
  const market = new MarketService({ marketplacesRoot: config.marketplacesRoot })

  // ── default seed experts (first mount) ──
  // Ship two curated seeds (finance + content-creation category winners).
  // On the first mount where a seed is neither on disk nor in the roster,
  // copy its package from resources/seeds into the official marketplace and
  // run the normal install pipeline. A marker file keeps this to one attempt
  // per seed even if the install keeps failing (no boot-time retry storm).
  const SEEDS = ['expert-stock-partner-team', 'expert-ppt-creation-expert'] as const
  void (async () => {
    const p = presets()
    if (p === undefined) return
    const { mkdir, copyFile, writeFile: wFile } = await import('node:fs/promises')
    const resourcesDir = fileURLToPath(new URL('../resources', import.meta.url))
    for (const slug of SEEDS) {
      try {
        const roster = await p.list()
        if (roster.some(r => r.id === slug)) continue
        const officialPlugins = join(market.marketplaceRoot, 'official', 'plugins')
        const target = join(officialPlugins, slug)
        const seedDir = join(resourcesDir, 'seeds', slug)
        if (!existsSync(seedDir)) continue
        const alreadyStaged = existsSync(join(target, 'plugin.json'))
        const marker = join(target, '.seed-installed')
        if (!alreadyStaged) {
          await mkdir(dirname(target), { recursive: true })
          await cp(seedDir, target, { recursive: true })
        }
        if (existsSync(marker)) continue
        const summary = await market.install(p, 'official', slug)
        await mkdir(dirname(marker), { recursive: true })
        await wFile(marker, JSON.stringify({ installedAt: new Date().toISOString(), baselineHash: summary.baselineHash }), 'utf8')
        ctx.logger?.info?.(`[dsh-expert-market] seed installed: ${slug}`)
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-expert-market] seed ${slug} install failed: ${String((error as Error).message).slice(0, 160)}`)
      }
    }
  })().catch(() => {})

  const readLogs = async (): Promise<Array<{ event?: string; presetId?: string }>> => {
    const { readFile } = await import('node:fs/promises')
    const { join: j } = await import('node:path')
    const { homedir: hd } = await import('node:os')
    const logPath = j(process.env.DSH_HOME || j(hd(), '.dsh'), 'experts', 'install-log.jsonl')
    try {
      return (await readFile(logPath, 'utf8')).split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line) as { event?: string; presetId?: string })
    } catch {
      return []
    }
  }

  if (webServer === undefined) {
    ctx.logger?.warn('[dsh-expert-market] webServer unavailable — routes skipped')
  } else {
    ctx.effect(() => webServer.register({
      kind: 'exact' as const,
      path: HEALTH_PATH,
      handler: (_req, res) => {
        json(res, 200, { plugin: PLUGIN_ID, version: '0.0.1', ok: true })
      },
    }), 'expert-market.health-route')

    ctx.effect(() => webServer.register({
      kind: 'exact' as const,
      path: PAGE_PATH,
      handler: (req, res) => {
        void (async () => {
          const p = presets()
          if (p === undefined) {
            html(res, 200, await renderPage(market, [], [], new Map(), parseView(req.url), [], { error: 'agentPresets service unavailable' }))
            return
          }
          try {
            const view = parseView(req.url)
            const packages = await market.scan(p)
            // Remote catalog entries join as virtual packages
            // (marketplace='workbuddy-remote'); installed = preset exists.
            const rosterEarly = await p.list()
            const rosterIdsEarly = new Set(rosterEarly.map(e => e.id))
            const remote = market.readRemoteCatalog()
            for (const record of remote) {
              const kebab = record.id.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replaceAll(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
              const slug = `expert-${kebab}`
              if (rosterIdsEarly.has(slug)) continue // installed local package already shown
              packages.push({
                marketplace: 'workbuddy-remote',
                dirName: kebab,
                plugin: {
                  name: slug,
                  agentName: record.agentName ?? kebab,
                  expertType: record.expertType ?? 'agent',
                  displayName: record.displayName,
                  profession: record.profession,
                  displayDescription: record.description,
                  description: record.description,
                  tags: record.tags ?? [],
                  quickPrompts: record.quickPrompts ?? [],
                  defaultInitPrompt: record.defaultInitPrompt,
                  categoryId: record.categoryId,
                  author: record.author,
                  members: record.members?.map(m => ({ name: m.id, agentName: m.id, displayName: m.displayName, description: m.profession?.zh })),
                  dsh: { baseline: 'standard', ...(record.id === 'StockPartnerTeam' || record.id === 'PptCreationExpert' ? { featured: true } : {}) },
                },
                parseError: undefined,
                installed: false,
                contentProblems: [],
              })
            }
            const roster = await p.list()
            const installed: RosterEntry[] = roster.filter(e => e.id.startsWith('expert-'))
            const drift = new Map<string, boolean>()
            for (const e of installed) drift.set(e.id, (await market.baselineDrift(p, e.id)) === true)
            // Installed banner: ?installed=<id> after a form install.
            const installedId = new URL(req.url ?? '/', 'http://dsh.internal').searchParams.get('installed')
            const logs = await readLogs()
            const state: PageState = {}
            if (installedId !== null) {
              const pkg = packages.find(x => x.plugin?.name === installedId)
              state.summary = {
                ok: true,
                presetId: installedId,
                presetDir: '',
                baselineId: pkg?.plugin?.dsh?.baseline ?? 'standard',
                baselineHash: '',
                personaMode: 'replaced',
                warnings: [],
              }
            }
            html(res, 200, await renderPage(market, packages, installed, drift, view, logs, state))
          } catch (error) {
            html(res, 500, await renderPage(market, [], [], new Map(), parseView(req.url), [], { error: String((error as Error).message) }))
          }
        })()
      },
    }), 'expert-market.market-route')

    ctx.effect(() => webServer.register({
      kind: 'exact' as const,
      path: PAGE_PATH + '/api/list',
      handler: (_req, res) => {
        void (async () => {
          const p = presets()
          if (p === undefined) {
            json(res, 503, { error: 'agentPresets service unavailable' })
            return
          }
          try {
            const packages = await market.scan(p)
            const roster = await p.list()
            json(res, 200, { ok: true, packages, installed: roster.filter(e => e.id.startsWith('expert-')) })
          } catch (error) {
            json(res, 500, { error: String((error as Error).message) })
          }
        })()
      },
    }), 'expert-market.list-api')

    ctx.effect(() => webServer.register({
      kind: 'exact' as const,
      path: PAGE_PATH + '/api/detail',
      handler: (req, res) => {
        void (async () => {
          const p = presets()
          if (p === undefined) {
            json(res, 503, { error: 'agentPresets service unavailable' })
            return
          }
          try {
            const u = new URL(req.url ?? '/', 'http://dsh.internal')
            const marketplace = u.searchParams.get('marketplace') ?? ''
            const expert = u.searchParams.get('expert') ?? ''
            const packages = await market.scan(p)
            const found = packages.find(x => x.dirName === expert && (marketplace === '' || x.marketplace === marketplace))
            if (found === undefined) {
              json(res, 404, { error: 'package not found' })
              return
            }
            json(res, 200, found)
          } catch (error) {
            json(res, 500, { error: String((error as Error).message) })
          }
        })()
      },
    }), 'expert-market.detail-api')

    ctx.effect(() => webServer.register({
      kind: 'exact' as const,
      path: PAGE_PATH + '/api/session-chips',
      handler: (req, res) => {
        void (async () => {
          try {
            const u = new URL(req.url ?? '/', 'http://dsh.internal')
            const p = presets()
            if (p === undefined) {
              json(res, 200, { ok: true, preset: undefined, quickPrompts: [], defaultInitPrompt: undefined })
              return
            }
            let presetId = u.searchParams.get('preset')
            if (presetId === null) {
              const sessionId = u.searchParams.get('sessionId') ?? ''
              const list = sessions()?.list?.() ?? []
              const session = list.find(s => s.id === sessionId)
              // resolveSessionPreset semantics: header holds the creation-time
              // value, but the hero-chip flow creates sessions on the default
              // and then commits `agent-preset/selected` while blank — the
              // newest selected event is the truth (batch-2 chip debugging).
              presetId = session?.header?.agentPreset ?? null
              const events = (session as { eventsSnapshot?: unknown[] } | undefined)?.eventsSnapshot
              if (events !== undefined && Array.isArray(events)) {
                for (let i = events.length - 1; i >= 0; i--) {
                  const ev = events[i] as { type?: string; data?: { agentPreset?: string } } | undefined
                  if (ev?.type === 'agent-preset/selected') {
                    presetId = ev.data?.agentPreset ?? presetId
                    break
                  }
                }
              }
            }
            if (presetId === null || !presetId.startsWith('expert-')) {
              json(res, 200, { ok: true, preset: presetId, quickPrompts: [], defaultInitPrompt: undefined })
              return
            }
            const meta = await market.presetMeta(p, presetId)
            json(res, 200, {
              ok: true,
              preset: presetId,
              quickPrompts: meta?.quickPrompts ?? [],
              defaultInitPrompt: meta?.defaultInitPrompt,
              displayName: meta?.displayName,
              profession: meta?.profession,
            })
          } catch (error) {
            json(res, 500, { error: String((error as Error).message) })
          }
        })()
      },
    }), 'expert-market.session-chips-api')

    ctx.effect(() => webServer.register({
      kind: 'exact' as const,
      path: PAGE_PATH + '/api/install',
      handler: (req, res) => {
        void (async () => {
          const p = presets()
          if (p === undefined) {
            json(res, 503, { error: 'agentPresets service unavailable' })
            return
          }
          try {
            const body = new URLSearchParams(await readBody(req))
            const marketplace = body.get('marketplace') ?? ''
            const expert = body.get('expert') ?? ''
            if (marketplace === '' || expert === '') throw new Error('marketplace and expert are required')
            // Remote catalog entries: no local package yet — download from the
            // CDN into official/plugins, then run the normal pipeline.
            let summary: InstallSummary
            if (marketplace === 'workbuddy-remote') {
              const kebab = expert.replace(/^expert-/, '')
              const record = market.readRemoteCatalog().find(r => r.id.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replaceAll(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') === kebab)
              if (record === undefined) throw new Error(`remote catalog has no expert matching "${expert}"`)
              summary = await market.installRemote(p, record, expert)
            } else {
              summary = await market.install(p, marketplace, expert)
            }
            if (body.get('format') === 'json') {
              json(res, 200, summary)
            } else {
              redirect(res, PAGE_PATH + '?installed=' + encodeURIComponent(summary.presetId))
            }
          } catch (error) {
            json(res, 400, { error: String((error as Error).message) })
          }
        })()
      },
    }), 'expert-market.install-api')

    ctx.effect(() => webServer.register({
      kind: 'exact' as const,
      path: PAGE_PATH + '/api/uninstall',
      handler: (req, res) => {
        void (async () => {
          const p = presets()
          if (p === undefined) {
            json(res, 503, { error: 'agentPresets service unavailable' })
            return
          }
          try {
            const body = new URLSearchParams(await readBody(req))
            const expert = body.get('expert') ?? ''
            if (expert === '') throw new Error('expert is required')
            const result = await market.uninstall(p, expert, {
              deletePackage: body.get('keepPackage') !== 'true',
              marketplace: body.get('marketplace') ?? undefined,
              dirName: body.get('dirName') ?? undefined,
            })
            json(res, 200, result)
          } catch (error) {
            json(res, 400, { error: String((error as Error).message) })
          }
        })()
      },
    }), 'expert-market.uninstall-api')
  }

  ctx.logger?.info('[dsh-expert-market] batch-2 host half mounted (full market page + session-chips API)')
}
