# NOTES — DIB-480: the supplier port and the ErpSupplier read adapter

Stage 1b of the approved ERP-connection spec (D-088). Branch
`feature/dib-480-supplier-port`, off `origin/master` at `50713a4`.

Scope, verbatim from §7.3 Stage 1: **reads only.** Auth, `/me` + capabilities,
config/branding, catalog search, dashboard/billing summary, orders read,
invoices read, quotes read. All writes stay sim. Zero UI change with the flag
off, and no UI change with it on either — see the parks.

---

## 1. The port

`src/core/supplier/port.ts`. One interface, two implementations, and the sim is
the default.

```
SupplierPort {
  mode:   'sim' | 'erp'
  reads:  SupplierReads            // 11 methods, Stage 1's read surface
  auth:   SupplierAuth | null      // null in sim mode
  writes: SupplierWrites | null    // null in ERP mode, this stage
}
```

### What was DISCOVERED

- **`SupplierWrites` is not a design.** It is the four methods `sim/index.ts`
  already publishes — `submitToQuoteDesk`, `withdrawFromQuoteDesk`,
  `createOrderWithSupplier`, `cancelWithSupplier` — lifted verbatim and wrapped
  in a promise. `Result<T>` survives as `Promise<Result<T>>`, which is spec
  §2.1's one mechanical change and is what keeps the refusal sentence intact
  for both a rejected board drop and the AI's `tool_result`.
- **`sim/types.ts` had already drawn the boundary.** Its `SimStores` façade
  narrows a supplier to five stores plus six mutators, with a comment saying
  why. The read surface is the same five stores read back out.
- **The read method list is the endpoint map**, not a guess: every one of the
  eleven maps to a route the ERP already serves, and the Stage 1 subset is the
  spec's own §7.3 row.
- **`auth: null` for the sim is a discovered fact, not a simplification.** §1.1
  says HH Pro has no login; the sim's login story is the PersonSwitcher.
- **Two capability collapses are lossy, and §1.3 says so.** `move-stage` spans
  `SubmitRFQ` + `CreateOrders`; `pay` spans `PayInvoices` +
  `ManagePaymentMethods`.

### What was INVENTED, and why each was the smallest choice available

| Invention | Why |
|---|---|
| `SupplierSession` with **no `token` field** | §1.2 puts custody in the adapter. HH Pro persists twelve stores to `localStorage` and stashes a corrupt-save backup — a token readable above the port eventually lands in a forensic stash or rides a cross-tab `storage` event. A shape that cannot carry the credential cannot leak it, which is the argument `DealerConfig` already makes about the LLM key. |
| `TokenStore` injected, in-memory default | The right browser home is `sessionStorage`, and `src/core` is DOM-free by default. Core ships the memory implementation; the shell supplies the other. |
| Conservative **AND** on both collapsed capabilities | The failure modes are not symmetric. A refusal the server would have allowed costs a phone call; a button the server refuses costs trust, and is the "permission gate silently switched off" class the post-M8 review already fought (R-4). The uncollapsed set rides along as `SupplierIdentity.erpCapabilities` for the destination-aware guard Stage 3/4 needs. |
| `'customer-quote'` held **true** in ERP mode | It has no ERP analogue (§4.5 / OR-11): the contractor's homeowner proposals are HH Pro-local in v1 and carry the *contractor's* branding. Deriving it from the server means deriving it as `false` and deleting a working local feature for every signed-in contractor. |
| `SUPPLIER_WRITE_METHODS` deny-list | A test input, not a roadmap. It names every mutating capability in the §2.2 endpoint map so a Stage 3 method landing early *under its eventual name* dies in `structure.test.ts`. |
| `SupplierPage<T>` | The ERP's `httpx.Page[T]` envelope preserved rather than flattened, so `total` survives for the paging Stage 1c will need. |
| `SupplierConfig.mode` + `.stages.erpReads` | §7.2 names `mode`; §7.3 names the stage flags. Only `erpReads` is declared — a flag that exists before the code it gates is a switch a dealer can flip into nothing. |

### Deviation from §7.1's file layout, and why

The spec draws `adapters/erp/{client,auth,pricing,quotes,orders,money,events,map}.ts`.
Stage 1 has no pricing, no writes and no events, so that directory would ship
five near-empty files. This lands flat and named as the ticket names it:

```
src/core/supplier/
  port.ts                  the interface + shared types
  index.ts                 createSupplier(config, deps)
  adapters/
    sim.ts                 SimSupplier — wraps the Sim boot already built
    erp.ts                 ErpSupplier — the READ adapter
    erp-client.ts          base URL, Bearer, 401, retry/backoff, abort
    erp-map.ts             wire -> domain. The ONLY translation point.
    erp-wire.ts            the ERP's shapes, transcribed from the Go structs
```

`erp-map.ts` is §7.1's `map.ts` under a flat name and keeps its property: it is
the only place cents, UOM and status translate. Splitting into the spec's
directory is a rename away and is the right move at Stage 2, when
`pricing.ts` and `orders.ts` have content.

### `src/core/sim/` did NOT move

§7.1 says the sim moves wholesale into `supplier/adapters/sim/`. It has not,
deliberately: a wholesale move of eight files plus their tests is pure churn in
a change whose headline claim is *byte-identical behaviour with the flag off*,
and it would make the zero-delta diff unreadable. `SimSupplier` is a thin
wrapper over the existing `createSim`, and the physical move is parked as a
mechanical follow-on with no behaviour in it.

---

## 2. Adapter coverage

Every Stage 1 read, with the route and the gate the ERP enforces.

| Port method | Route | ERP gate |
|---|---|---|
| `auth.login` | `POST /login` | anonymous |
| `auth.refresh` | `POST /token/refresh` | authn (DIB-479) |
| `reads.me` | `GET /me` | authn; capabilities via the DIB-479 extension |
| `reads.branding` | `GET /config` | authn |
| `reads.searchCatalog` | `GET /catalog/search?q=&limit=` | `SubmitRFQ` |
| `reads.dashboard` | `GET /dashboard` | `ViewBilling` |
| `reads.billingSummary` | `GET /billing/summary` | `ViewBilling` |
| `reads.listOrders` / `getOrder` | `GET /orders[/{id}]` | `ViewOrdersDeliveries` |
| `reads.listInvoices` / `getInvoice` | `GET /invoices[/{id}]` | `ViewBilling` |
| `reads.listQuotes` / `getQuote` | `GET /quotes[/{id}]` | `SubmitRFQ` |

Mapping decisions worth defending:

- **`subtotal` comes from `total_cents`, not `subtotal_cents`.** HH Pro has no
  tax model — `SalesOrder.subtotal` and `Invoice.subtotal` are the single
  number a contractor is shown — so the ERP's pre-tax subtotal would understate
  every order and every invoice by the tax.
- **`READY` reads differently by fulfillment.** "Come and get it" on a
  will-call; "picked and staged" on a delivery, which HH Pro already calls
  *being picked*. Rendering "Ready for pickup" on a delivery sends a contractor
  to the counter for something that is coming on a truck.
- **Unrecognised statuses degrade to the neutral member** (R-11), never to the
  stronger claim. An order status HH Pro has never heard of is `submitted`; a
  quote status is `in-review`.
- **Go's zero time is unset, not the year 1.** `0001-01-01T00:00:00Z` is a
  valid date and would render on a delivery card.
- **An unmodelled UOM is `null`.** A pallet read as an each is the most
  expensive wrong number in this vertical; nothing beats something.
- **`orderId` is `''`** on ERP orders and quotes. The board-card link arrives
  at Stage 3 with `erpPlan`; `''` is the ERP's own sentinel for an unset id and
  is falsy, so no existing board selector's `so.orderId === order.id` can adopt
  an order it does not own.
- **`GET /config`'s colour and logo are re-validated** through the same
  `isValidColor` / `isValidLogo` the injected config runs through. These values
  are interpolated into a stylesheet; an ERP is not a more trustworthy source
  of a stylesheet fragment than a hand-edited config file. `support_email` /
  `support_phone` are dropped — §7.2 rule 4, an ERP field with no home in the
  domain type goes in the bin rather than growing a variant.
- **404 is 404.** Every ERP route resolves its id together with the caller's
  `customer_id`, so cross-tenant and missing are one answer by construction
  (§2.4). The adapter does not try to tell them apart either. 403 stays
  distinct — a capability refusal is not a missing row.
- **401 clears the token and ends the session.** It never resumes the
  simulator. A portal that quietly starts serving fabricated prices when its
  ERP session lapses is the single worst failure this integration can have.

### A gap found in the DIB-479 contract

