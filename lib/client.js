window.__ModuleLoader__.load({
	id: "dsh-expert-market",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/client/index.ts
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
		/** Chip cache: preset id -> quickPrompts (module-scope cache is fine for an external plugin). */
		const chipsCache = /* @__PURE__ */ new Map();
		async function fetchChips(preset) {
			const cached = chipsCache.get(preset);
			if (cached !== void 0) return cached;
			try {
				const chips = (await (await fetch(`/api/expert-market/api/session-chips?preset=${encodeURIComponent(preset)}`)).json()).quickPrompts ?? [];
				chipsCache.set(preset, chips);
				return chips;
			} catch {
				return [];
			}
		}
		function QuickPromptChips(props) {
			const H = react.default.createElement;
			const sessionId = props.session?.sessionId ?? props.sessionId;
			const inputActions = props.inputActions;
			const [chips, setChips] = react.default.useState([]);
			react.default.useEffect(() => {
				let cancelled = false;
				const resolve = async () => {
					let preset;
					if (sessionId !== void 0) try {
						preset = (await (await fetch(`/api/expert-market/api/session-chips?sessionId=${encodeURIComponent(sessionId)}`)).json()).preset;
					} catch {
						preset = void 0;
					}
					if (cancelled) return;
					if (preset === void 0 || !preset.startsWith("expert-")) {
						setChips([]);
						return;
					}
					const list = await fetchChips(preset);
					if (!cancelled) setChips(list);
				};
				resolve();
				return () => {
					cancelled = true;
				};
			}, [sessionId]);
			if (chips.length === 0 || sessionId === void 0) return null;
			return H("div", { style: {
				display: "flex",
				gap: 6,
				alignItems: "center"
			} }, ...chips.map((chip, index) => H("button", {
				key: index,
				title: chip.en ?? chip.zh ?? "",
				onClick: () => {
					const text = chip.zh ?? chip.en ?? "";
					if (text !== "" && typeof inputActions?.setDraft === "function") inputActions.setDraft(text);
				},
				style: {
					background: "rgba(47,111,237,0.14)",
					border: "1px solid rgba(47,111,237,0.5)",
					color: "#9db9f2",
					borderRadius: 12,
					padding: "2px 10px",
					fontSize: 12,
					cursor: "pointer",
					whiteSpace: "nowrap"
				}
			}, chip.zh ?? chip.en ?? "")));
		}
		function MarketEntryCard() {
			const H = react.default.createElement;
			return H("div", { style: {
				padding: "12px 0",
				fontSize: "13px",
				lineHeight: "20px"
			} }, H("div", { style: {
				fontWeight: 600,
				marginBottom: 4
			} }, "专家市场"), H("div", { style: {
				opacity: .7,
				marginBottom: 6
			} }, "WorkBuddy 专家/专家团体系 · 安装专家 = 生成 agent preset。完整市场页："), H("a", {
				href: "/api/expert-market",
				target: "_blank",
				rel: "noreferrer",
				style: { color: "#7aa2ff" }
			}, "/api/expert-market"));
		}
		const inject = ["slots"];
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-expert-market-entry",
				order: 30,
				label: "专家市场"
			}, MarketEntryCard)), "dsh-expert-market: settings.section entry");
			ctx.effect(() => ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "dsh-expert-market-chips",
				order: 30
			}, QuickPromptChips)), "dsh-expert-market: quickPrompts chips");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map