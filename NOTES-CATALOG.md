# NOTES — the catalog destination

Working notes for `feature/catalog-destination`. What was decided and why, what
the placeholder promised against what shipped, the mutation log, and what is
parked.

---

## What the placeholder promised, and what shipped

The Catalog tab rendered one sentence:

> Browse the full catalog with your account pricing. (M3.5)

and the guide's *What isn't built yet* table carried "Full catalog browsing as
its own destination — M3.5". Honest, and now redeemable.

| The promise | What shipped |
|---|---|
| "Browse the full catalog" | All 45 products, by category, with a search over name/tag/SKU and an in-stock filter. Category chips **drill in** (Hardscape → Pavers → its siblings) rather than dumping eighteen headings on a 390px screen. |
| "…with your account pricing" | Every row and every product page quotes through the **same** pricing engine the board uses, per unit sold: `$5.16 /sq ft`, `$36.13 /tonne`. List struck through, and the whole-percent saving as a chip. Yorkville reads 22% off because a contract price says so; everything else in Hardscape reads 18%. |
| (unstated) what you do with it | **Add to a plan.** Never a cart — see below. |

Beyond the promise, because the browse made them obvious:

- **A product page priced at the quantity you are considering**, with the next
  volume break as a sentence: *"Order 600 sq ft or more and your price drops to
  $4.85/sq ft."*
- **Empty results that say what happened** and name the query and the category.
- **Interchangeable-with-this** limited to a genuine substitution class.

---

## Design decisions

### 1. There is no cart, and the sheet asks the question a cart never does

The product's whole thesis is that carts are where contractor intent goes to
die: no job, no delivery date, no site, and nothing on the board to remind you
it exists. So the only action on a product is **Add to a plan**, and the sheet
lists Plan-stage orders — each already attached to a job.

Consequences that fell out of taking that seriously:

- Orders the supplier already holds (`quote`, `order`, `invoice`) are **not
  listed at all**. The scope is locked once the dealer is pricing or picking,
  so offering a destination that refuses on tap teaches nothing.
- A plan that already carries the SKU **says so before the tap**, and adding
  raises that line's quantity rather than creating a second one — the M3 rule,
  reached through the same `addCatalogItem`.
- "Start a new plan" creates exactly one draft, and **rolls it back** if the
  line then refuses. An empty nameless card in the Plan column is the board
  claiming work that does not exist.
- The confirmation offers **Open plan**. Material that landed somewhere you
  cannot see is precisely the cart behaviour being avoided.

### 2. One pricing path, and the binding was the missing piece

`sim/pricing.ts` was already the only place pricing was *computed*. What did
not exist was the binding of engine + *which account*, so every caller built
its own: `actions/scope.ts` froze the demo account in a module constant and
`OrderPage` hand-wrote `tierId: 'tier_pro'` at the call site. Two bindings, and
a browsable catalogue would have been the third.

`selectors/pricing.ts` is now that one function. It fixed a live defect on the
way: `search_catalog` promised the contractor's account price **in its own tool
description** and returned list, so the assistant quoted retail to an account
holding an 18% category rule and a negotiated contract SKU.

The property is asserted twice, deliberately:

- **Behaviourally** — every catalog row equals `pricing.quote(product, qty,
  account)` for all 45 products at 1, 20, 600 and 1500 units.
- **Structurally** — a grep over all of `src/` for discount arithmetic
  (`percentOffList`, `listPrice *`, `* (1 -`) outside `sim/pricing.ts`.

The behavioural test alone is not enough: a "list minus the tier discount"
shortcut agrees on 40 of the 45 products, and disagrees exactly where the
commercial relationship lives.

### 3. Units are part of the price, not a code beside it

Hardscape sells by area, weight and volume. `$42.50 EA` for a tonne of base is
both wrong and unreadable, so `domain/units.ts` holds one table of unit words
and everything prints through it — the row, the product page, the button
(`Add 480 sq ft to a plan`), the toast. The quantity stepper steps by ten for
area and length and by one for a fire pit kit.

It is in `domain/` rather than the UI because an order line and a customer
quote have to say "per tonne" the same way; a second table is a second set of
words that can drift.

### 4. Filter state lives in the URL

`?q=&cat=&stock=&sort=`. This is the same reasoning that made the order pages
real routes in M3: on a phone, opening a product and pressing back must return
to the list you were reading, not to an empty search. It also makes a filtered
catalogue a link you can send your PM.

### 5. Two things the rendered screens caught that no unit test would have

- **The catalogue opened on `1" River Rock`, `2-6" River Rock`, `3/4"
  Clearstone`.** An unsearched shelf sorted alphabetically is sorted by
  punctuation. Unfiltered browsing follows the dealer's category order now, so
  it opens on pavers — the way the yard is laid out. Pinned by a test.