`POST /login` returns `{token, user, config}`. `POST /token/refresh` returns
those **plus `expires_at` and `session_expires_at`**. So a client that has just
logged in does not know when its token dies, and only learns it after its first
refresh — which it has no basis to schedule.

The adapter reports `expiresAt: null` after a login and a contract test pins
that, specifically so nobody "fixes" it by decoding the JWT client-side: the
entire reason `refresh.go` hands the instants over is so a client never parses
a token, and a client that parses one anyway has quietly become a second
authority on when the session ends.

**Suggested ERP-side fix, one field pair:** add `ExpiresAt` /
`SessionExpiresAt` to `portal.LoginResponse`, computed exactly as
`Refresh` does (`time.Unix(now.Add(jwtTTL).Unix(), 0).UTC()` and the fresh
`Ost + 7d`). Additive, no migration. Filed as a park below.

---

## 3. Fixture provenance

**Recorded-fixture mode, and it is honest about being that.** DIB-479 exists as
code on `feedback/dib-479-portal-stage1a` in `hardscapeos_dibbits` and has not
merged to a reachable server, so nothing here was captured off a wire. Every
fixture is shaped from the Go struct that will serialize it, field name by
field name:

| Fixture | Source struct |
|---|---|
| `login.json` | `portal/model.go` `LoginResponse`, `User`, `Config` |
| `refresh.json`, `refresh-demoted.json` | `portal/refresh.go` `RefreshResponse` |
| `me-*.json` | `portal/settings.go` `MeResponse` (User embedded) + `portal/rbac.go` `Capabilities` |
| `config.json` | `portal/model.go` `Config` / `defaultConfig()` |
| `catalog-search.json` | `portal/catalog.go` `CatalogSearchResponse` + `product/model.go` `CatalogResult` |
| `dashboard.json` | `portal/dashboard.go` `DashboardResponse` + `customer/model.go` `Account` |
| `billing-summary.json` | `portal/dashboard.go` `BillingSummary` |
| `orders-page.json`, `order-detail.json` | `order/model.go` `Order`, `Line`, `Detail`; envelope `httpx.Page[T]` |
| `invoices-page.json`, `invoice-detail.json` | `billing/model.go` `Invoice`, `Line` |
| `quotes-page.json`, `quote-detail.json` | `quote/model.go` `Quote`, `Line`, `Detail` |
| `error-40x.json` | `httpx.Error` → `{"error": msg}` |

Enum values are the real CHECK sets, read out of `validOrderStatus` /
`validQuoteStatus` / `CapabilitiesFor`, including the two roles DIB-479 added
for OR-2 (`buyer_no_pay`, `ap_finance`) — `me-buyer-no-pay.json` is what makes
HH Pro's `pm` persona representable, and there is a test for exactly that.

**What this buys and what it does not.** It buys field names, enum spellings,
envelope shape, the 404-not-403 posture, and the login/refresh asymmetry above
— all read from the code that will serve them. It does **not** buy proof the
server behaves this way at runtime. Three fixtures deliberately carry the
awkward cases rather than only the happy path: an unmodelled UOM, an
unrecognised order status (`SPLIT_SHIPPED`) and quote status
(`AWAITING_DESK`), and a Go zero-time `requested_date`.

**Re-record against a live server the moment DIB-479 merges.** The transport
already records every request, so a capture pass is a diff, not a rewrite.

---

## 4. Zero-delta proof

Five independent arms, because each covers a hole in the others.

1. **The whole existing suite, unchanged.** Measured on this worktree at
   pristine `origin/master` (`git stash -u`, run, pop): **28 files / 376
   tests**. With the change: the same 28 files and the same 376 tests still
   pass, plus 60 new ones in `src/core/supplier/__tests__/` and 3 in the
   architecture test — 439 total. No existing test was edited except
   `architecture.test.ts`, which gained the two §7.2 rules and lost nothing.
2. **A structural no-push assertion on the wiring.** `zero-delta.test.ts` hands
   the flag-off arm a transport that *throws on any call* and asserts it never
   fires. A green suite cannot tell you a network client was never built rather
   than merely never called; this can.
3. **The stage flag is narrower than the mode.** A dealer with a wired-up,
   valid `mode:'erp'` and `erpReads: false` gets the simulator and no
   transport. (This test exists because mutation 1 found its absence.)
4. **The architecture test**, which now fails if anything outside
   `src/core/supplier/` imports an adapter or branches on the supplier mode —
   §7.2's rules 2 and 3, the difference between a switch and a fork.
