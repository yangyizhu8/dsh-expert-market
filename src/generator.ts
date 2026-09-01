/**
 * Expert preset generator 鈥?text surgery core (batch-0 proven).
 *
 * Generates an expert agent preset composition from a WorkBuddy-format
 * expert package: baseline composition TEXT in, line-level surgery
 * (persona row replacement, capability disable/enable, customSkillDirs
 * injection), validated composition out. The loader's own YAML dialect
 * (`entryListSchema`) re-parses the result and the expected row delta is
 * asserted before any bytes reach the preset root.
 *
 * Surgery is TEXT-level on purpose: `!!js` conditional expressions cannot
 * round-trip through a YAML parser (function values cannot be re-emitted),
 * so the baseline's conditionals are preserved byte-for-byte and only the
 * targeted row blocks are touched.
 *
 * Batch-0 experiment record: docs/evidence/batch0-experiments.md
 * (relative-name plugin files resolve from the preset dir, but their OWN
 * imports get no harness resolution 鈥?hence the zero-bare-import
 * expert-persona.js; group-row `disabled: true` skips the whole subtree,
 * so disable targets never need child expansion).
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

// 鈹€鈹€ loader-dialect deps, resolved from whichever anchor carries them 鈹€鈹€
// Under formal profile assembly the importing file is lib/generator.js in
// the plugin dir, whose node_modules is link-populated by build.sh.

const REQUIRE_ANCHORS = [
  fileURLToPath(new URL('../package.json', import.meta.url)),
  'D:/deepseek-harness/packages/preset/agent-presets/package.json',
]

function resolveDep(specifier: string): string {
  let lastError: unknown
  for (const anchor of REQUIRE_ANCHORS) {
    if (!existsSync(anchor)) continue
    try {
      return createRequire(anchor).resolve(specifier)
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`expert-market: cannot resolve ${specifier} from any anchor: ${String(lastError)}`)
}

type YamlLoad = (text: string, options: { schema: unknown }) => unknown

/* eslint-disable @typescript-eslint/no-explicit-any */
let cached: { entryListSchema: any; yamlLoad: YamlLoad } | undefined

async function loaderDeps(): Promise<{ entryListSchema: any; yamlLoad: YamlLoad }> {
  if (cached !== undefined) return cached
  const includePath = resolveDep('@deepseek-ai/cordis-plugin-include')
  const include = (await import(pathToFileURL(includePath).href)) as { entryListSchema: any }
  const yamlPath = resolveDep('js-yaml')
  const yaml = (await import(pathToFileURL(yamlPath).href)) as { load: YamlLoad }
  cached = { entryListSchema: include.entryListSchema, yamlLoad: yaml.load }
  return cached
}

/** Ids a preset directory may use (mirror of agent-presets' PRESET_ID). */
export const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** Market packages must namespace their preset id with this prefix. */
export const EXPERT_ID_PREFIX = 'expert-'

// 鈹€鈹€ composition text walking 鈹€鈹€

export interface RowSpan {
  id: string
  dashIndent: number
  start: number
  end: number
  disabled: boolean
  name: string | undefined
}

/**
 * Find a row block's extent: from its `- id:` line through the last
 * non-blank line indented deeper than the dash. A non-blank line at
 * indent <= dashIndent (comment or the next row) ends the block.
 */
function rowExtent(lines: string[], startLine: number): { start: number; end: number } {
  const dashIndent = lines[startLine]!.length - lines[startLine]!.trimStart().length
  let end = startLine
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    if (indent <= dashIndent) break
    end = i
  }
  return { start: startLine, end }
}

/**
 * Collect every row (top level and inside groups) with its text location.
 * Only DIRECT property lines (indent exactly dashIndent + 2) feed the
 * disabled/name read: a group's children sit deeper, and their
 * `disabled:` lines must never be attributed to the parent row
 * (batch-0 read-back gate caught exactly this mis-attribution).
 */
export function collectRows(text: string): RowSpan[] {
  const lines = text.split(/\r?\n/)
  const rows: RowSpan[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/^(\s*)- id: (\S+)\s*$/)
    if (match === null) continue
    const dashIndent = match[1]!.length
    const { start, end } = rowExtent(lines, i)
    const propIndent = dashIndent + 2
    const direct = lines.slice(start, end + 1).filter((line, offset) => {
      if (offset === 0) return false
      if (line.trim() === '') return false
      return line.length - line.trimStart().length === propIndent
    })
    const disabled = direct.some(line => /^disabled:\s+(?:true\b|!!js)/.test(line.trimStart()))
    const name = direct.find(line => line.trimStart().startsWith('name:'))?.trimStart().match(/^name:\s*(.+)$/)?.[1]
    rows.push({ id: match[2]!, dashIndent, start, end, disabled, name })
  }
  return rows
}

