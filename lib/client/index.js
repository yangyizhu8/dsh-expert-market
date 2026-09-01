/**
 * dsh-expert-market — client half.
 *
 * Two surfaces:
 * 1. settings.section entry card (batch-0; register(options, ReactComponent)).
 * 2. quickPrompts chips in the conversation input area (batch 2): when the
 *    current session runs an expert preset (id carries the `expert-`
 *    prefix), fetch that expert's quickPrompts from the market host API and
 *    render one chip each; clicking fills the composer via
 *    `props.inputActions.setDraft(text)` — fill-not-send, the user presses
 *    enter (the official channel dsh-prompt-enhancer uses; zero protocol
 *    risk, user agency preserved).
 */
import React from 'react';
const PLUGIN_ID = 'dsh-expert-market';
/** Chip cache: preset id -> quickPrompts (module-scope cache is fine for an external plugin). */
const chipsCache = new Map();
async function fetchChips(preset) {
    const cached = chipsCache.get(preset);
    if (cached !== undefined)
        return cached;
    try {
        const answer = await fetch(`/api/expert-market/api/session-chips?preset=${encodeURIComponent(preset)}`);
        const body = await answer.json();
        const chips = body.quickPrompts ?? [];
        chipsCache.set(preset, chips);
        return chips;
    }
    catch {
        return [];
    }
}
function QuickPromptChips(props) {
    const H = React.createElement;
    // Production-proven shapes (dsh-prompt-enhancer): session kit arrives as
    // props.session.sessionId + props.inputActions; keep the flat-sessionId
    // variant as a defensive fallback.
    const sessionId = props.session?.sessionId ?? props.sessionId;
    const inputActions = props.inputActions;
    const [chips, setChips] = React.useState([]);
    // Resolve the session's preset: the host API keyed by sessionId is
    // authoritative (the same channel the chips come from).
    React.useEffect(() => {
        let cancelled = false;
        const resolve = async () => {
            let preset;
            if (sessionId !== undefined) {
                try {
                    const answer = await fetch(`/api/expert-market/api/session-chips?sessionId=${encodeURIComponent(sessionId)}`);
                    const body = await answer.json();
                    preset = body.preset;
                }
                catch {
                    preset = undefined;
                }
            }
            if (cancelled)
                return;
            if (preset === undefined || !preset.startsWith('expert-')) {
                setChips([]);
                return;
            }
            const list = await fetchChips(preset);
            if (!cancelled)
                setChips(list);
        };
        void resolve();
        return () => { cancelled = true; };
    }, [sessionId]);
    if (chips.length === 0 || sessionId === undefined)
        return null;
    return H('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, ...chips.map((chip, index) => H('button', {
        key: index,
        title: chip.en ?? chip.zh ?? '',
        onClick: () => {
            const text = chip.zh ?? chip.en ?? '';
            if (text !== '' && typeof inputActions?.setDraft === 'function') {
                inputActions.setDraft(text);
            }
        },
        style: {
            background: 'rgba(47,111,237,0.14)',
            border: '1px solid rgba(47,111,237,0.5)',
            color: '#9db9f2',
            borderRadius: 12,
            padding: '2px 10px',
            fontSize: 12,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
        },
    }, chip.zh ?? chip.en ?? '')));
}
function MarketEntryCard() {
    const H = React.createElement;
    return H('div', { style: { padding: '12px 0', fontSize: '13px', lineHeight: '20px' } }, H('div', { style: { fontWeight: 600, marginBottom: 4 } }, '专家市场'), H('div', { style: { opacity: 0.7, marginBottom: 6 } }, 'WorkBuddy 专家/专家团体系 · 安装专家 = 生成 agent preset。完整市场页：'), H('a', { href: '/api/expert-market', target: '_blank', rel: 'noreferrer', style: { color: '#7aa2ff' } }, '/api/expert-market'));
}
export const inject = ['slots'];
export function apply(ctx) {
    ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: PLUGIN_ID + '-entry',
        order: 30,
        label: '专家市场',
    }, MarketEntryCard)), PLUGIN_ID + ': settings.section entry');
    // Input-area chips: same slot the prompt-enhancer button uses, ordered
    // after it so both coexist.
    ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: PLUGIN_ID + '-chips',
        order: 30,
    }, QuickPromptChips)), PLUGIN_ID + ': quickPrompts chips');
}
//# sourceMappingURL=index.js.map