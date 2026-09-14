# Hackathon log

- **Project:** Backpack
- **Event:** Convex All Gas Hackathon
- **What it does:** Points at a school's website and takes in the school mail a family forwards, and keeps one live shared board of what that family actually has to do — forms to sign, money to send, days off, things to bring — with the sentence from the source that says so.
- **Live app:** https://resilient-mastiff-559.convex.site
- **Repo:** https://github.com/Elioz404/Backpack (public)
- **Frontend:** Convex static hosting
- **Convex deployment:** https://resilient-mastiff-559.convex.cloud (production); secret-minnow-38 (development)
- **Components:** @convex-dev/static-hosting, @convex-dev/auth (core, username, password provider), @firecrawl/firecrawl-convex, @convex-dev/workpool, @convex-dev/rate-limiter, @convex-dev/presence
- **Convex features:** schema with indexes, reactive queries, mutations, actions, internal functions, HTTP actions, typed component environment, the scheduler, pagination, cron jobs, static hosting
- **Auth:** Convex Auth
- **AI models:** gpt-5.6-luna (OpenAI Responses API, strict JSON schema), configurable through `OPENAI_MODEL`
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

### 2026-09-13 — running it against real keys

With real Firecrawl, AgentMail and OpenAI keys on the deployment, the pipeline
was run end to end against a real school site. Three things only this could
find, and one of them changed the architecture.

**Firecrawl works as designed.** A crawl of bostonpublicschools.org read 40
pages for 40 credits and landed 40 sources — the durable crawl, the completion
callback, the batched ingestion and the content-hash dedupe all behaved.

**`@agentmail/convex@0.1.0` cannot be configured, and has been removed.** The
component reads `process.env.AGENTMAIL_API_KEY` inside its own isolate, where
deployment variables are not visible, and its `convex.config` declares no typed
environment to pass one in — so every call that reaches the API fails with
"AGENTMAIL_API_KEY is not set on this Convex deployment" while the key is
plainly set. 0.1.0 is the latest published version. Convex has no
component-scoped `env set`, so the only ways through are patching the package
or vendoring it, and both mean owning code we cannot vouch for.

AgentMail is now reached over its REST API from `convex/lib/agentmail.ts`:
create an inbox, send a message, verify a Svix signature. The signature check
is Web Crypto HMAC against `id.timestamp.body` with a five-minute replay window
and a constant-time compare, rather than the `svix` package, which targets Node
and would force the webhook route into a Node action. Nothing was lost by it —
the state that matters was always in our own tables — and the household now has
a real address, `jealouscard638@agentmail.to`, created through that client.

**The `openai` package does not run in the Convex runtime.** It sets
`url.username` while normalising a request, which the runtime does not
implement: every one of the 40 extractions failed with "Not implemented: set
username for URL. Consider calling an action defined in Node.js instead". The
same treatment fixed it — one `respondJson` over the Responses API, strict JSON
schema intact, retry on 429 and 5xx only.

**And one real defect of our own.** After that first failed batch, the board
reported "1 page could not be read" when 39 more were stranded. `sources`
carried a `running` state that the extraction pool already owned, so a job the
pool dropped left the row in a state nothing counted and nothing retried —
exactly the quiet gap the unread card exists to prevent. The state is gone: a
source is unread until it is `done` or `failed`, both terminal, and the health
count now asks "not done" rather than naming states it might not know about.
The schema push validated every existing row against the narrower union, which
is the proof no row was left behind. `sources.retryUnread` re-queues them
without re-crawling, because the pages are already stored.

### 2026-09-13 — making it affordable on a $5 budget

The operator has five dollars of OpenAI credit, which is a real design
constraint and not a footnote: one crawl of a large district site fans out to
forty model calls, and a weekly cron repeats it.

Measured first. Over the 40 pages already crawled from
bostonpublicschools.org, the input at the old settings came to 810,000
characters — about 200k tokens, roughly **$0.57 a crawl** at `gpt-5.6-terra`.
Eight crawls would have emptied the budget.

The obvious idea did not survive contact. A cheap prefilter — skip any page
with no date, no amount and no phrase asking something of a reader — was
written and dry-run over those same 40 stored pages, costing nothing. It
skipped **zero** of them, and so did every variant tried, including one
requiring an explicit request. The reason is structural: a school site repeats
its navigation on every page, so every page contains "no school", a weekday and
a date no matter what it is about. A better regex cannot fix that, and the
filter was deleted rather than kept as reassurance that does nothing.

What the measurement did show is where the money actually goes:

- **Clamping the model's view to 8,000 characters** cuts the same crawl from
  810,000 characters to 321,000 — 60%, for free. School sites put the notice
  near the top and the rest is chrome already paid for on the page before.