function findRow(rows: RowSpan[], id: string): RowSpan | undefined {
  const hits = rows.filter(row => row.id === id)
  if (hits.length === 0) return undefined
  if (hits.length > 1) throw new Error(`expert-market: row id "${id}" is not unique in the composition`)
  return hits[0]
}

// -- surgery steps --

/**
 * The persona row's plugin specifier carries a content-version query so a
 * re-install with an updated expert-persona.js gets a fresh Node ESM module:
 * the same URL without the query hits the module cache and the new standing
 * generation silently runs the OLD plugin (batch-2 finding).
 */
export function personaSpecifier(personaHash: string): string {
  return `./expert-persona.js?v=${personaHash.slice(0, 8)}`
}

function replacePersonaRow(lines: string[], rows: RowSpan[], agentName: string, personaHash: string, opening: string | undefined): 'replaced' | 'appended' {
  const persona = findRow(rows, 'persona')
  const replacement = [
    '- id: persona',
    `  name: '${personaSpecifier(personaHash)}'`,
    '  config:',
    `    promptFile: agents/${agentName}.md`,
  ]
  if (opening !== undefined && opening.trim() !== '') {
    // Block literal keeps arbitrary prompt text byte-safe (no quoting/escape
    // rules beyond indentation); `|-` strips the single trailing newline.
    replacement.push('    opening: |-')
    for (const line of opening.replaceAll('\r\n', '\n').split('\n')) {
      replacement.push(`      ${line}`)
    }
  }
  if (persona === undefined) {
    lines.unshift(...replacement, '')
    return 'appended'
  }
  lines.splice(persona.start, persona.end - persona.start + 1, ...replacement)
  return 'replaced'
}

function disableRow(lines: string[], rows: RowSpan[], id: string, warnings: string[]): void {
  const row = findRow(rows, id)
  if (row === undefined) {
    warnings.push(`disable: id "${id}" not in baseline (baseline drift tolerated)`)
    return
  }
  if (row.disabled) {
    warnings.push(`disable: id "${id}" already disabled in baseline`)
    return
  }
  const propIndent = ' '.repeat(row.dashIndent + 2)
  lines.splice(row.start + 1, 0, `${propIndent}disabled: true`)
}

function enableRow(lines: string[], rows: RowSpan[], id: string, warnings: string[]): void {
  const row = findRow(rows, id)
  if (row === undefined) {
    warnings.push(`enable: id "${id}" not in baseline`)
    return
  }
  const block = lines.slice(row.start, row.end + 1)
  const disabledLine = block.findIndex(line => /^(\s*)disabled: true\s*$/.test(line))
  if (disabledLine === -1) {
    if (block.some(line => /^\s*disabled:\s*!!js/.test(line))) {
      throw new Error(`expert-market: enable target "${id}" is conditionally disabled (!!js) 鈥?` +
        'refusing to enable an environment-conditional row')
    }
    warnings.push(`enable: id "${id}" was not disabled; nothing to do`)
    return
  }
  lines.splice(row.start + disabledLine, 1)
}

function injectCustomSkillDirs(lines: string[], rows: RowSpan[], skillDirs: string[], warnings: string[]): void {
  const row = findRow(rows, 'skill-filesystem')
  if (row === undefined) {
    warnings.push('skills: baseline has no skill-filesystem row; expert skills will not be discovered')
    return
  }
  const block = lines.slice(row.start, row.end + 1)
  const configLine = block.findIndex(line => /^(\s*)config:\s*$/.test(line))
  const propIndent = ' '.repeat(row.dashIndent + 2)
  if (configLine === -1) {
    const addition = [
      `${propIndent}config:`,
      `${propIndent}  customSkillDirs:`,
      ...skillDirs.map(dir => `${propIndent}  - '${dir.replaceAll("'", "\\'")}'`),
    ]
    lines.splice(row.end + 1, 0, ...addition)
    return
  }
  if (block.some(line => /^\s*customSkillDirs:/.test(line))) {
    warnings.push('skills: skill-filesystem row already declares customSkillDirs; leaving as authored')
    return
  }
  lines.splice(row.start + configLine + 1, 0,
    `${propIndent}  customSkillDirs:`,
    ...skillDirs.map(dir => `${propIndent}  - '${dir.replaceAll("'", "\\'")}'`))
}

