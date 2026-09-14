# Hackathon log

- **Project:** Backpack
- **Event:** Convex All Gas Hackathon
- **What it does:** Points at a school's website and takes in the school mail a family forwards, and keeps one live shared board of what that family actually has to do — forms to sign, money to send, days off, things to bring — with the sentence from the source that says so.
- **Live app:** https://secret-minnow-38.convex.site (development deployment)
- **Repo:** none
- **Frontend:** Convex static hosting
- **Convex deployment:** https://secret-minnow-38.convex.cloud (development)
- **Components:** @convex-dev/static-hosting, @convex-dev/auth (core, username, password provider), @firecrawl/firecrawl-convex, @agentmail/convex, @convex-dev/workpool, @convex-dev/rate-limiter, @convex-dev/presence
- **Convex features:** schema with indexes, reactive queries, mutations, actions, internal functions, HTTP actions, typed component environment, the scheduler, pagination, cron jobs, static hosting
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
routes: static hosting wants `/`, Firecrawl and Convex Auth mount their own,
and our AgentMail webhook needs a stable URL. `defineApp({ httpPrefix: "/api" })`
with static hosting mounted at `/` gives the SPA the root.

The nesting rule is not the one a reading of other entries suggested, and only
probing the deployed routes settled it: **the app-level `httpPrefix` applies to
the app's own router only** — `convex/http.ts` routes move under `/api` — while
**each component's `httpPrefix` is rooted at the deployment root** regardless.
So the live surface is:

| Route | Owner |
| --- | --- |
| `/` | static hosting (the SPA) |
| `/api/agentmail/webhook` | our `convex/http.ts` |
| `/firecrawl/webhook` | the Firecrawl component |
| `/auth/.well-known/jwks.json` | the Convex Auth component |

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

### 2026-09-13 — the frontend, and two things only running it could find

Built the React client and put it on `convex.site` through the static-hosting
component.

The design is deliberately not a dashboard. Backpack is what comes home in a
child's backpack, so the surface is paper: a warm stock, hairline rules, a
folder tab down the left of each line coloured by what kind of thing it is, and
the quoted notice set in a typewriter face because the one thing on screen that
must read as *verbatim* is the sentence the school actually wrote. Three
voices — Fraunces for the printed notice, Instrument Sans for the hand that
fills the form, IBM Plex Mono for dates, counts and evidence.

The board is an agenda rather than a card grid: one ruled column grouped by how
soon (past due, today, this week, later, no date), which is the order a family
meets them in. Controls sit in the date column, so a row costs no vertical
space it does not need and twenty lines still scan in one screen.

Running it turned up two faults that no amount of typechecking would have:

- **Sign-up succeeded and then every request was rejected** with "No auth
  provider found matching the given token". The deployment had no
  `convex/auth.config.ts` — the alpha CLI crashes on Windows before writing
  one. The fix is not the documented OIDC shape either: the token's `iss` is
  the deployment origin, but the auth component mounts its routes under
  `/auth`, so the key set is at `/auth/.well-known/jwks.json` and an OIDC
  provider would derive the wrong location. `customJwt`, which states issuer
  and JWKS separately, is what actually works.
- **The phone layout led with the settings panel**, burying the board under its
  own configuration. An explicit `order` was inverting the source order for no
  reason.

Verified on the deployed origin, not just locally: signed up, created a
household, seeded the worked example, claimed a card — and watched the row
tint, the header count and the activity log all move off one mutation, which is
the whole premise of a shared board.

### 2026-09-13 — state

Frontend and backend both live on the development deployment at
https://secret-minnow-38.convex.site, `tsc --noEmit` clean across both
projects. Auth, the board, claiming, the evidence drawer and the activity log
are working end to end.

Not yet proven: anything that spends a third-party key. `FIRECRAWL_API_KEY`,
`AGENTMAIL_API_KEY` and `OPENAI_API_KEY` are still provisioning placeholders,
so no crawl, no extraction and no mail has run. The board above is the seeded
worked example — openly fictional, and labelled as such in `convex/seed.ts`.
