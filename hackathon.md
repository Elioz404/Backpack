# Hackathon log

- **Project:** Backpack
- **Event:** Convex All Gas Hackathon
- **What it does:** Points at a school's website and takes in the school mail a family forwards, and keeps one live shared board of what that family actually has to do — forms to sign, money to send, days off, things to bring — with the sentence from the source that says so.
- **Live app:** not deployed
- **Repo:** none
- **Frontend:** Convex static hosting
- **Convex deployment:** https://secret-minnow-38.convex.cloud (development)
- **Components:** @convex-dev/static-hosting, @convex-dev/auth (core, username, password provider), @firecrawl/firecrawl-convex, @agentmail/convex, @convex-dev/workpool, @convex-dev/rate-limiter, @convex-dev/presence
- **Convex features:** schema with indexes, reactive queries, mutations, actions, internal functions, HTTP actions, typed component environment, the scheduler, pagination, cron jobs
- **Auth:** Convex Auth
- **AI models:** gpt-5.6-terra (OpenAI Responses API, strict JSON schema), configurable through `OPENAI_MODEL`
- **Started:** 2026-09-13
- **Last updated:** 2026-09-13

## Log

### 2026-09-13 — the field, and what it left open

Before writing anything, surveyed the competition: ~45 candidate repos through
the GitHub API and the 21 apps carrying the `AllGasHackathon` tag on
vibeapps.dev, with commit counts measured rather than eyeballed.

Two findings shaped the product. First, the field has converged on a single
archetype — forward an email, an LLM extracts, Firecrawl verifies against an
official page, a cited reply comes back — and roughly twenty entries are that
same machine, almost all of them single-user. Second, of the entries GitHub has
indexed, only one calls Firecrawl's `startCrawl`; everyone else uses one-shot
`scrape`, so the durable crawl the component exists for is nearly untouched.

Backpack is built against both gaps: it is multi-person and live-shared, which
is the one thing the archetype cannot produce and the thing Convex is actually
for, and the crawl is a durable one whose progress the board subscribes to.

### 2026-09-13 — wiring and the routing decision

Scaffolded Vite + React + TypeScript with Convex as the backend, and registered
eight component mounts (fifteen including their own sub-components).

The one real architectural decision was HTTP routing, because three things want
routes: static hosting wants `/`, Firecrawl mounts its own webhook, and our
AgentMail webhook needs a stable URL. Resolved by reading two deployed
hackathon entries rather than guessing: a component's `httpPrefix` nests under
the app-level one, so `defineApp({ httpPrefix: "/api" })` with static hosting
mounted at `/` gives the SPA the root and puts every callback under `/api/…`.

Secrets are declared once in `convex.config.ts` as typed component environment
and passed to the components that need them, so nothing reads a raw
`process.env` and no key travels through function arguments.

Two upstream problems, both recorded rather than worked around quietly:

- `npx @convex-dev/auth` (2.0.0-alpha.1) cannot set the signing keys on
  Windows — it shells out with `spawnSync("npx", …)` and no `shell: true`, so
  it cannot launch `npx.cmd`. `scripts/generate-auth-keys.mjs` produces the
  same RS256 key pair and prints the two commands to run.
- `@agentmail/convex@0.1.0` declares `handleWebhook(ctx: RunMutationCtx, …)`,
  a *mutation* context, but a webhook can only be served from an `httpAction`.
  Its own documented usage does not typecheck against any current Convex. The
  runtime behaviour is correct, so the mismatch is bridged with one commented
  assertion at that single seam in `convex/http.ts`, rather than by patching
  the dependency.

### 2026-09-13 — the domain, and the grounding guarantee

The schema is nine tables around one tenant boundary: a household owns its
children, schools, crawl runs, sources, obligations, questions and history, and
every public function passes through `requireMembership` so the rule is
enforced in one place.

The core of it is how a claim gets onto the board. The extractor answers
against a strict JSON schema, so there is no prose to parse — but the rule that
matters is that every item must carry a sentence copied verbatim from the
source, and that claim is then **checked against the actual text**. An item
whose quote is not found in its source is discarded, not flagged. The model
cannot put something on a family's board that the source does not say.

Around that:

- **Dedupe at two levels.** Sources are keyed by the SHA-256 of their
  normalised text, so a page re-crawled unchanged never reaches the model at
  all. Obligations are keyed by a fingerprint built from meaning — kind, date,
  normalised title — so the same deadline announced on the site and again in a
  reminder email collapses onto one card instead of two.
- **Settled work stays settled.** A `done` or `dismissed` item is never
  reopened by a later sighting, and a claim survives a revision.
- **Dates are local.** A school deadline is a local date, so every extracted
  `YYYY-MM-DD` is resolved against the household's own IANA zone, including
  daylight-saving transitions, rather than being treated as UTC.

### 2026-09-13 — the four sponsors, and what each actually does

- **Firecrawl** runs the durable crawl of the school site. `startCrawl` returns
  immediately, pages stream into the component's tables, and the board
  subscribes to `getCrawl` for live progress. The completion callback is
  resolved through Firecrawl's own `context` passthrough rather than the crawl
  id, because the run row exists before the id does and that window would
  otherwise be a race.
- **OpenAI** reads each source into structured obligations under the grounding
  rule above, and drafts the question to the school office.
- **AgentMail** gives the household one address. Inbound mail is verified and
  deduped by the component, then routed: a reply on a thread we opened closes
  the question that opened it, anything else becomes a new source. Outbound
  sends are enqueued from a mutation, so a question row and its message commit
  together. One inbox per household, not per child or per school, because the
  free tier allows three in total — threads and labels already separate
  conversations, and one address is what a parent can remember to forward to.
- **Convex** is the whole backend: the board is one live query, the crawl
  progress another, and presence makes the second parent visible on the same
  board.

Two components earn their place by bounding spend rather than by adding
features. A finished crawl can land a hundred pages in one callback and each
page is one model call, so extraction goes through a **workpool** with a fixed
number in flight instead of a hundred scheduled actions. And because crawling
spends Firecrawl credits and extraction spends OpenAI budget on the operator's
own keys, both entry points are **rate limited** per household.

A weekly cron re-reads every school site. It is affordable precisely because of
the content-hash dedupe: a sweep over an unchanged site reaches the model zero
times.

### 2026-09-13 — state

Backend complete: `tsc --noEmit` clean and pushed to the development
deployment, with all eight components installed. Not yet built: the React
frontend, and therefore no live URL. Placeholder values are on the deployment
for `FIRECRAWL_API_KEY`, `AGENTMAIL_API_KEY` and `OPENAI_API_KEY`, so no
external call has been made yet and nothing in the pipeline has run end to end.