/**
 * One team member's delegation row config (batch-3 enhanced form): a
 * dedicated tool-subagent row whose static config carries the member's
 * persona text. The spawn provider shadows `deployment:persona` inside the
 * child's scope with this text — the same mechanism the deployment persona
 * uses, zero kernel changes. Same-package multi-row different-toolName is
 * the shipped preset's own codex/claude-code precedent.
 */
export interface MemberDelegation {
  /** Member agent file stem (agents/<agentName>.md). */
  agentName: string
  /** Delegate tool name, e.g. delegate_researcher. */
  toolName: string
  /** Display name (zh) for the tool description. */
  label: string
  /** Member persona text (the member MD content). */
  persona: string
}

function appendMemberRows(lines: string[], members: MemberDelegation[], warnings: string[]): void {
  if (members.length === 0) return
  // Insert before the FIRST existing row so member tools land on top of the
  // row list; the loader reorders by id anyway.
  let insertAt = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (/^# /.test(lines[i] ?? '') || /^- id: /.test(lines[i] ?? '')) { insertAt = i; break }
  }
  const block: string[] = []
  for (const member of members) {
    if (!/^[a-z0-9_-]+$/.test(member.toolName)) {
      warnings.push(`team: member tool name "${member.toolName}" is not usable; member skipped`)
      continue
    }
    block.push(
      `- id: tool-subagent-member-${member.toolName.replace(/^delegate_/, '')}`,
      "  name: '@deepseek-ai/dsh-tool-subagent'",
      '  config:',
      '    provider: spawn',
      `    toolName: ${member.toolName}`,
      '    backgroundMode: continuable',
      '    persona: |-',
      ...member.persona.replaceAll('\r\n', '\n').split('\n').map(line => `      ${line}`),
      '',
    )
  }
  if (block.length > 0) lines.splice(insertAt, 0, ...block, '# ── expert team member delegation rows (generated) ──', '')
  void warnings
}

// 鈹€鈹€ read-back validation 鈹€鈹€

export interface FlatRow {
  name: string
  disabled: boolean
  config: any
}

/** Parse composition text with the loader dialect and flatten rows (groups recursed). */
export async function parseComposition(text: string): Promise<Map<string, FlatRow>> {
  const { entryListSchema, yamlLoad } = await loaderDeps()
  const doc = yamlLoad(text, { schema: entryListSchema }) as any
  const flat = new Map<string, FlatRow>()
  const walk = (rows: any[]): void => {
    for (const row of rows) {
      flat.set(row.id, { name: row.name, disabled: row.disabled === true, config: row.config })
      if (row.group === true && Array.isArray(row.config)) walk(row.config)
    }
  }
  walk(doc)
  return flat
}

export interface SurgeryPlan {
  baselineText: string
  agentName: string
  disable: string[]
  enable: string[]
  skillDirs: string[]
  /** Content hash (sha256 hex) of the expert-persona.js being shipped. */
  personaHash: string
  /** Package defaultInitPrompt (zh): drives the conditional expert:opening section. */
  opening?: string
  /** Team members: one delegation tool row each (batch-3 enhanced form). */
  memberDelegations?: MemberDelegation[]
}

export interface SurgeryResult {
  text: string
  warnings: string[]
  personaMode: 'replaced' | 'appended'
}

/** Apply the full expert surgery to baseline text. Pure string work. */
export function applyExpertSurgery(plan: SurgeryPlan): SurgeryResult {
  const warnings: string[] = []
  const baselineRows = collectRows(plan.baselineText)
  const lines = plan.baselineText.split(/\r?\n/)
  const personaMode: 'replaced' | 'appended' = replacePersonaRow(lines, baselineRows, plan.agentName, plan.personaHash, plan.opening)
  const afterPersona = collectRows(lines.join('\n'))
  for (const id of plan.disable) disableRow(lines, afterPersona, id, warnings)
  for (const id of plan.enable) enableRow(lines, afterPersona, id, warnings)
  injectCustomSkillDirs(lines, afterPersona, plan.skillDirs, warnings)
  appendMemberRows(lines, plan.memberDelegations ?? [], warnings)
  return { text: lines.join('\n'), warnings, personaMode }
}