- **`gpt-5.6-luna` costs a tenth of `gpt-5.6-terra`** ($0.20 vs $2.00 per
  million input tokens) and is the right shape of model for this work: the
  strict schema does the structuring and the verbatim-quote check catches what
  it does not, so the judgement a larger model buys is mostly wasted.

Together those take a 40-page crawl from about **$0.57 to about $0.03** — from
eight crawls on the budget to well over a hundred.

And because the pipeline runs unattended, a hard ceiling was added rather than
a warning. Every model call reports its token usage; `apiSpend` accumulates it
in integer micro-cents against a price table, and both entry points refuse
before spending once `OPENAI_BUDGET_CENTS` is reached. A budget refusal is not
rethrown into the pool's retry, because retrying a refusal only burns the retry
slots — the page stays unread and the board says so. The spend is on screen in
the app, because a number you have to find in a dashboard is one you find too
late.

### 2026-09-13 — production

Deployed to production at https://resilient-mastiff-559.convex.site, with its
own signing keys, its own copies of the three service keys, and its own spend
ceiling of 200 cents — separate from development's 100, so the two ledgers
together cannot reach the account's $5 without a deliberate change.

Verified on the production origin rather than assumed: the routes answer
(`/` the SPA, `/auth/.well-known/jwks.json`, `/firecrawl/webhook` on POST), the
published bundle points at the production backend, and a fresh account was
created against the empty production database — sign-up, household, board.

`AGENTMAIL_WEBHOOK_SECRET` was unset at first, so the inbound route answered
503 and refused — without the secret there is no way to tell AgentMail apart
from anyone who has guessed the URL. The webhook was then registered against
the production URL through AgentMail's API and its signing secret piped
straight onto the deployment, and the route now answers **401 to an unsigned
request and 401 to a forged signature**, which is the verification doing its
job.

It subscribes to `message.received` only. AgentMail also reports
`.unauthenticated`, and it was tempting because a forwarding hop can break SPF
— but this product's whole claim is that a line on the board is something the
school actually said, and ingesting mail that failed authentication would let
anyone who learns a household's address put an obligation on its board. A
dropped forward is a visible annoyance; an injected deadline is not.

Also removed two leftovers from the Vite template, `public/icons.svg` and
`public/favicon.svg`, which nothing referenced and which were being uploaded on
every deploy — the sprite still carried a Bluesky icon. The published site is
four files.

### 2026-09-14 — the whole pipeline, end to end, for the first time

A real message was sent from one AgentMail inbox to the production household's
address — a school notice about a Year 4 aquarium trip, with a consent form, a
$12.00 fee, two dates and a packed lunch.

Everything downstream ran on its own, and the ledger says exactly what it
should: **one webhook delivery, one source, one model call**, 789 input tokens
and 930 output, **0.127 cents**. Out of it came five cards, each with the
sentence from the notice that supports it:

| | |
| --- | --- |
| Return the signed consent form | form, due 26 Sept |
| Pay the visit fee | money, US$12, due 26 Sept |
| Note the aquarium visit | event, 30 Sept at 08:45 |
| Pack a lunch and named water bottle | bring, 30 Sept |
| Note that school uniform is not required | note, 30 Sept |

One detail worth recording, because it looked like a bug and is the opposite.
The notice said "Friday 26 September" and "Tuesday 30 September"; the board
renders "Sat 26 Sept" and "Wed 30 Sept". In 2026 the 26th is a Saturday and the
30th is a Wednesday — the notice (written by hand for the test) had
inconsistent weekday/date pairs, and the extractor took the dates, resolved
them in the household's zone, and rendered the true weekday rather than
repeating the text's mistake.

The board did show "1 CALLS", which was a real if small defect in the rail's
pluralisation, now fixed.

### 2026-09-13 — state

Live on the development deployment at https://secret-minnow-38.convex.site,
`tsc --noEmit` clean across both projects.

Proven against real services, end to end: Convex Auth, the board and its live
updates, Firecrawl's durable crawl (40 real pages ingested), AgentMail inbox
creation, signed inbound webhooks, and OpenAI extraction — a real email became
five correctly typed, dated and quoted cards for 0.127 cents.

**Blocked on one thing: the OpenAI account has no credit.** Every extraction
returns `credit_balance_exhausted`, so the 40 crawled pages are stored and
queued but unread, and the board still shows only the seeded worked example —
openly fictional, and labelled as such in `convex/seed.ts`. The moment credit
is added, "Try reading again" reads all 40 for roughly three cents, without
spending another Firecrawl credit. Outbound mail is likewise written but
unsent, because drafting the question is an OpenAI call.
