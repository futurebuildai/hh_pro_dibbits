# DIB-480 — the supplier port, and an ERP adapter that can only read

Stage 1b of the approved ERP-connection spec (D-088), behind `erpReads`.
Branch: `feature/dib-480-supplier-port`, off `origin/master` at `50713a4`.

The brief was the spec, not a ticket description: §1 (auth bridge), §2 (adapter
contract + endpoint map, margin-free responses, 404-not-403), §7 (migration
shape). This file records what was decided, what the evidence is, and what was
deliberately not built.

---

## 1. The port was discovered, not designed

The temptation was to transcribe the spec's illustrative `SupplierPort` into
`port.ts` and call it done. That would have been an invention — a shape neither
implementation naturally has, which both then have to fake.

What actually exists today:

- `sim/types.ts` narrows a supplier to **five stores and six mutators**, and its
  own header says why: handlers "write supplier-side facts — a quote came back,
  a truck left — and must not reach for the contractor's actions, which carry
  guards meant for a human."
- Of those five stores, **three hold supplier-side facts**: `quotes`,
  `salesOrders`, `invoices`. `orders` and `scope` are the contractor's own; the
  sim only patches prices onto them.
- `sim/index.ts` exposes exactly **four verbs**: `submitToQuoteDesk`,
  `withdrawFromQuoteDesk`, `createOrderWithSupplier`, `cancelWithSupplier`.

So the port is: **reads over the three supplier-side collections, plus the
session/identity/config/catalog/account reads Stage 1 names, plus those four
verbs.** `SupplierWrites` is a verbatim lift of `Sim`. Nothing was added that
the simulator does not already do, and nothing the simulator does was left out.

The split into `SupplierReads` / `SupplierWrites` is the one piece of structure
the sim did not hand over, and it exists for a single reason: Stage 1 is
read-only, and read-only enforced by a comment is a convention.

```
src/core/supplier/
  port.ts                 SupplierReads | SupplierWrites | SupplierPort, refusal vocabulary
  index.ts                createSupplier(config) -> SimSupplier | ErpSupplier
  adapters/
    sim.ts                today's Sim + the stores, behind the port
    erp.ts                the READ adapter — thirteen reads, zero writes
    erp/client.ts         base URL, Bearer, 401, 403/404, retry/backoff, abort
    erp/map.ts            wire -> domain. The ONLY translation, and a whitelist
  __tests__/              fixtures + contract, transport, structure, zero-delta
```

`sim/*` was **not** moved into `adapters/sim/` yet. The spec's §7.1 layout has
it there eventually; moving ~2,000 lines of simulator in the same commit that
introduces the seam would have made the zero-delta claim unverifiable by
inspection. `adapters/sim.ts` wraps it in place. The move is a park.

## 2. The five decisions that will otherwise be re-argued later

**The token never crosses the port.** `SupplierSession` carries an identity and
an expiry, not a credential. Custody is a *host* decision, injected as a
`TokenStore` — the browser shell mirrors to `sessionStorage`, tests use memory,
and core holds none of it. A token reachable from a domain value is a token in
one of the twelve persisted stores one refactor later, which means a token in
`hh:corrupt-backup` and a token riding a cross-tab `storage` event. There is a
test that serialises a login result and asserts the token string is not in it.

**`AccountSummary.termsDays` is a number, not a code.** HH Pro's `Account` has
`'COD' | 'NET15' | 'NET30'`; the ERP stores `payment_terms_days` and a dealer
running Net-45 is ordinary. Squeezing 45 into `NET30` puts a due date fifteen
days early on a real invoice. The domain already converts code → days, so days
is the honest superset and the code stays a seed concern.

**Catalog hits are price-free on BOTH sides.** The ERP's Stage 1 has no pricing
route — that is `POST /pricing/quote`, Stage 2, behind `erpPricing`. The sim
*could* compute the account price and does not. A port method that answers
differently depending on who implements it is the fork the whole seam exists to
prevent, and the first place that fork would appear is the one method where the
sim happens to know more than the ERP does today.

