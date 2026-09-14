# Hackathon log

- **Project:** Backpack
- **Event:** Convex All Gas Hackathon
- **What it does:** Points at a school's website and takes in the school mail a family forwards, and keeps one live shared board of what that family actually has to do — forms to sign, money to send, days off, things to bring — with the sentence from the source that says so.
- **Live app:** https://resilient-mastiff-559.convex.site
- **Repo:** https://github.com/Elioz404/Backpack (public)
- **Frontend:** Convex static hosting
- **Convex deployment:** https://resilient-mastiff-559.convex.cloud (production); secret-minnow-38 (development)
- **Components:** @convex-dev/static-hosting, @convex-dev/auth (core, username, password and anonymous providers), @firecrawl/firecrawl-convex, @convex-dev/workpool, @convex-dev/rate-limiter, @convex-dev/presence
- **Convex features:** schema with indexes, reactive queries, mutations, actions, internal functions, HTTP actions, typed component environment, the scheduler, pagination, cron jobs, static hosting
- **Auth:** Convex Auth
- **AI models:** gpt-5.6-luna (OpenAI Responses API, strict JSON schema), configurable through `OPENAI_MODEL`
- **Started:** 2026-09-14T01:00:45Z
- **Last updated:** 2026-09-14T22:27:07Z

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
  together. Households share a single inbox and are told apart by sub-address,
  so the free tier's three-inbox limit caps inboxes rather than tenants.
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
a real address, [redacted inbox], created through that client.

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

### 2026-09-14 — auditing against the criteria, and what the audit found

Re-read the rules and audited the code against each judging line rather than
from memory. Two things the rules settle: Codex is required only for
`chatgpt.site`, and "Feel free to use your favorite IDE" covers the rest; and
nothing mandates the official Convex components for the partners — the bar is
that they "do real work... not just sit in the README".

Counted from the source: 12 public queries, 13 mutations, 3 actions, 33
internal functions, one HTTP action, 24 indexed reads and no unindexed filter,
54 return validators, 13 live `useQuery` subscriptions, 8 component mounts,
crons, scheduler, pagination. Firecrawl is exercised through `startCrawl`,
`getCrawl` and `listPages` — the durable path, not one-shot scrape. OpenAI runs
two distinct schema-constrained jobs. AgentMail both sends and receives, with
signature verification.

The audit found two real defects, neither of which a code reading would have
caught.

**The school's office address was unreachable.** `schools.add` accepted an
`officeEmail`, the question composer required one, and the form never asked for
it — so "Ask the school" could never work for any real user, and an entire
sponsor path was dead in the shipped product. The field is now on the form, and
a school without one says so on its card.

**An obligation restated in different words became a second card.** Asking the
school about the consent form produced a reply that was read onto the board —
correctly — but as *new* items: "Pay for the aquarium trip" landed beside "Pay
the visit fee", both the same $12 on the same date. The fingerprint is lexical,
and no amount of normalising makes those two strings match.

The fix is to ask the thing that can judge equivalence. The extractor is now
shown the household's open board and answers a `supersedes` field naming the
item it is looking at again — for a restatement or for a changed deadline,
which a fingerprint built from the date cannot match by construction. The merge
resolves that title to the row and revises it in place, carrying the new
fingerprint so the original notice cannot re-create the card on the next crawl.

Proven on production with the same class of input that caused it: before the
change, two `obligation_created`; after, two `obligation_revised` and the board
count unchanged.

### 2026-09-14 — the full AgentMail loop

The one path never exercised: a question to the school, and its answer coming
back. Asked from a card — the composer quoted the notice back and asked only
what the parent asked, committing to nothing — sent from the household address,
answered from the office, and the reply closed the question and was read onto
the board as a source in its own right. Three model calls for the whole
exchange: 0.21 cents.

### 2026-09-14 — one inbox, any number of households

The three-inbox free tier was the last hard wall: a household got an inbox of
its own, so the fourth family could not have an address at all. It turned out
not to be a wall.

AgentMail delivers sub-addressed mail. A probe to `<inbox>+household7@` reached
the inbox, fired the webhook and was ingested — which is not in their
documentation either way, so it was worth finding out rather than assuming.

Households now share one inbox and are told apart by the tag: each gets
`<inbox>+<householdId>@`, and inbound mail is routed on the address it was
addressed to. That single indexed lookup covers both shapes, because a
household created before this stores the bare inbox address and matches the
same way — nothing already live had to change.

A guarded second path accepts a tag that names a real household whose address
we have not stored, but only when that household actually claimed this inbox,
so a guessed id cannot put mail on somebody else's board.

Proven in production with two households on one inbox: a notice sent to the
second household's sub-address produced one correctly typed obligation on its
board and left the first household's seven untouched.

It is also the better shape with or without the meter. A household is a tenant,
not a mailbox, and the deployment now needs exactly one mailbox forever.

### 2026-09-14 — the component defect, independently confirmed

