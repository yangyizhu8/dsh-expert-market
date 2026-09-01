type SlotsServiceShim = {
    inject(slot: string, factory: () => unknown): unknown;
    register(options: Record<string, unknown>, component: unknown): unknown;
};
type ClientContext = {
    slots: SlotsServiceShim;
    effect(fn: () => void, label: string): unknown;
};
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