**Capabilities come from the server; the role is display only.** §1.3's mapping
is implemented in `map.ts` with every row commented. `move-stage` spans two ERP
capabilities (`submit_rfq` for Plan→Quote, `create_orders` for Quote→Order) and
Stage 1 cannot express a destination-sensitive grant, so the union is used — the
server is the enforcement point either way, so the failure mode is a refused
request rather than an unauthorised one. `customer-quote` is granted
unconditionally: contractor-branded homeowner proposals have no ERP analogue and
gating the contractor's own sell side on the dealer's flag would put the wrong
system in charge of the wrong document.

**An unknown enum degrades to the safest neighbour, never the most advanced.**
Unknown quote status reads `in-review`, never `priced` — `priced` would tell a
contractor the desk stood behind a number it may never have produced. Unknown
order status reads `submitted`, never `delivered` — `delivered` switches off the
pull-back guard that stops a contractor cancelling goods already on site. This
is R-11 ("projections drift") answered at the client as well as the server.

Two smaller ones worth having in writing:

- **`READY` splits on fulfillment.** Will-call ready is `ready-willcall` (it
  parks at the counter); delivery ready is still `picking`, because nothing has
  left the yard and the contractor should not be told a truck is coming.
- **A sales order maps with `tracking: []`.** The contractor-safe timeline is
  `GET /orders/{id}/timeline`, a redacted projection that does not exist yet.
  Synthesising events from a status would put times on the screen that no truck
  ever kept.

## 3. Read-only is structural, not aspirational

Three independent mechanisms, because each catches something the others do not:

1. **The type.** `ErpSupplier` is `SupplierReadOnlyPort`. It does not implement
   `SupplierWrites`, so a call site that expects a write does not compile.
2. **The object.** It is a plain literal, so its own keys are its whole surface.
   `structure.test.ts` walks the prototype chain too, asserts the four write
   names are absent, asserts `Object.keys()` is exactly the thirteen reads plus
   `mode`, and sweeps for anything merely *shaped* like a write
   (`create|update|delete|pay|submit|withdraw|cancel|confirm|post|put|send|…`)
   so a helpfully-added `confirmPickup` is caught before it acquires a caller.
3. **The transport.** `createErpClient` exposes `get` and `authPost`, and
   `authPost` is allowlisted to `/login` and `/token/refresh`. A POST anywhere
   else is refused **before a byte leaves** — proven by a test that asserts the
   injected fetch was never called.

Plus a source-level sweep: no `'PUT'`/`'PATCH'`/`'DELETE'` in any adapter file,
and `client.authPost(` appears exactly once in `erp.ts`.

## 4. Evidence

### Contract tests — one per Stage 1 read

Recorded fixtures, replayed through an injected fetch. Every assertion is a deep
equality against the **whole** mapped value, which is what makes the suite catch
a pass-through: a mapper that grows a field fails immediately, where a spot
check on `unitPrice` would sail past the day `margin_bps` lands on the same
object.

| Stage 1 read | Route | Contract test |
|---|---|---|
| login | `POST /login` | maps identity + server capabilities; **token never crosses the port**; bearer sent on the next read |
| token refresh | `POST /token/refresh` | rotates the stored token; refuses **without touching the network** when there is no session |
| /me + capabilities | `GET /me` | field crew → `[customer-quote, confirm-pickup]`; buyer → five; unknown role → least privileged, capabilities still honoured |
| config / branding | `GET /config` | full mapping incl. support contacts |
| catalog search | `GET /catalog/search` | price-free hits; **margin machinery dropped from a drifted row**; query + limit on the URL |
| dashboard | `GET /dashboard` | account facts, dealer segmentation dropped; **Net-45 survives**; COD → cash, no credit line |
| billing summary | `GET /billing/summary` | balances + **server-issued card fee**; a missing balance refuses rather than reading as settled |
| quotes read | `GET /quotes`, `/quotes/{id}` | desk note + line prices; unknown status → `in-review`; an unpriced line refuses |
| orders read | `GET /orders`, `/orders/{id}` | empty timeline not a fabricated one; `READY` splits on fulfillment; unknown → `submitted` |
| invoices read | `GET /invoices`, `/invoices/{id}` | portal vs counter origin; single read by id |
| (cross-cutting) | any | **404 ≠ 403**, and the generic refusal names nobody |

