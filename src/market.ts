/**
 * Expert market service 鈥?scan / install / uninstall (batch 1).
 *
 * - scan: read every marketplace directory's packages statically
 *   (plugin.json only 鈥?never executes package content) and join with the
 *   live roster to mark installed state.
 * - install: validate package content policy, read the live baseline via the
 *   agentPresets service, run the batch-0 text surgery + read-back gate,
 *   then write the preset directory (agents/, expert-persona.js from THIS
 *   plugin's resources, preset.yml, .expert-meta.json) and append the
 *   install log. Overwrites an existing expert preset (upgrade semantics:
 *   live sessions keep their composition, new sessions get the new one).
 * - uninstall: remove the preset through the agentPresets service (its
 *   native semantics: live sessions keep their standing mount), then delete
 *   the market package directory.
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyExpertSurgery,
  assertSurgeryResult,
  validatePackageContent,
  PRESET_ID,
  EXPERT_ID_PREFIX,
  type MemberDelegation,
  type SurgeryPlan,
} from './generator.js'

const MARKET_FILE = join('.codebuddy-plugin', 'marketplace.json')
const PLUGIN_FILE = 'plugin.json'
const PERSONA_PLUGIN_SOURCE = fileURLToPath(new URL('../resources/expert-persona.js', import.meta.url))
const INSTALL_LOG = join('experts', 'install-log.jsonl')

/** Minimal shape of the agentPresets service this plugin consumes. */
export interface AgentPresetsLike {
  list(): Promise<Array<{ id: string; trust: string; path: string; name?: string; description?: string; broken?: string }>>
  read(id: string): Promise<string>
  remove(id: string): Promise<void>
  roots: ReadonlyArray<{ path: string; trust: string }>
}

export interface PluginJson {
  name: string
  agentName: string
  expertType?: 'agent' | 'team'
  displayName?: { zh?: string; en?: string }
  profession?: { zh?: string; en?: string }
  displayDescription?: { zh?: string; en?: string }
  description?: { zh?: string; en?: string }
  author?: { zh?: string; en?: string }
  tags?: Array<{ zh?: string; en?: string }>
  quickPrompts?: Array<{ zh?: string; en?: string }>
  defaultInitPrompt?: { zh?: string; en?: string }
  categoryId?: string
  members?: Array<{ name?: string; agentName?: string; displayName?: { zh?: string; en?: string }; description?: string }>
  dsh?: {
    baseline?: string
    featured?: boolean
    capabilities?: { disable?: string[]; enable?: string[] }
  }
}

export interface MarketPackage {
  marketplace: string
  dirName: string
  plugin: PluginJson | undefined
  parseError: string | undefined
  installed: boolean
  contentProblems: string[]
}

export interface InstallSummary {
  ok: boolean
  presetId: string
  presetDir: string
  baselineId: string
  baselineHash: string
  personaMode: string
  warnings: string[]
  error?: string
}

/** One remote-catalog expert record (WorkBuddy expert_center.json shape). */
export interface RemoteRecord {
  id: string
  categoryId?: string
  displayName?: { zh?: string; en?: string }
  profession?: { zh?: string; en?: string }
  description?: { zh?: string; en?: string }
  promptFile?: string
  avatar?: string
  updatedAt?: string
  defaultInitPrompt?: { zh?: string; en?: string }
  expertType?: 'agent' | 'team'
  agentName?: string
  plugin?: string
  tags?: Array<{ zh?: string; en?: string }>
  quickPrompts?: Array<{ zh?: string; en?: string }>
  author?: { zh?: string; en?: string }
  displayPosition?: number
  members?: Array<{ id: string; displayName?: { zh?: string; en?: string }; profession?: { zh?: string; en?: string }; avatar?: string; promptFile?: string; role?: string }>
}

function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function marketplacesRoot(configured: string): string {
  if (configured !== '') return resolve(configured)
  return join(dshHome(), 'experts', 'marketplaces')
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, 'utf8')
  // Tolerate a UTF-8 BOM: Windows editors commonly emit one and JSON.parse
  // rejects it. (Batch-3: the test package hit exactly this.)
  const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw
  return JSON.parse(text) as unknown
}

