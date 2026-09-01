/**
 * Expert persona row plugin — dsh-expert-market.
 *
 * Mounted inside an expert agent preset it replaces the deployment persona
 * for that one session: registers the `deployment:persona` section (the same
 * name/order the deployment persona uses, so the scoped layer shadows the
 * global one) with the expert's prompt file content.
 *
 * ZERO bare-specifier imports by design. This file lives in a preset
 * directory under the user's home, where Node's upward node_modules walk
 * reaches no harness dependency; only the composition ROW loader resolves
 * bare names (from the harness base), never this module's own imports. So
 * the two harness constants it needs are inlined below as literals, each
 * naming its source of truth — if the harness ever renames them, the mount
 * audit (duplicate section) or the render audit (unknown variable) fails
 * loud rather than silently mis-persona-ing.
 *
 * Inlined from @deepseek-ai/dsh-system-prompt (source: packages/core/system-prompt/src/index.ts):
 *   PERSONA_SECTION = 'deployment:persona'
 *   PERSONA_ORDER   = 0
 * Config validation is inline: no schemastery in reach, and the config surface
 * is one required string plus two booleans.
 *
 * The row's `promptFile` resolves relative to THIS file's directory — the
 * preset directory, because the generator copies this plugin into every
 * expert preset. The expert package itself never ships executable files;
 * this plugin is the ONLY executable an expert preset carries and it always
 * comes from the dsh-expert-market plugin body.
 *
 * `{{model}}` and `{{cwd}}` placeholders in the prompt file are NOT
 * interpolated here: sections are stored raw and the system-prompt registry
 * interpolates them at render time against registered prompt variables
 * (strict interpolation — unknown variables throw at render, never silently
 * pass through).
 */

import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name. */
export const name = 'expert-persona'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/** Inlined from @deepseek-ai/dsh-system-prompt — see module doc. */
const PERSONA_SECTION = 'deployment:persona'
/** Inlined from @deepseek-ai/dsh-system-prompt — see module doc. */
const PERSONA_ORDER = 0

/**
 * Resolve the prompt file against the preset directory.
 *
 * A relative path that escapes the preset directory is refused: a
 * market-installed composition may only read inside its own preset.
 * @param {string} promptFile - the row's `promptFile` config value.
 * @returns {string} the absolute path of the persona file.
 */
function resolvePromptFile(promptFile) {
  if (typeof promptFile !== 'string' || promptFile === '') {
    throw new Error('expert-persona: config.promptFile is required (the expert persona file, relative to the preset directory)')
  }
  const base = dirname(fileURLToPath(import.meta.url))
  const resolved = isAbsolute(promptFile) ? normalize(promptFile) : normalize(join(base, promptFile))
  const basePrefix = base.endsWith(sep) ? base : base + sep
  if (!resolved.startsWith(basePrefix)) {
    throw new Error(
      `expert-persona: promptFile ${JSON.stringify(promptFile)} resolves outside the preset directory — `
      + 'an expert preset may only read its own files',
    )
  }
  return resolved
}

/**
 * Register the expert persona section for the mounting context's scope.
 *
 * `config.opening` (optional) carries the package's defaultInitPrompt: it
 * registers a second, small section (`expert:opening`) with the CONDITIONAL
 * greeting contract — a canned self-introduction ahead of a concrete task
 * reads as broken, so the opening fires only when the first user turn has no
 * task background, and is explicitly suppressed otherwise.
 * @param {import('@deepseek-ai/cordis').Context} ctx - an agent scope context;
 * the section shadows the deployment persona for this preset's agents only.
 * @param {{promptFile: string, opening?: string, complete?: boolean, includeRuntimeContext?: boolean}} config
 */
export async function apply(ctx, config) {
  const path = resolvePromptFile(config.promptFile)
  const text = await readFile(path, 'utf8')
  ctx.effect(() => ctx.systemPrompt.section({
    name: PERSONA_SECTION,
    order: PERSONA_ORDER,
    text,
    ...(config.complete === true ? { complete: true } : {}),
  }), 'expert-persona.section()')
  if (typeof config.opening === 'string' && config.opening.trim() !== '') {
    const openingText = [
      '开场约定（仅约束第一轮，之后永不重复）：',
      '· 若用户第一轮消息没有携带具体任务背景：用两三句话以专家身份自我介绍，然后向用户提出下面的开场问题，邀请其开始对话。',
      '· 若用户第一轮就直接给出了具体任务：直接开始处理任务，不要自我介绍；可在回应末尾自然带出你还能提供的帮助。',
      '开场问题：' + config.opening.trim(),
    ].join('\n')
    ctx.effect(() => ctx.systemPrompt.section({
      name: 'expert:opening',
      order: PERSONA_ORDER + 1,
      text: openingText,
    }), 'expert-persona.opening()')
  }
  if (config.includeRuntimeContext === false) ctx.systemPrompt.suppressRuntimeContext()
}