Transport tests cover the rest of the contract: URL building, 401 clearing the
token and announcing once, no retry on 401, retry with doubling backoff through
503/429, no retry on an auth POST, abort reported as cancelled, and a 200 that
is actually HTML refused rather than handed to the mapper — because "200 means
mounted" has already been false once in this codebase.

### Flag-off zero-delta

```
origin/master (50713a4)   28 files   376 tests   all passing
this branch               32 files   447 tests   all passing
```

The 376 pre-existing tests pass **unchanged** — not adjusted, not re-recorded.
That is the substance of the zero-delta claim, and it holds because the port was
introduced without moving a single call site: `createSim` still builds the
simulator, the stage effects still call it directly, and `AppContext` gains
`supplier` *alongside* `sim` rather than in place of it.

`zero-delta.test.ts` pins the two ways it could quietly stop being true:

- the default config resolving to anything but the simulator (`mode: 'sim'`,
  `erpReads: false`, flag off wins over mode and mode wins over flag);
- the sim adapter answering something other than the stores the board renders
  (list reads compared against `listOf(store)`, missing id refused with the
  *same sentence* the ERP adapter uses, capabilities derived from the acting
  person exactly as the gate does).

### Mutation testing — seven mutants, all killed, by name

| # | Mutation | Test that died |
|---|---|---|
| 1 | `createSupplier` ignores `erpReads` — flag off returns `ErpSupplier` | `zero-delta` → *returns the simulator when the flag is off, whatever the mode says* |
| 2 | `mapCatalogHit` spreads the wire object (invented/passed-through fields) | `erp-contract` → *maps hits price-free, and drops every field the drifted row carried*; *leaks no margin machinery even when the projection drifts*; `structure` → *builds every domain value from named fields* |
| 3 | `submitToQuoteDesk` added to the ERP adapter | `structure` → *has no submitToQuoteDesk*; *carries nothing that even looks like a write*; *is exactly the reads plus its mode, and nothing else* |
| 4 | 404 rendered as a permission refusal | `erp-contract` → *renders a cross-tenant id as not-found, never as a permission problem*; `client` → *renders 404 as not-found* |
| 5 | Unknown quote status defaults to `priced` | `erp-contract` → *reads a status this build has never seen as in-review, never as priced* |
| 6 | Missing `balance_cents` defaults to `0` | `erp-contract` → *refuses a summary it cannot read rather than rendering a zero balance* |
| 7 | Client reads `sessionStorage` directly | `architecture` → *the supplier adapters read no ambient browser global* |

Each mutant was applied, the suite run, the named failure recorded, and the file
reverted. Mutants 1–3 are the three the brief asked for; 4–7 are the guards that
would otherwise have been assertions nobody had tested.

### Gates

`typecheck`, `test`, `build`, `check` — all green before the commit, and re-run
after `biome check --write` reformatted five files. `architecture.test.ts` is
green and now carries one extra rule (below).

## 5. `architecture.test.ts` gained a rule

**The supplier adapters read no ambient browser global.** Not just React-free —
global-free. An adapter that reached for `globalThis.fetch`,
`window.sessionStorage` or `location` would work in a browser, pass review, then
fail in the node test project or an embedded Lit build — and, worse, it would
take the credential-custody decision away from the host that has to make it.
Comments are stripped before the scan, because this codebase's prose explains at
length why a token must not go near `localStorage`, and a check that fails on
the documentation of its own rule is a check somebody deletes.

`structure.test.ts` adds the adapter-isolation half: nothing outside
`supplier/` imports `supplier/adapters/*` — everything goes through
`createSupplier`. (This is why `boot.ts` imports `FetchLike`/`TokenStore` from
`supplier/index`, not from the client module.) The spec's eventual rule —
"nothing outside `supplier/adapters/sim/` may import from it" — lands when the
simulator physically moves.