5. **`npm run e2e`, 15/15.** A production build, driven as a contractor, with
   the flag off. The unit suite proves the pieces; this proves the seams, which
   is where every serious bug this project has had actually lived. It is the
   arm that would catch a boot-order mistake the other three cannot see.
   `npm run security` re-run too (0 failures) because `parseConfig` is the
   server's gate as well, and this change widened it.

`AppContext` gains one field (`supplier`) and `clock` / `pricing` / `sim` are
untouched, pinned by an exact-keys assertion.

---

## 5. Tests

`src/core/supplier/__tests__/` — 60 tests in three files plus a recorded
transport.

- **`erp-contract.test.ts` (43)** — one per read. Each asserts the *request*
  (verb, route, query, Bearer), the *mapping*, and *what did not survive*. The
  last is the one that would otherwise rot: an adapter that spreads the wire
  object passes the first two forever and leaks the next field the ERP adds.
  The R-2 arm poisons every fixture with the full confidential set
  (`margin_bps`, `floor_bps`, `cost_cents`, `blocked`, `bypass_reason`,
  `source`, `detail`, `actor_name`, …) and asserts the mapped output is still
  clean — so the property is proven of the **mapper**, not of the fixtures.
  Stage 1 has no pricing route, which is exactly why the guard belongs here now
  rather than at Stage 2 when it would be written under pressure.
- **`structure.test.ts` (6)** — the no-write proof, on the built object rather
  than the type. Deny-list at any depth; the eleven reads exercised with the
  wire asserted to have seen **only GETs**; POSTs bounded to `/login` and
  `/token/refresh`; no body on any read.
- **`zero-delta.test.ts` (11)** — above.
- **`recorded.ts`** — the fixture transport. It records every request, which is
  half the point: a contract test that only checked the parsed body would pass
  an adapter that POSTed to a read route.

---

## 6. Mutation log

Eleven self-mutations, each reverted immediately. Every one names the test that
died.

| # | Mutation | Test that died |
|---|---|---|
| 1 | `usesErpReads` drops `&& stages.erpReads` — the flag-off arm returns `ErpSupplier` | **initially NOTHING** → see below |
| 1b | same, after the gap was closed | `zero-delta > gives the simulator to a wired-up dealer whose stage flag is still off` |
| 2 | `mapSalesOrder` spreads the wire object before its named fields | `erp-contract > carries no line, instruction, or wire field the domain type does not name` **and** `> drops every confidential field even when the ERP sends one` |
| 3 | `updateSiteInstructions` added to `ErpSupplier` (a real Stage 4 write, `POST /orders/{id}/delivery-instructions`) | `structure > carries no method named by the write deny-list, at any depth` |
| 4 | `subtotal` mapped from `subtotal_cents` instead of `total_cents` | `erp-contract > shows the tax-inclusive total, because subtotal is the only number shown` |
| 5 | `mapBranding` passes `primary_color` through unvalidated | `erp-contract > refuses a colour the config validator would refuse` |
| 6 | 404 folded into the `forbidden` refusal | `erp-contract > answers a cross-tenant id with not-found, exactly as it answers a missing one` |
| 7 | 401 softened to `unavailable`, token kept | `erp-contract > drops the session on a 401 and never falls back to the sim` |
| 8 | `SupplierSession` carries the bearer token | `erp-contract > hands back no token, at any depth of the session object` |
| 9 | `customer-quote` derived from the ERP instead of held true | `erp-contract > never lets the server switch off customer quotes` **and** `> gives a field_crew only what the ERP gave them` |
| 10 | 401 on an anonymous login treated as a lapsed session | `erp-contract > tells a bad password apart from a dead session` |
| 11 | refresh advances the expiry before validating the new token | `erp-contract > does not advance the expiry on a refresh it had to refuse` |

**Mutation 1 is the one worth reading.** It killed nothing. Every zero-delta
test ran on `mode:'sim'`, where dropping the stage flag changes nothing — so
the suite would have stayed green while a dealer who had merely *configured* a
connection started reading through it. The missing case is a dealer whose ERP
is wired up and reachable with Stage 1 not yet turned on for them, which is
precisely the state a staged rollout exists to make safe. Test added, mutation
re-run, mutation dead.

---

## 7. Parks

Named, with the reason, in rough priority order.