- **Outdoor porcelain was offered as interchangeable with a concrete paver.**
  `deriveSpecClass` tested the tag `slab` before `porcelain`, so a 20mm
  porcelain tile was filed as a 60mm paver. The comment directly above that
  branch warns about exactly this across paver *thicknesses*; this one crosses
  material, bedding and twice the price. One-line fix in the seed, plus a
  regression test.

---

## Two pre-existing gates were red before any of this

Neither is catalog work; both had to be true before "all four gates pass"
could mean anything.

1. **`npm test` failed on a clean master.** The dealer's-day test asserts that
   the local calendar day and the UTC one *disagree*, which is only true on a
   host with an offset. It passed on an Ontario laptop and failed on a UTC box
   with the code entirely correct — and would have gone quietly green on a UTC
   box if `usageDay` regressed to UTC. The timezone is pinned for that block
   now.
2. **`npm run check` failed on a clean master**, 20 lint errors, all "suggested
   (unsafe) fixes" biome will not apply on its own. A permanently red gate
   stops being read. All twenty fixed; the risky one (swatch.mjs) was verified
   by regenerating all 45 SVGs and confirming git reports no diff.

---

## Mutation log

Each mutation was applied to the working tree, the named tests were run, and
the tree was restored with `git checkout`.

| # | Mutation | Dying tests | Result |
|---|---|---|---|
| 1 | **Second pricing path.** `toCatalogRow` computes `Math.round(listPrice * 0.82)` instead of asking the engine — "Pro tier plus the hardscape rule is 18%, skip the round trip". | `every catalog price comes from the ERP engine › agrees with the engine for every product, at every quantity that matters`; `› honours a contract SKU rather than the category discount`; `› honours the tier rule on aggregates, which is a different discount`; `› leaves the arithmetic to sim/pricing.ts`; `browsing the catalogue › sorts by the price the contractor pays, not by list` | **5 failed** — the behavioural property, the two rules it gets wrong, and the structural grep. |
| 2 | **Add-to-plan creates a rogue order.** When the chosen plan is locked, "helpfully" create `"<name> (add-on)"` on the same project instead of refusing. | `adding a catalog product to a plan › refuses a plan the supplier already holds, and names it`; `› never creates a second order for an existing destination, whatever goes wrong` | **2 failed** — the second one is the property over every failure mode the destination has. |
| 3 | **Silent empty results.** `buildCatalogBrowse` stops attaching `emptyMessage`/`emptyHint` — "the grid is empty, which is obvious". | `browsing the catalogue › says plainly when nothing matched, and names what was searched`; `› names the category too when the search was inside one`; `› explains an empty in-stock filter differently from an empty search` | **3 failed.** |
| 4 | **Category filter stops cascading.** Match `product.categoryId === category.id` exactly, no descendants. | `browsing the catalogue › cascades a parent category down the tree`; `every catalog price comes from the ERP engine › honours the tier rule on aggregates…` | **2 failed** — and note the second: the same cascade bug class the pricing rules already had. |
| 5 | **A guide screen goes missing.** Renamed the `08-catalog` shot to `08-catalogue`, so the prose points at a file the run no longer produces. | `npm run guide` | **Failed loudly** after 34 shots: *"docs/user-guide.md points at 1 screenshot(s) this run did not produce: 08-catalog.png. Fix the prose or add the step."* |

---

## Parks

- **The `Chip`/`Availability` pair is a fourth chip implementation.** The board
  card, the line-item row, the tracking pill and now the catalog each draw
  their own tinted chip with the same `color-mix(... transparent 88%)` recipe.
  They are consistent today by copying; one shared `Chip` in `ui/components/ui`
  would make them consistent by construction. Not done here because touching
  four screens is its own review.
- **`search_catalog` still returns 12 results with no category filter.** The
  browse selectors can filter and sort; the assistant's tool cannot. Once a
  dealer catalogue is bigger than a system prompt, that tool should take the
  same `CatalogFilter` the UI does.
- **No "order this again".** The seeded history knows what was bought on the
  Wilson job; the catalogue does not offer it. That is the single most likely
  next request from a contractor and it needs a read model over past orders,
  not the catalogue.
- **No takeoff.** You type the quantity and it prices what you typed. Deriving
  a quantity from dimensions is the separate widget the assistant's brief
  explicitly refuses, and the catalogue holds the same line.
- **Alternates are unbounded.** A 60mm paver lists eight interchangeable
  products. Sorted cheapest-first, so the useful ones are at the top, but a
  dealer with forty pavers would want a cap and a "show all".
- **Going up a level needs the breadcrumb.** With a leaf category selected the
  chip row shows its siblings, and the way back out is **All** — there is no
  "‹ Hardscape" chip. Fine at two levels deep; not fine at four.
- **The catalog is not in `npm run e2e`.** The journey test walks the board,
  the order and the pay flow; browse → product → add-to-plan → the plan opens
  on the board is a journey with seams worth testing.