The `@agentmail/convex` problem diagnosed here on 2026-09-13 was found four
days earlier by someone else:
[agentmail-to/convex#6](https://github.com/agentmail-to/convex/pull/6), opened
2026-09-10, states the same cause — "component functions do not inherit the
app's environment variables, so `AGENTMAIL_API_KEY` ... must be declared and
explicitly bound" — and fixes it by declaring typed component env. It is open
and unmerged, so npm still ships the broken 0.1.0 and the REST client here
stays.

### 2026-09-14 — the trial is the product, not a tour of it

The public example board was read-only, because it was one shared board and a
visitor who could change it would change what the next visitor saw. That made
it a display case: it showed what the pipeline produces and hid the thing that
distinguishes the app, which is two people moving the same list. Nothing on it
could be pressed.

The reason it existed — that a judge could not get an inbox on a three-inbox
tier — had already been removed by sub-addressing. So it was replaced rather
than patched.

`/demo` now signs the visitor in anonymously through Convex Auth's anonymous
provider, creates them a household in their own name, fills it with the worked
example and falls through to the ordinary board. It is a real session: their
own household, their own address, every control live, private to them. There is
no second, lesser version of the app to keep working, because it is the same
code path a signed-up family uses.

The two pieces compose, which is what makes it free: anonymous sessions give
unlimited trial households, and sub-addressing gives each one a real address
without consuming an inbox. Verified from a cleared browser — no account,
board in a few seconds, claimed a card and watched the header move to
"9 OPEN · 1 TAKEN", then pressed Get an address and received
`helpfulwinter244+<householdId>@agentmail.to` with the inbox count unmoved.

### 2026-09-14 — what is seeded and what is real

The trial board starts with nine written cards rather than extracted ones, so
that a new board has something on it in under a second instead of after a
four-minute crawl. Each says so on its own source line — "an example, not a
real school" — because a demo that looks like real family data is how a demo
ends up lying.

But the two controls that spend a sponsor's API pointed at
`example-primary.test`, a reserved TLD that cannot resolve. So the first thing
any visitor would press failed: the crawl ran against nothing, and Ask the
school composed a question with a real model call and then bounced it off a
domain that does not exist. The seeded half was honest; the live half was
broken, which is the worse way round.

The example school now points at a real, public, crawlable site and an address
that really receives, with a crawl limit of eight — every page is one OpenAI
request against a daily cap of fifty, and this is the button a first-time
visitor presses, so it should finish while they are watching and leave the
day's allowance for the person after them.

Verified from a cleared browser with no account: opened `/demo`, pressed Read
the site, and watched a real Firecrawl crawl of a school district's family
pages produce five genuine obligations — "Complete annual forms", "Confirm
information on file with the district", "Fill in the contact form" — taking the
board from nine cards to fourteen for one cent.

So: the starting cards are written, everything a visitor presses is real.

### 2026-09-14 - bed9271 — the other parent, by username

The product's whole claim is two people on one board, and there was no way to
add the second one: `addMember` took a user id with nothing in the interface to
obtain one, so a household could only ever hold the person who created it. It
now takes the username they signed up with, resolved through the auth
component, and the rail asks for it. By username rather than an emailed link,
so the central feature does not wait on mail being deliverable. Convex
features: mutation, component query (`convex/households.ts`,
`src/components/Rail.tsx`).

### 2026-09-14 - b113dc9 — one command to deploy

`npm run build` bakes `VITE_CONVEX_URL` from `.env.local`, which is the dev
deployment — so building by hand and uploading the result publishes a
production site whose client talks to dev. It did, until it was caught. The
static-hosting CLI injects the right URL when it runs the build itself, and
`npm run deploy` is now the only path (`package.json`).

### 2026-09-14 - 4163d18 — the school's reply, to the household that asked

Two faults, both introduced when households moved from an inbox each to
sub-addresses of one shared inbox. A question went out from the bare shared
address, so the reply came back carrying no household tag; Reply-To now names
the household's own sub-address, with a fallback to the thread the deployment
opened when a mail client answers the From address instead.

Worse, untagged mail matched `by_inbox_address` against the bare address —
which one household still held — and the school's answer landed on a stranger's
board. Routing now takes the tag first, then the thread, and never matches the
shared address itself; a reply also only closes a question belonging to the
same household (`convex/pipelines/mailIngest.ts`, `convex/questions.ts`,
`convex/lib/agentmail.ts`).

### 2026-09-14 - 3936ade — say why a sign-up was refused

Six of the auth component's error codes had no message, so they all surfaced as
"Something went wrong" — including `USERNAME_TAKEN`, by some distance the most
likely way that form fails and the easiest to act on once the form says so. Hit
it while recording the demo (`src/components/AuthScreen.tsx`).

### 2026-09-14 - cd40bd5 — the board on a large screen

The layout was capped at one width forever, so on a 1080p monitor it used just
over half the screen and the rest was empty ground. 80rem from the 2xl
breakpoint, with a slightly wider rail (`src/components/Board.tsx`).

### 2026-09-14 - c22e44c — twelve pages, not eight

Eight was chosen to be frugal with the daily model allowance, but a section
root spends its first pages on navigation: a crawl of the seeded school read
eight pages, found nothing carrying a date, and correctly produced no cards —
the pipeline working and looking broken. Twelve reaches the pages that carry
deadlines and still leaves most of the day's allowance
(`convex/model/example.ts`).

### 2026-09-14 - 6e25019 — carrying a trial board onto a real account

Trying Backpack without signing up gives a genuine household: a school, an
address that receives, children, cards someone has claimed. Signing up
afterwards minted a brand new empty user and left all of it stranded, because
the anonymous account has no credentials to go back in with — the exact path
someone takes once they have decided they like it.

The auth component has no account linking, so the hand-off is done at the app
level with a single-use ticket: minted by the household's owner while the trial
session can still prove it owns the household, redeemed by whoever they sign up
as. The household moves rather than being shared. Refused when the account
already has one of its own, and that refusal is handed to the board to say,
since establishing the session replaces the screen that would have said it.
Convex features: table with indexes, mutations (`convex/schema.ts`,
`convex/households.ts`, `src/lib/trialClaim.ts`).

### 2026-09-14 - 2830a9b — bounding the deployment, not just the household

Both rate limits were keyed by household: two crawls back to back then six an
hour, five questions then twenty a day. That bounds one family and nothing
else. `/demo` hands a household to anyone who asks, so a loop over that URL
collects a fresh allowance every time and can spend the day's Firecrawl credits
and the model budget by itself. The budget ceiling would stop the spending, but
it stops it for the next honest visitor too.

Two unkeyed buckets now sit alongside — one on handing out a trial board, one
on starting a crawl at all — unkeyed because an anonymous visitor offers
nothing stable to key on. The limiter's refusal is explained with when to come
back rather than swallowed (`convex/lib/limits.ts`, `convex/lib/config.ts`,
`convex/crawls.ts`, `convex/households.ts`, `src/lib/errors.ts`).

### 2026-09-14 - 12250b0 — work in progress is not work that failed

A page being read right now is `pending`. A page whose job died is also
`pending`. The rail counted both as "not read yet", so every ordinary crawl
announced a dozen failures while it was working perfectly, under a button
offering to retry work that was already running.

Pressing it did not just look wrong: `retryUnread` set each row back to
`pending` and enqueued it again, which does not cancel the job already carrying
that page, so those pages were read — and paid for — twice. Health now
separates in flight from stuck, reports the first quietly and without a button,
and offers the retry only for rows that have failed or have sat pending past
five minutes. `skipped` is not counted at all: a page with nothing on it worth
doing was read correctly (`convex/sources.ts`, `src/components/Rail.tsx`).

### 2026-09-14 - b52fd4c — the first screen, saying what it is

A new board arrives with sample cards so it is not empty, and for the first few
seconds that is all a visitor sees. Every one of them carried the label "Parent
newsletter — an example, not a real school", which the row truncated to "an
example, not a r…" — a disclaimer repeated nine times and cut off mid-word. The
honest thing was being said in the way most likely to make the whole app read
as a mock-up of itself.

The label is "(sample)" now, and above the board, while nothing real has been
read yet, one line says so and carries the button that fixes it — so the
interesting part is one press away rather than something to find in the rail.
Sources are marked `seeded`, so the board can tell a sample-only household from
one that has read something, and the line removes itself the moment it has
(`convex/model/example.ts`, `convex/schema.ts`, `convex/sources.ts`,
`src/components/Board.tsx`).

### 2026-09-14 — state

Live in production at https://resilient-mastiff-559.convex.site, with the whole
product reachable without an account at `/demo` — a real anonymous session, a
real household, a real address, every control live. `tsc --noEmit` clean across
both projects.

Proven end to end against real services, and repeatedly rather than once: a
Firecrawl durable crawl of a real public school site reading twelve pages into
twelve new obligations, each carrying the sentence it came from and a link back
to the page; real inbound mail arriving at a household sub-address through the
signed AgentMail webhook and becoming dated, typed cards; a question drafted by
OpenAI, sent from the household address, answered from the school inbox, routed
back by thread, read, and moving a card's deadline on its own; and two
signed-in parents watching the same board change live, with presence showing
both.

The earlier blocker is gone — the OpenAI account has credit, and extraction
runs — so nothing on the board depends on the seeded example any more. The
seeded cards remain as the first thing a new household sees, still openly
labelled as an example in `convex/model/example.ts`; everything a visitor
presses does real work on the sponsors' APIs.

Spend stays bounded by design rather than by discipline: a deployment-wide
OpenAI ceiling (`OPENAI_BUDGET_CENTS`, defaulting to 400), per-household limits
on the two entry points that cost money, and deployment-wide limits on handing
out trial boards and on starting crawls at all.
