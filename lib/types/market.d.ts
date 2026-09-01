/** Minimal shape of the agentPresets service this plugin consumes. */
export interface AgentPresetsLike {
    list(): Promise<Array<{
        id: string;
        trust: string;
        path: string;
        name?: string;
        description?: string;
        broken?: string;
    }>>;
    read(id: string): Promise<string>;
    remove(id: string): Promise<void>;
    roots: ReadonlyArray<{
        path: string;
        trust: string;
    }>;
}
export interface PluginJson {
    name: string;
    agentName: string;
    expertType?: 'agent' | 'team';
    displayName?: {
        zh?: string;
        en?: string;
    };
    profession?: {
        zh?: string;
        en?: string;
    };
    displayDescription?: {
        zh?: string;
        en?: string;
    };
    description?: {
        zh?: string;
        en?: string;
    };
    author?: {
        zh?: string;
        en?: string;
    };
    tags?: Array<{
        zh?: string;
        en?: string;
    }>;
    quickPrompts?: Array<{
        zh?: string;
        en?: string;
    }>;
    defaultInitPrompt?: {
        zh?: string;
        en?: string;
    };
    categoryId?: string;
    members?: Array<{
        name?: string;
        agentName?: string;
        displayName?: {
            zh?: string;
            en?: string;
        };
        description?: string;
    }>;
    dsh?: {
        baseline?: string;
        featured?: boolean;
        capabilities?: {
            disable?: string[];
            enable?: string[];
        };
    };
}
export interface MarketPackage {
    marketplace: string;
    dirName: string;
    plugin: PluginJson | undefined;
    parseError: string | undefined;
    installed: boolean;
    contentProblems: string[];
}
export interface InstallSummary {
    ok: boolean;
    presetId: string;
    presetDir: string;
    baselineId: string;
    baselineHash: string;
    personaMode: string;
    warnings: string[];
    error?: string;
}
/** One remote-catalog expert record (WorkBuddy expert_center.json shape). */
export interface RemoteRecord {
    id: string;
    categoryId?: string;
    displayName?: {
        zh?: string;
        en?: string;
    };
    profession?: {
        zh?: string;
        en?: string;
    };
    description?: {
        zh?: string;
        en?: string;
    };
    promptFile?: string;
    avatar?: string;
    updatedAt?: string;
    defaultInitPrompt?: {
        zh?: string;
        en?: string;
    };
    expertType?: 'agent' | 'team';
    agentName?: string;
    plugin?: string;
    tags?: Array<{
        zh?: string;
        en?: string;
    }>;
    quickPrompts?: Array<{
        zh?: string;
        en?: string;
    }>;
    author?: {
        zh?: string;
        en?: string;
    };
    displayPosition?: number;
    members?: Array<{
        id: string;
        displayName?: {
            zh?: string;
            en?: string;
        };
        profession?: {
            zh?: string;
            en?: string;
        };
        avatar?: string;
        promptFile?: string;
        role?: string;
    }>;
}
export interface MarketServiceOptions {
    marketplacesRoot: string;
}
export declare class MarketService {
    private readonly root;
    constructor(options: MarketServiceOptions);
    get marketplaceRoot(): string;
    /** Absolute path of one market package. */
    packageDir(marketplace: string, dirName: string): string;
    /**
     * Featured scenes from the official marketplace catalog
     * (catalog/scenes.json, 1:1 from the WorkBuddy asar). Empty when absent.
     */
    readScenes(): Array<{
        id?: number;
        name?: string;
        icon?: string;
        mode?: string;
        promptTitles?: string[];
        prompts?: string[];
    }>;
    /** Path of the bundled remote catalog (shipped in plugin resources). */
    remoteCatalogPath(): string;
    /** Read the bundled remote catalog; empty on any failure. */
    readRemoteCatalog(): RemoteRecord[];
    /** CDN root for remote expert content (promptFile/avatar are root-relative). */
    cdnRoot(): string;
    /**
     * Install one remote-catalog expert: download lead/member MD + avatars from
     * the CDN, write a WorkBuddy-format package into the official marketplace,
     * then run the normal install pipeline (text surgery + read-back gate).
     * `slug` must already carry the `expert-` prefix.
     */
    installRemote(presets: AgentPresetsLike, record: RemoteRecord, slug: string): Promise<InstallSummary>;
    /**
     * Scan every marketplace package statically and join with the live roster.
     * Never executes package content.
     */
    scan(presets: AgentPresetsLike): Promise<MarketPackage[]>;
    /**
     * Install one market package as an expert preset. Throws with a readable
     * message on any validation failure; nothing is written unless the
     * read-back gate passes.
     */
    install(presets: AgentPresetsLike, marketplace: string, dirName: string): Promise<InstallSummary>;
    /**
     * Uninstall one expert: remove the preset through the roster service
     * (native semantics keep live sessions running), then delete the market
     * package directory.
     */
    uninstall(presets: AgentPresetsLike, presetId: string, opts: {
        deletePackage: boolean;
        marketplace?: string;
        dirName?: string;
    }): Promise<{
        ok: true;
        presetRemoved: boolean;
        packageRemoved: boolean;
    }>;
    /**
     * Read the client-facing metadata an installed expert preset carries.
     * Returns undefined when the preset is missing or carries no expert meta
     * (a hand-authored preset).
     */
    presetMeta(presets: AgentPresetsLike, presetId: string): Promise<{
        displayName?: {
            zh?: string;
            en?: string;
        };
        profession?: {
            zh?: string;
            en?: string;
        };
        expertType?: string;
        quickPrompts?: Array<{
            zh?: string;
            en?: string;
        }>;
        defaultInitPrompt?: {
            zh?: string;
            en?: string;
        };
        disable?: string[];
        enable?: string[];
        featured?: boolean;
    } | undefined>;
    /** Whether an installed expert's baseline has drifted (P2-1 upgrade hint). */
    baselineDrift(presets: AgentPresetsLike, presetId: string): Promise<boolean | undefined>;
    private userPresetRoot;
    private appendInstallLog;
}
/** stat helper re-export for route handlers that need file sizes. */
export declare function fileSize(path: string): Promise<number | undefined>;