1. **The reads are not bound to the UI yet.** With `erpReads` on, `boot`
   constructs an `ErpSupplier` and nothing calls it — the board still renders
   sim data. Binding it needs a login screen (§1.2's `LoginPage`), a hydration
   path from the port into the stores, and the read-only affordance §7.3 asks
   for ("board cards from the ERP are visibly read-only"). That is Stage 1c and
   it is UI work; this ticket's brief is explicitly plumbing with zero UI
   change. **Nothing ships to a dealer with `erpReads` on until 1c lands** —
   the flag is inert on purpose and the config default keeps it off.
2. **`POST /login` should carry `expires_at` + `session_expires_at`.** §3 above
   has the one-field ERP fix. Until then the adapter cannot schedule a
   pre-emptive refresh and relies on 401 + refresh.
3. **`src/core/sim/` has not physically moved** to `supplier/adapters/sim/`.
   Mechanical, zero behaviour, deliberately not mixed into a zero-delta change.
4. **`sessionStorage` token store not written.** Core ships the in-memory
   `TokenStore`; the per-tab `sessionStorage` implementation belongs in the
   shell (it is DOM) and lands with the login screen in 1c.
5. **Quote lines are empty.** `Quote.linePrices` is keyed by `scopeItemId`, an
   HH Pro id the ERP has never seen until `erpPlan` syncs the plan board.
   `deskNote` and per-line `lead_time_days` need the §2.2 extension to
   `GET /quotes/{id}`, which is unbuilt.
6. **Order tracking is empty.** `GET /orders/{id}/timeline` is an unbuilt route
   in the gap ledger. When it lands, R-11's whitelist mapping applies —
   unknown statuses render "Updated", never pass through.
7. **Invoice `description` is empty.** The ERP invoice header carries none; the
   lines do and list responses omit them. An empty string renders as nothing
   rather than as a guess. Either the portal invoice gains a summary line or
   the detail read composes one.
8. **`move-stage` and `pay` are collapsed conservatively.** The
   destination-stage-aware guard §1.3 describes ("the guard must check the
   destination stage") needs `actions/` changes and belongs with Stage 3/4.
   `erpCapabilities` is on the identity so it costs nothing to build then.
9. **Delivery addresses, catalog detail, events, assist.** All Stage 2+ and all
   behind unbuilt routes.
10. **Re-record the fixtures against a live DIB-479 server** once it merges.
11. **`npm run a11y` was not re-run.** No screen, token or copy changed. The
    other two on-demand gates WERE run, and both are zero-delta evidence in
    their own right:
    - `npm run e2e` — **15/15 journeys**, driving a production build as a
      contractor with the flag off. A green unit suite proves the pieces; this
      proves the seams, which is where every serious bug this project has had
      actually lived.
    - `npm run security` — **0 failures**. `parseConfig` is the server's gate
      too, and this change widened it, so the credential-exposure and
      DNS-rebinding checks were re-run rather than assumed.
    a11y is worth a run in 1c, when there is finally a login screen to walk.

---

## APPENDIX — the gate that merged this, and the second implementation

Added at merge time. Everything above is the implementer's record and stands
as written, with one correction noted below.

### Two implementations existed

`feature/dib-480-supplier-port` (this work, 5 commits) and
`feature/dib-480-supplier-port-rebuild` (`b483035`, 3 commits) were built
independently from the same spec and the same `origin/master` at `50713a4`.
The second was started on a brief that said the first "died at start with
nothing committed", which was wrong; it found the first branch at push time.

**That the two arrived at the same port shape — reads over the three
supplier-side collections, `SupplierWrites` as a verbatim lift of `Sim`, the
sim as the permanent default — is the strongest evidence available that the
port was discovered rather than invented.** Neither could see the other while
building. Where they differ, they differ on judgement, not on the shape.

This branch shipped, because it is the further along of the two: `writes: null`
plus a deny-list naming every mutating capability in §2.2 rather than only
today's four, "issues only GETs across every read" proven against the wire,
`SupplierPage<T>` preserved so the paging facts survive, `ErpCapabilities`
carried uncollapsed, and `auth: null` on the sim instead of a login that
accepts anything.

### Three things were taken from the rebuild

Each landed as its own commit with the reasoning in the message.

1. **`AUTH_PATHS`** — a POST outside `/login` and `/token/refresh` is refused
   at the transport, before a byte leaves. This branch bounded POSTs by
   exercising the adapter, which can only ever see the methods that exist
   today.
2. **"The supplier adapters read no ambient browser global"** in
   `architecture.test.ts`. The two builds wrote non-overlapping halves of this
   file's supplier rules; this is the half this branch did not have.
3. **"The mapper never spreads a wire object"** — the structural half of a
   property `erp-contract.test.ts` already proves behaviourally.

Two of the three were deliberately NOT copied verbatim:

- The rebuild banned `globalThis.fetch` outright, which would have failed on
  this branch's `platformFetch()`. That helper is argued, not accidental —
  lazy, ERP-arm-only, null-returning — so the ruling is that it stands and the
  allowance is **pinned** by exact match (one file, one occurrence) rather than
  waved through. A second `globalThis` in `supplier/` fails the suite.
- The rebuild's mapper-spread test matched a NAME list
  (`raw|body|row|hit|…`). This mapper names its wire parameters `wire`, so that
  regex would have matched nothing and passed **vacuously**. It matches the
  shape here instead, and `Object.assign` was added as the same leak in
  different syntax.

### Gates at the merge commit

All seven, on the merged tree with all three cherry-picks:

| Gate | Result |
|---|---|
| `typecheck` | clean |
| `test` | **451** in 31 files |
| `build` | clean |
| `check` | clean, no reformatting |
| `a11y` | 11 screens, 0 serious/critical |
| `e2e` | 15/15 journeys |
| `guide` | 34 captured — see the finding below |

**PARK 11 above is now stale**: `npm run a11y` WAS re-run at the gate, and is
green. The reasoning it gives for skipping it was sound; the run happened
anyway because the flag-off claim is worth measuring rather than arguing.

Zero-delta re-proved on the merged tree rather than inherited:
`git show 50713a4:` every one of master's 28 test files, byte-identical
including its own `architecture.test.ts`, run against the merged tree —
**376/376**. Not adjusted, not re-recorded. Only three master-era files are
modified at all (`boot.ts`, `domain/config.ts`, and `architecture.test.ts`,
which is `154 added / 0 removed`).

`createSupplier` is imported in exactly one place in the whole tree
(`boot.ts`), no module outside `supplier/` imports an adapter or branches on
the mode, and **nothing reads `context.supplier` yet** — which is PARK 1, and
is precisely why the zero-delta claim is inspectable.

Spot mutation re-run from the ledger (#1 on both branches): `usesErpReads`
drops `&& config.stages.erpReads === true`. One test dies, by name —
`zero-delta > gives the simulator to a wired-up dealer whose stage flag is
still off`. Reverted; 451/451.

### FINDING — `npm run guide` is not byte-stable, and was not before this

Worth stating plainly because a flag-off change is supposed to leave the guide
alone, and at first glance it does not.

- Two `npm run guide` runs on **pristine master**, with none of this code
  present, differ in **3 of 34** screenshots: `16-demo-controls`,
  `18-activity`, `24-order-tracking`. All three are sim-clock / activity-feed
  screens.
- The merged tree's run differs from a master run in **exactly those same
  three**, and is **byte-identical on the other 31**.

So the guide is stable across this change wherever it is stable at all, and
the churn is pre-existing. Two consequences, neither caused by DIB-480 and
both parked:

1. Those three screens carry non-deterministic content, so the guide cannot
   serve as a byte-stability oracle for them.
2. Separately, a guide run in this environment rewrites **22 of 34** PNGs
   relative to what is committed — rendering drift from whatever machine last
   committed them. `npm run guide` therefore dirties the tree anywhere.
   Regenerated screenshots were **not** committed here: nothing visible
   changed, and committing them would bake one machine's rendering into
   history.

### Two more parks from the gate

- **The ERP adapter is in the flag-off bundle.** `createSupplier` imports
  `createErpSupplier` statically, so the ~12 KB (~4 KB gzipped) of adapter,
  client and mapper ships to every contractor on a sim deployment. `main.js`
  went 369.81 KB → 381.80 KB. This repo has already made the other call once,
  for the same reason, at a larger size: `session.ts` imports the Anthropic SDK
  dynamically because nothing needs it until someone sends a message. Worth the
  same treatment at Stage 1c, when the ERP arm finally has a caller.
- **`package-lock.json` still says `"name": "lumbernow"`.** Every `npm install`
  rewrites it to `hh-pro` and dirties the tree. Two lines, pre-existing, left
  alone here to keep this merge to its subject.
