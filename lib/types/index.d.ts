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
import type { Context } from 'cordis';
import { type AgentPresetsLike } from './market.js';
import z from 'schemastery';
type RouteResponse = {
    writeHead(status: number, headers: Record<string, string>): RouteResponse;
    end(body?: string): RouteResponse;
};
type RouteHandler = (req: IncomingRequest, res: RouteResponse) => void;
interface IncomingRequest {
    url?: string;
    on(event: string, listener: (chunk?: Buffer) => void): IncomingRequest;
}
type WebServer = {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: RouteHandler;
    }): () => void;
};
interface SessionHeaderLike {
    agentPreset?: string;
}
type AppContext = Context & {
    webServer?: WebServer;
    agentPresets?: AgentPresetsLike;
    sessions?: {
        list(): Array<{
            id?: string;
            header?: SessionHeaderLike;
        }>;
    };
};
declare module 'cordis' {
    interface Context {
        webServer?: WebServer;
        agentPresets?: AgentPresetsLike;
        sessions?: {
            list(): Array<{
                id?: string;
                header?: SessionHeaderLike;
            }>;
        };
    }
}
/** Plugin config (deployment-varying choice, no hardcoded root). */
export interface Config {
    /** Marketplaces root; empty resolves to <dshHome>/experts/marketplaces. */
    marketplacesRoot: string;
}
export declare const name = "dsh-expert-market";
export declare const inject: never[];
export declare const Config: z<Schemastery.ObjectS<{
    marketplacesRoot: z<string, string>;
}>, Schemastery.ObjectT<{
    marketplacesRoot: z<string, string>;
}>>;
export declare function apply(ctx: AppContext, config: Config): void;
export {};