/**
 * Product-provider enable targets need their host bundle installed before
 * the enabled row can activate 鈥?a preset cannot supply a host dependency,
 * and a missing one fails the whole session mount (batch-0/audit item).
 * Known product rows carry their bundle names; unknown ids are warned, not
 * refused (the row-id list evolves with the baseline).
 */
const ENABLE_BUNDLE_REQUIREMENTS: Record<string, string[]> = {
  'tool-subagent-codex': ['@deepseek-ai/dsh-subagent-codex'],
  'tool-subagent-claude-code': ['@deepseek-ai/dsh-subagent-claude-code'],
}

function checkEnableBundles(enable: string[], warnings: string[], drops: string[]): void {
  for (const id of enable) {
    const required = ENABLE_BUNDLE_REQUIREMENTS[id]
    if (required === undefined) {
      warnings.push(`enable: "${id}" is not a known product-provider row; if it needs a host bundle, install it first`)
      continue
    }
    const present = required.some(bundle =>
      existsSync(join(dshHome(), 'profiles', 'web', 'node_modules', ...bundle.split('/'))),
    )
    if (!present) {
      warnings.push(`enable: "${id}" needs host bundle ${required.join(' or ')} which is not installed 鈥?row left disabled`)
      drops.push(id)
    }
  }
}

/** List marketplace directory names that carry a marketplace.json. */
async function listMarketplaces(root: string): Promise<string[]> {
  if (!existsSync(root)) return []
  const out: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (existsSync(join(root, entry.name, MARKET_FILE))) out.push(entry.name)
  }
  return out.sort()
}

export interface MarketServiceOptions {
  marketplacesRoot: string
}

export class MarketService {
  private readonly root: string

  constructor(options: MarketServiceOptions) {
    this.root = marketplacesRoot(options.marketplacesRoot)
  }

  get marketplaceRoot(): string {
    return this.root
  }

  /** Absolute path of one market package. */
  packageDir(marketplace: string, dirName: string): string {
    return join(this.root, marketplace, 'plugins', dirName)
  }

  /**
   * Featured scenes from the official marketplace catalog
   * (catalog/scenes.json, 1:1 from the WorkBuddy asar). Empty when absent.
   */
  readScenes(): Array<{ id?: number; name?: string; icon?: string; mode?: string; promptTitles?: string[]; prompts?: string[] }> {
    const path = join(this.root, 'official', 'catalog', 'scenes.json')
    if (!existsSync(path)) return []
    try {
      const raw = readFileSync(path, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? parsed as never : []
    } catch {
      return []
    }
  }

  // ── remote expert-center catalog (WorkBuddy expert_center.json) ──

  /** Path of the bundled remote catalog (shipped in plugin resources). */
  remoteCatalogPath(): string {
    return fileURLToPath(new URL('../resources/expert-center.json', import.meta.url))
  }

  /** Read the bundled remote catalog; empty on any failure. */
  readRemoteCatalog(): RemoteRecord[] {
    const path = this.remoteCatalogPath()
    if (!existsSync(path)) return []
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { experts?: RemoteRecord[] }
      return Array.isArray(parsed.experts) ? parsed.experts : []
    } catch {
      return []
    }
  }

  /** CDN root for remote expert content (promptFile/avatar are root-relative). */
  cdnRoot(): string {
    return 'https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace'
  }

