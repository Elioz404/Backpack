# Backpack

**One live board of everything the school year asks of your family — with the sentence from the school's own notice that says so.**

🔗 **[resilient-mastiff-559.convex.site](https://resilient-mastiff-559.convex.site)** · built for the [Convex All Gas Hackathon](https://convex.dev/hackathons/all-gas)

---

## The problem

A permission slip comes home in a backpack. A newsletter says the trip money is due Friday. A teacher emails about a costume. The calendar page says there is no school on the 17th. None of it is hard — it is just scattered across a website nobody opens twice, three teachers' emails and a piece of paper in a bag, and the cost of missing one is a child who is the only one without a packed lunch.

Backpack collects it into one list. Point it at the school's website and forward it the school's mail, and it keeps a single shared board of what the family actually has to do — forms to sign, money to send, days off, things to bring — that **both parents watch change at the same time**.

## How it works

```
school website  ──Firecrawl crawl──┐
                                   ├──► OpenAI reads it ──► the board (live)
forwarded mail  ──AgentMail inbox──┘         │
                                             └──► verbatim quote, checked
```

Three things make it trustworthy enough to put on a shared board.

**Every line quotes its source, and the quote is verified.** The model answers against a strict JSON schema and must carry a sentence copied from the source. That claim is then checked against the actual text — an item whose quote is not found is **discarded, not flagged**. The model cannot put something on a family's board that the source does not say. Pointed at a school district's institutional pages, it correctly returns nothing.

**Nothing appears twice.** Sources are keyed by the SHA-256 of their normalised text, so a page re-crawled unchanged never reaches the model. Obligations are keyed by a fingerprint built from meaning — kind, date, normalised title — so the same deadline announced on the site and again in a reminder email collapses onto one card.

**Settled work stays settled.** A finished or dismissed item is never reopened by a later sighting, and one parent's claim survives a revision.

## What each sponsor does

| | |
|---|---|
| **Convex** | The whole backend. The board is one live query, the crawl progress another, and presence shows the second parent on the same board. Auth, crons, HTTP actions, the scheduler, pagination, static hosting. |
| **Firecrawl** | A **durable crawl** of the school site. `startCrawl` returns immediately, pages stream into the component's tables, and the board subscribes to the progress rather than polling it. A weekly cron re-reads every site. |
| **OpenAI** | Reads each page and message into structured obligations under the grounding rule above, and drafts the question to the school office. |
| **AgentMail** | The household's own address. Parents forward school mail to it; a reply on a thread we opened closes the question that opened it, and anything else becomes a new source. |

## Architecture

```
convex/
  convex.config.ts   seven component mounts, typed environment, no raw process.env
  schema.ts          ten tables on one tenant boundary
  lib/               outward adapters — openai/ firecrawl agentmail limits pools
  model/             domain logic — households obligations sources crawls budget
  pipelines/         crawlIngest · mailIngest · extract · recrawl
  *.ts               public API: thin, validated args and returns, auth first
src/                 the board
```

A household is the unit of privacy. Every public function passes through
`requireMembership`, so that rule is enforced in one place rather than
re-implemented per endpoint.

Two components earn their place by **bounding spend** rather than adding
features. A finished crawl can land a hundred pages in one callback and each
page is one model call, so extraction runs through a **workpool** with a fixed
number in flight. And because crawling spends Firecrawl credits and extraction
spends OpenAI budget on the operator's own key, both are **rate limited** per
household and metered against a hard ceiling — every call reports its token
usage, and both entry points refuse before spending past `OPENAI_BUDGET_CENTS`.
The running total is on screen, because a number you have to find in a
dashboard is one you find too late.

## Running it

```bash
npm install
npx convex dev          # provisions a deployment and pushes the backend
npm run dev             # the frontend, at localhost:5173
```

Then set the four service keys on the deployment:

```bash
npx convex env set FIRECRAWL_API_KEY fc-...
npx convex env set AGENTMAIL_API_KEY ...
npx convex env set OPENAI_API_KEY sk-...
npx convex env set AGENTMAIL_WEBHOOK_SECRET whsec-...   # for inbound mail
```

Convex Auth needs a signing key pair. Its own CLI cannot write them on Windows
(it shells out without `shell: true`, so it cannot launch `npx.cmd`), so:

```bash
node scripts/generate-auth-keys.mjs      # prints the two commands to run
```

Deploying — the frontend is served by Convex static hosting, so there is one
command and no second host:

```bash
npx @convex-dev/static-hosting deploy
```

Register `https://<deployment>.convex.site/api/agentmail/webhook` with AgentMail
for inbound mail. Firecrawl's callback is mounted by its component and needs no
setup.

A worked example board — openly fictional, and labelled as such — can be seeded
into a household with:

```bash
npx convex run seed:demo '{"householdId":"<id>"}'
```

## Notes and limits

- **AgentMail's free tier allows three inboxes in total**, so Backpack gives one
  address per *household* rather than per child or per school. Threads and
  labels already separate conversations, and one address is what a parent can
  remember to forward to.
- **`@agentmail/convex@0.1.0` is not used**, deliberately. It reads its API key
  from `process.env` inside its own component isolate — where deployment
  variables are not visible — and declares no typed environment to pass one in,
  so every call fails with "AGENTMAIL_API_KEY is not set" while the key is
  plainly set. AgentMail is reached over its REST API instead, with Svix
  webhook verification implemented in Web Crypto.
- **The `openai` package is not used** either: it sets `url.username` while
  normalising a request, which the Convex runtime does not implement. The
  Responses API is called directly.
- Extraction defaults to `gpt-5.6-luna`. A 40-page crawl costs about three
  cents; set `OPENAI_MODEL` higher if the reading quality needs it.

## Licence

MIT.
