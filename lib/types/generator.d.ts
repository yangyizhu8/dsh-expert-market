import { dirname, resolve } from 'node:path';
/** Ids a preset directory may use (mirror of agent-presets' PRESET_ID). */
export declare const PRESET_ID: RegExp;
/** Market packages must namespace their preset id with this prefix. */
export declare const EXPERT_ID_PREFIX = "expert-";
export interface RowSpan {
    id: string;
    dashIndent: number;
    start: number;
    end: number;
    disabled: boolean;
    name: string | undefined;
}
/**
 * Collect every row (top level and inside groups) with its text location.
 * Only DIRECT property lines (indent exactly dashIndent + 2) feed the
 * disabled/name read: a group's children sit deeper, and their
 * `disabled:` lines must never be attributed to the parent row
 * (batch-0 read-back gate caught exactly this mis-attribution).
 */
export declare function collectRows(text: string): RowSpan[];
/**
 * The persona row's plugin specifier carries a content-version query so a
 * re-install with an updated expert-persona.js gets a fresh Node ESM module:
 * the same URL without the query hits the module cache and the new standing
 * generation silently runs the OLD plugin (batch-2 finding).
 */
export declare function personaSpecifier(personaHash: string): string;
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
    agentName: string;
    /** Delegate tool name, e.g. delegate_researcher. */
    toolName: string;
    /** Display name (zh) for the tool description. */
    label: string;
    /** Member persona text (the member MD content). */
    persona: string;
}
export interface FlatRow {
    name: string;
    disabled: boolean;
    config: any;
}
/** Parse composition text with the loader dialect and flatten rows (groups recursed). */
export declare function parseComposition(text: string): Promise<Map<string, FlatRow>>;
export interface SurgeryPlan {
    baselineText: string;
    agentName: string;
    disable: string[];
    enable: string[];
    skillDirs: string[];
    /** Content hash (sha256 hex) of the expert-persona.js being shipped. */
    personaHash: string;
    /** Package defaultInitPrompt (zh): drives the conditional expert:opening section. */
    opening?: string;
    /** Team members: one delegation tool row each (batch-3 enhanced form). */
    memberDelegations?: MemberDelegation[];
}
export interface SurgeryResult {
    text: string;
    warnings: string[];
    personaMode: 'replaced' | 'appended';
}
/** Apply the full expert surgery to baseline text. Pure string work. */
export declare function applyExpertSurgery(plan: SurgeryPlan): SurgeryResult;
/** Read-back gate: loader-dialect parse + exact expected delta assertion. */
export declare function assertSurgeryResult(baselineText: string, resultText: string, plan: SurgeryPlan): Promise<void>;
/**
 * Static content scan of an expert package: executables banned everywhere;
 * shell scripts only under skills/<name>/scripts/ (model-initiated shell
 * approval channel 鈥?a different threat level from mount-time auto-load);
 * everything else must be a known content extension. Purely static 鈥? * never executes package content.
 */
export declare function validatePackageContent(packageDir: string): Promise<string[]>;
import { join, sep } from 'node:path';
export { dirname, join, resolve, sep };
