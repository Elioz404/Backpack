/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as board from "../board.js";
import type * as budget from "../budget.js";
import type * as children from "../children.js";
import type * as crawls from "../crawls.js";
import type * as crons from "../crons.js";
import type * as households from "../households.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as lib_agentmail from "../lib/agentmail.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_firecrawl from "../lib/firecrawl.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_openai_client from "../lib/openai/client.js";
import type * as lib_openai_compose from "../lib/openai/compose.js";
import type * as lib_openai_extraction from "../lib/openai/extraction.js";
import type * as lib_pools from "../lib/pools.js";
import type * as lib_text from "../lib/text.js";
import type * as lib_time from "../lib/time.js";
import type * as model_activity from "../model/activity.js";
import type * as model_auth from "../model/auth.js";
import type * as model_budget from "../model/budget.js";
import type * as model_crawls from "../model/crawls.js";
import type * as model_example from "../model/example.js";
import type * as model_households from "../model/households.js";
import type * as model_obligations from "../model/obligations.js";
import type * as model_sources from "../model/sources.js";
import type * as pipelines_crawlIngest from "../pipelines/crawlIngest.js";
import type * as pipelines_extract from "../pipelines/extract.js";
import type * as pipelines_mailIngest from "../pipelines/mailIngest.js";
import type * as pipelines_recrawl from "../pipelines/recrawl.js";
import type * as presence from "../presence.js";
import type * as questions from "../questions.js";
import type * as schools from "../schools.js";
import type * as seed from "../seed.js";
import type * as sources from "../sources.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  board: typeof board;
  budget: typeof budget;
  children: typeof children;
  crawls: typeof crawls;
  crons: typeof crons;
  households: typeof households;
  http: typeof http;
  inbox: typeof inbox;
  "lib/agentmail": typeof lib_agentmail;
  "lib/config": typeof lib_config;
  "lib/firecrawl": typeof lib_firecrawl;
  "lib/limits": typeof lib_limits;
  "lib/openai/client": typeof lib_openai_client;
  "lib/openai/compose": typeof lib_openai_compose;
  "lib/openai/extraction": typeof lib_openai_extraction;
  "lib/pools": typeof lib_pools;
  "lib/text": typeof lib_text;
  "lib/time": typeof lib_time;
  "model/activity": typeof model_activity;
  "model/auth": typeof model_auth;
  "model/budget": typeof model_budget;
  "model/crawls": typeof model_crawls;
  "model/example": typeof model_example;
  "model/households": typeof model_households;
  "model/obligations": typeof model_obligations;
  "model/sources": typeof model_sources;
  "pipelines/crawlIngest": typeof pipelines_crawlIngest;
  "pipelines/extract": typeof pipelines_extract;
  "pipelines/mailIngest": typeof pipelines_mailIngest;
  "pipelines/recrawl": typeof pipelines_recrawl;
  presence: typeof presence;
  questions: typeof questions;
  schools: typeof schools;
  seed: typeof seed;
  sources: typeof sources;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
  auth: import("@convex-dev/auth/core/_generated/component.js").ComponentApi<"auth">;
  authUsername: import("@convex-dev/auth/username/_generated/component.js").ComponentApi<"authUsername">;
  authPasswordProvider: import("@convex-dev/auth/providers/password/_generated/component.js").ComponentApi<"authPasswordProvider">;
  authAnonymous: import("@convex-dev/auth/providers/anonymous/_generated/component.js").ComponentApi<"authAnonymous">;
  firecrawl: import("@firecrawl/firecrawl-convex/_generated/component.js").ComponentApi<"firecrawl">;
  extractionPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"extractionPool">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
};