  /**
   * Install one remote-catalog expert: download lead/member MD + avatars from
   * the CDN, write a WorkBuddy-format package into the official marketplace,
   * then run the normal install pipeline (text surgery + read-back gate).
   * `slug` must already carry the `expert-` prefix.
   */
  async installRemote(presets: AgentPresetsLike, record: RemoteRecord, slug: string): Promise<InstallSummary> {
    const dir = join(this.root, 'official', 'plugins', slug)
    if (record.promptFile === undefined) throw new Error(`remote expert ${record.id} has no promptFile`)
    const fetchBuffer = async (url: string, attempts = 2): Promise<Buffer> => {
      let lastError: unknown
      for (let i = 0; i < attempts; i++) {
        try {
          const answer = await fetch(url)
          if (!answer.ok) throw new Error(`HTTP ${answer.status}`)
          return Buffer.from(await answer.arrayBuffer())
        } catch (error) {
          lastError = error
          await new Promise(resolvePromise => setTimeout(resolvePromise, 400 * (i + 1)))
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    }
    const base = this.cdnRoot()
    await mkdir(dir, { recursive: true })
    await mkdir(join(dir, 'agents'), { recursive: true })
    await mkdir(join(dir, '.codebuddy-plugin'), { recursive: true })
    await mkdir(join(dir, 'avatars'), { recursive: true })
    const agentName = record.agentName ?? slug.replace(/^expert-/, '')
    const lead = await fetchBuffer(base + record.promptFile)
    await writeFile(join(dir, 'agents', `${agentName}.md`), lead)
    if (record.avatar !== undefined) {
      try { await writeFile(join(dir, 'avatars', `${record.id}.png`), await fetchBuffer(base + record.avatar)) } catch { /* optional */ }
    }
    for (const member of record.members ?? []) {
      if (member.promptFile === undefined) continue
      const memberMd = await fetchBuffer(base + member.promptFile).catch(() => null)
      if (memberMd === null) continue
      await writeFile(join(dir, 'agents', `${member.id}.md`), memberMd)
      if (member.avatar !== undefined) {
        try { await writeFile(join(dir, 'avatars', `${member.id}.png`), await fetchBuffer(base + member.avatar)) } catch { /* optional */ }
      }
    }
    const pluginJson: PluginJson = {
      name: slug,
      agentName,
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
      ...(record.members !== undefined && record.members.length > 0 ? {
        members: record.members.map(m => ({ name: m.id, agentName: m.id, displayName: m.displayName, description: m.profession?.zh })),
      } : {}),
      dsh: { baseline: 'standard' },
    }
    await writeFile(join(dir, 'plugin.json'), JSON.stringify(pluginJson, null, 1), 'utf8')
    await writeFile(join(dir, '.codebuddy-plugin', 'marketplace.json'), JSON.stringify({ name: 'workbuddy-remote' }), 'utf8')
    return await this.install(presets, 'official', slug)
  }

  /**
   * Scan every marketplace package statically and join with the live roster.
   * Never executes package content.
   */
  async scan(presets: AgentPresetsLike): Promise<MarketPackage[]> {
    const roster = await presets.list()
    const rosterIds = new Set(roster.map(p => p.id))
    const out: MarketPackage[] = []
    for (const marketplace of await listMarketplaces(this.root)) {
      const pluginsDir = join(this.root, marketplace, 'plugins')
      if (!existsSync(pluginsDir)) continue
      for (const entry of (await readdir(pluginsDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) continue
        const dir = join(pluginsDir, entry.name)
        let plugin: PluginJson | undefined
        let parseError: string | undefined
        try {
          plugin = await readJson(join(dir, PLUGIN_FILE)) as PluginJson
        } catch (error) {
          parseError = String((error as Error).message)
        }
        const contentProblems = await validatePackageContent(dir)
        out.push({
          marketplace,
          dirName: entry.name,
          plugin,
          parseError,
          installed: plugin !== undefined && rosterIds.has(plugin.name),
          contentProblems,
        })
      }
    }
    return out
  }

  /**
   * Install one market package as an expert preset. Throws with a readable
   * message on any validation failure; nothing is written unless the
   * read-back gate passes.
   */
  async install(presets: AgentPresetsLike, marketplace: string, dirName: string): Promise<InstallSummary> {
    const dir = this.packageDir(marketplace, dirName)
    const plugin = await readJson(join(dir, PLUGIN_FILE)) as PluginJson
    const presetId = plugin.name
    if (typeof presetId !== 'string' || !PRESET_ID.test(presetId) || !presetId.startsWith(EXPERT_ID_PREFIX)) {
      throw new Error(`expert-market: package name must be a preset id with "${EXPERT_ID_PREFIX}" prefix, got ${JSON.stringify(presetId)}`)
    }
    if (typeof plugin.agentName !== 'string' || !/^[a-z0-9-]+$/.test(plugin.agentName)) {
      throw new Error(`expert-market: plugin.json agentName invalid: ${JSON.stringify(plugin.agentName)}`)
    }
    if (!existsSync(join(dir, 'agents', `${plugin.agentName}.md`))) {
      throw new Error(`expert-market: agents/${plugin.agentName}.md missing in package`)
    }
    const contentProblems = await validatePackageContent(dir)
    if (contentProblems.length > 0) {
      throw new Error('expert-market: package content rejected:\n' + contentProblems.map(p => `- ${p}`).join('\n'))
    }

    const warnings: string[] = []
    const baselineId = plugin.dsh?.baseline ?? 'standard'
    const baselineText = await presets.read(baselineId)
    const disable = [...(plugin.dsh?.capabilities?.disable ?? [])]
    const enableWanted = [...(plugin.dsh?.capabilities?.enable ?? [])]
    const enable: string[] = []
    checkEnableBundles(enableWanted, warnings, enable)

    const skillsDir = join(dir, 'skills')
    const skillDirs = existsSync(skillsDir) ? [toPosix(skillsDir)] : []
    const opening = plugin.defaultInitPrompt?.zh
    const personaHash = sha256(await readFile(PERSONA_PLUGIN_SOURCE, 'utf8'))
    // Team members: one delegation tool row per member, persona = member MD.
    const memberDelegations: MemberDelegation[] = []
    if (plugin.expertType === 'team') {
      for (const member of plugin.members ?? []) {
        const memberAgent = member.agentName ?? member.name
        if (memberAgent === undefined) continue
        const mdPath = join(dir, 'agents', `${memberAgent}.md`)
        if (!existsSync(mdPath)) {
          warnings.push(`team: member file agents/${memberAgent}.md missing — delegation row skipped`)
          continue
        }
        memberDelegations.push({
          agentName: memberAgent,
          toolName: `delegate_${memberAgent.replace(/^member[-_]/, '')}`,
          label: member.displayName?.zh ?? memberAgent,
          persona: await readFile(mdPath, 'utf8'),
        })
      }
    }
    const plan: SurgeryPlan = {
      baselineText,
      agentName: plugin.agentName,
      disable,
      enable,
      skillDirs,
      personaHash,
      ...(opening !== undefined ? { opening } : {}),
      ...(memberDelegations.length > 0 ? { memberDelegations } : {}),
    }
    const surgery = applyExpertSurgery(plan)
    warnings.push(...surgery.warnings)
    await assertSurgeryResult(baselineText, surgery.text, plan)

    const presetDir = join(expandHome(this.userPresetRoot(presets)), presetId)
    const baselineHash = sha256(baselineText)
    const meta = {
      baselineId,
      baselineHash,
      disable,
      enable,
      personaFile: `agents/${plugin.agentName}.md`,
      personaHash,
      skillsDir: skillDirs[0],
      personaMode: surgery.personaMode,
      // Client-facing card/chip data (decouples the browser from package scans):
      displayName: plugin.displayName,
      profession: plugin.profession,
      expertType: plugin.expertType ?? 'agent',
      members: plugin.members ?? [],
      memberTools: memberDelegations.map(m => ({ toolName: m.toolName, label: m.label, agentName: m.agentName })),
      quickPrompts: plugin.quickPrompts ?? [],
      defaultInitPrompt: plugin.defaultInitPrompt,
      featured: plugin.dsh?.featured === true,
      marketplace,
      packageName: dirName,
      warnings,
      appliedAt: new Date().toISOString(),
    }

    // Stage then swap: a failed generation never occupies the id.
    const { mkdtemp, rm: rmDir } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const staging = await mkdtemp(join(tmpdir(), 'expert-preset-'))
    try {
      await mkdir(join(staging, 'agents'), { recursive: true })
      await writeFile(join(staging, 'agent.cordis.yml'), surgery.text, 'utf8')
      await cp(join(dir, 'agents'), join(staging, 'agents'), { recursive: true })
      await cp(PERSONA_PLUGIN_SOURCE, join(staging, 'expert-persona.js'))
      await writeFile(join(staging, 'preset.yml'), [
        `name: ${JSON.stringify(plugin.displayName?.zh ?? plugin.name)}`,
        `description: ${JSON.stringify(plugin.displayDescription?.zh ?? '')}`,
      ].join('\n') + '\n', 'utf8')
      await writeFile(join(staging, '.expert-meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8')
      if (existsSync(presetDir)) await rm(presetDir, { recursive: true, force: true })
      await mkdir(dirname(presetDir), { recursive: true })
      await cp(staging, presetDir, { recursive: true })
    } finally {
      await rmDir(staging, { recursive: true, force: true })
    }

    await this.appendInstallLog({ event: 'install', presetId, marketplace, packageName: dirName, baselineId, baselineHash, warnings, at: meta.appliedAt })
    return {
      ok: true,
      presetId,
      presetDir,
      baselineId,
      baselineHash,
      personaMode: surgery.personaMode,
      warnings,
    }
  }

  /**
   * Uninstall one expert: remove the preset through the roster service
   * (native semantics keep live sessions running), then delete the market
   * package directory.
   */
  async uninstall(presets: AgentPresetsLike, presetId: string, opts: { deletePackage: boolean; marketplace?: string; dirName?: string }): Promise<{ ok: true; presetRemoved: boolean; packageRemoved: boolean }> {
    let presetRemoved = false
    try {
      await presets.remove(presetId)
      presetRemoved = true
    } catch {
      // Unknown preset: the directory is already gone — uninstall is
      // idempotent, so fall through to the package removal.
    }
    let packageRemoved = false
    if (opts.deletePackage) {
      const dir = opts.marketplace !== undefined && opts.dirName !== undefined
        ? this.packageDir(opts.marketplace, opts.dirName)
        : join(this.root, 'my-experts', 'plugins', presetId)
      if (existsSync(dir)) {
        await rm(dir, { recursive: true, force: true })
        packageRemoved = true
      }
    }
    await this.appendInstallLog({ event: 'uninstall', presetId, presetRemoved, packageRemoved, at: new Date().toISOString() })
    return { ok: true, presetRemoved, packageRemoved }
  }

  /**
   * Read the client-facing metadata an installed expert preset carries.
   * Returns undefined when the preset is missing or carries no expert meta
   * (a hand-authored preset).
   */
  async presetMeta(presets: AgentPresetsLike, presetId: string): Promise<{
    displayName?: { zh?: string; en?: string }
    profession?: { zh?: string; en?: string }
    expertType?: string
    quickPrompts?: Array<{ zh?: string; en?: string }>
    defaultInitPrompt?: { zh?: string; en?: string }
    disable?: string[]
    enable?: string[]
    featured?: boolean
  } | undefined> {
    const preset = (await presets.list()).find(p => p.id === presetId)
    if (preset === undefined) return undefined
    const metaPath = join(dirname(preset.path), '.expert-meta.json')
    if (!existsSync(metaPath)) return undefined
    try {
      return await readJson(metaPath) as Awaited<ReturnType<MarketService['presetMeta']>>
    } catch {
      return undefined
    }
  }

  /** Whether an installed expert's baseline has drifted (P2-1 upgrade hint). */
  async baselineDrift(presets: AgentPresetsLike, presetId: string): Promise<boolean | undefined> {
    const preset = (await presets.list()).find(p => p.id === presetId)
    if (preset === undefined) return undefined
    const metaPath = join(dirname(preset.path), '.expert-meta.json')
    if (!existsSync(metaPath)) return undefined
    try {
      const meta = await readJson(metaPath) as { baselineId?: string; baselineHash?: string }
      if (meta.baselineId === undefined || meta.baselineHash === undefined) return undefined
      const current = sha256(await presets.read(meta.baselineId))
      return current !== meta.baselineHash
    } catch {
      return undefined
    }
  }

  private userPresetRoot(presets: AgentPresetsLike): string {
    const userRoot = presets.roots.find(root => root.trust === 'user')
    if (userRoot === undefined) throw new Error('expert-market: this deployment configures no user-writable preset root')
    return expandHome(userRoot.path)
  }

  private async appendInstallLog(entry: Record<string, unknown>): Promise<void> {
    const logPath = join(dshHome(), INSTALL_LOG)
    await mkdir(dirname(logPath), { recursive: true })
    await writeFile(logPath, JSON.stringify(entry) + '\n', { encoding: 'utf8', flag: 'a' })
  }
}

/** stat helper re-export for route handlers that need file sizes. */
export async function fileSize(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size
  } catch {
    return undefined
  }
}