## 6. What is deliberately NOT built

- **No UI.** No login screen, no read-only board cards, no capability-driven
  rendering. Stage 1's exit criterion ("a contractor signs in and sees their
  real orders") needs a shell; this ticket is the core seam it plugs into.
  Nothing yet calls `context.supplier`, which is exactly why zero-delta is
  provable.
- **No pricing.** `POST /pricing/quote` is Stage 2 and the port has no
  `quoteLines` yet. Adding it now would have meant a method the ERP adapter
  could not honour.
- **No events, no writes, no payments.** Stages 3–6.
- **`sim/*` not relocated.** See §1.

---

## PARKS — for the supervisor

**PARK 1 — `expires_at` on the login/refresh contract (needs DIB-479 to agree).**
The adapter requires `{token, expires_at, user, config}`. §1.2 writes the
response as `{token, user, config}` and the TTL is only implied by the JWT's
`exp`. Core will not decode a JWT — that is a credential-parsing job it has no
business doing, and `exp` is the *token's* claim, not the session's policy. If
DIB-479 ships without `expires_at`, `mapSession` refuses every login. **Confirm
the field, or rule that the adapter may treat a missing expiry as "unknown" and
refresh on 401 alone.**

**PARK 2 — the ninth CP-07 capability.** §1.3 says nine; the spec names eight
(`SubmitRFQ`, `CreateOrders`, `PayInvoices`, `ManagePaymentMethods`,
`ViewOrdersDeliveries`, `EditDeliveryInstructions`, `ManageUsers`,
`ViewBilling`). `mapCapabilities` whitelists the ones it needs and ignores the
rest, so a ninth is harmless — but if it gates catalog search or pricing, an
HH Pro capability may need to derive from it.

**PARK 3 — `move-stage` is a union until something writes.** One HH Pro
capability spans two ERP ones. Stage 3/4 needs a destination-aware check
(`submit_rfq` for Plan→Quote, `create_orders` for Quote→Order), which means
either two HH Pro capabilities or a `SupplierIdentity` that carries the split.
Both are port changes. Related to **OR-2** — if the two portal roles land, this
gets easier, not harder.

**PARK 4 — misconfigured ERP mode degrades to the simulator at parse time.**
`parseConfig` resolves `mode: 'erp'` only with a valid absolute `baseUrl`;
otherwise the deployment stays on the sim (and `erpReads` is forced off with
it). That follows the existing "a bad value costs that value, not the config"
doctrine, and it is *not* the forbidden runtime fallback — but a dealer who
typo'd their base URL gets a working demo instead of an error. **Ruling wanted:
should a deployment that asks for ERP and cannot have it refuse to boot?** The
admin console would be the natural place to surface "mode did not take".

**PARK 5 — `customer_type` is dropped, cash-vs-charge is derived.** `map.ts`
derives `type` from `payment_terms_days > 0`, because the ERP's `customer_type`
is dealer segmentation ("contractor", "retail") with no HH Pro home. Correct
today (COD ⇒ 0 days ⇒ cash). If HardscapeOS ever has a charge account on
due-on-receipt terms, this line is wrong and needs an explicit ERP flag.

**PARK 6 — the fixtures are recorded from the CONTRACT, not from a server.**
DIB-479 is in flight. The day it answers, re-record every fixture against the
real routes; divergence should fail in `erp-contract.test.ts` rather than in
front of a contractor. Worth a follow-up ticket rather than a memory.

**PARK 7 — move `sim/*` under `supplier/adapters/sim/`.** The spec's §7.1
layout. Deferred so this commit's zero-delta claim stays inspectable. When it
moves, `architecture.test.ts` gains the spec's exact rule.

**PARK 8 — the environment ate this branch twice mid-build.** `node_modules`
and two written source files vanished at ~17:04 with every tracked file's mtime
reset. Work was recovered from a copy under `/home/claude/dib480-backup/`. If
another builder hits an empty `node_modules` in a checkout that was working
minutes earlier, that is what happened; re-run `npm install` and check
`git status` before assuming the branch is fine.