/** Read-back gate: loader-dialect parse + exact expected delta assertion. */
export async function assertSurgeryResult(baselineText: string, resultText: string, plan: SurgeryPlan): Promise<void> {
  const before = await parseComposition(baselineText)
  const after = await parseComposition(resultText)
  const problems: string[] = []
  for (const id of before.keys()) {
    if (!after.has(id)) problems.push(`row "${id}" vanished`)
  }
  const persona = after.get('persona')
  if (persona === undefined || persona.name !== personaSpecifier(plan.personaHash)) {
    problems.push('persona row was not replaced with the versioned expert-persona specifier')
  } else if (persona.config?.promptFile !== `agents/${plan.agentName}.md`) {
    problems.push(`persona promptFile is ${JSON.stringify(persona.config?.promptFile)}`)
  } else if (plan.opening !== undefined && plan.opening.trim() !== '' && persona.config?.opening !== plan.opening.replaceAll('\r\n', '\n').trim()) {
    problems.push('persona opening config missing or altered')
  }
  for (const id of plan.disable) {
    const row = after.get(id)
    if (row === undefined) problems.push(`disable target "${id}" absent after surgery`)
    else if (!row.disabled) problems.push(`disable target "${id}" is not disabled after surgery`)
  }
  for (const id of plan.enable) {
    const row = after.get(id)
    if (row !== undefined && row.disabled) problems.push(`enable target "${id}" still disabled`)
  }
  if (plan.skillDirs.length > 0) {
    const dirs = after.get('skill-filesystem')?.config?.customSkillDirs
    if (JSON.stringify(dirs) !== JSON.stringify(plan.skillDirs)) {
      problems.push(`skill-filesystem customSkillDirs is ${JSON.stringify(dirs)}`)
    }
  }
  for (const member of plan.memberDelegations ?? []) {
    const row = after.get(`tool-subagent-member-${member.toolName.replace(/^delegate_/, '')}`)
    if (row === undefined) problems.push(`team member row for ${member.toolName} missing after surgery`)
    else if (row.config?.toolName !== member.toolName) problems.push(`team member row ${member.toolName} has wrong toolName`)
    // `|-` strips trailing newlines; compare trailing-trimmed text.
    else if (String(row.config?.persona).trimEnd() !== member.persona.replaceAll('\r\n', '\n').trimEnd()) {
      problems.push(`team member row ${member.toolName} persona text altered`)
    }
  }
  for (const [id, row] of before) {
    if (plan.disable.includes(id) || plan.enable.includes(id) || id === 'persona') continue
    const afterRow = after.get(id)
    if (afterRow === undefined) continue
    if (afterRow.disabled !== row.disabled) problems.push(`row "${id}" disabled flag changed unexpectedly`)
  }
  if (problems.length > 0) {
    throw new Error('expert-market: read-back validation failed:\n' + problems.map(p => `- ${p}`).join('\n'))
  }
}

// 鈹€鈹€ expert package content policy (v3 搂5) 鈹€鈹€

const BANNED_EXTENSIONS = ['.js', '.ts', '.mjs', '.cjs', '.node', '.exe', '.dll']
const SCRIPT_EXTENSIONS = ['.py', '.sh', '.ps1', '.bat', '.cmd']
const ALLOWED_EXTENSIONS = ['.md', '.json', '.yaml', '.yml', '.txt', '.png', '.jpg', '.jpeg', '.webp', '.gif']

const SKILL_SCRIPTS = /(^|[\\/])skills[\\/][^\\/]+[\\/]scripts$/

/**
 * Static content scan of an expert package: executables banned everywhere;
 * shell scripts only under skills/<name>/scripts/ (model-initiated shell
 * approval channel 鈥?a different threat level from mount-time auto-load);
 * everything else must be a known content extension. Purely static 鈥? * never executes package content.
 */
export async function validatePackageContent(packageDir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const problems: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const dot = entry.name.lastIndexOf('.')
      const ext = dot >= 0 ? entry.name.slice(dot).toLowerCase() : ''
      const inSkillScripts = SKILL_SCRIPTS.test(dir)
      if (BANNED_EXTENSIONS.includes(ext)) {
        problems.push(`banned executable content: ${full.slice(packageDir.length + 1)}`)
      } else if (SCRIPT_EXTENSIONS.includes(ext) && !inSkillScripts) {
        problems.push(`script outside skills/<name>/scripts/: ${full.slice(packageDir.length + 1)}`)
      } else if (!SCRIPT_EXTENSIONS.includes(ext) && !ALLOWED_EXTENSIONS.includes(ext)) {
        problems.push(`unrecognized content extension "${ext}": ${full.slice(packageDir.length + 1)}`)
      }
    }
  }
  await walk(packageDir)
  return problems
}

// 鈹€鈹€ shared path helpers 鈹€鈹€

import { join, sep } from 'node:path'

export { dirname, join, resolve, sep }
