# NOTES — session handoff (2026-09-08)

**Second-session update (same day): the three outstanding threads below are now ALL
MERGED to master.** The detailed sections are kept as history and reasoning.

- §2 catalog relocalization — **APPLIED and MERGED** (`ca4a510`, branch
  `feature/catalog-socal-vendors`). The mapping tables were applied verbatim; both
  honesty calls (no wood-grain paver, no slate claim on Holland I) went in;
  `SCHEMA_VERSION` 5→6; all gates green including a full guide-screenshot review.
  Unverified items (Black Granite Chip, cedar mulches, Triple Mix) were deliberately
  left unchanged — the open questions and what source would settle them live in
  `NOTES-CATALOG.md`. Do not rename them without that source.
- §3 UI/UX quick wins — **MERGED** (`e56b782`). The merge had broken
  `scripts/e2e-smoke.mjs` (pre-selected overdue invoice made the script deselect its
  way into a missing Pay button) — fixed in the catalog branch.
- §4 Today dashboard — **PASS 1 MERGED** (`23a8396`, branch `feature/today-dashboard`):
  nav is now `Today · Board · Catalog · Pay`, Team + Appearance live in a profile
  sheet off the avatar, `/today` renders a real greeting page. **Next: pass 2** —
  the rep card (static record in `demo-seed.json`), the 7-day delivery/pickup strip
  (real dates only, decision 3 still binding), and the "Needs you" aggregation
  selector. Pass 3 is the project×stage matrix over `buildProjectSummaries`. The
  full plan remains at `/home/colton/.claude/plans/today-dashboard-redesign.md`.

Two integration bugs found during pass 1, fixed before merge: the guide script's
assistant panel has no Escape handling (close it by its own control), and the e2e
role-gating step must leave the chrome-less order page before opening the profile
sheet.

---

Original first-session handoff follows.

---

This session did four things, in order: rebranded the demo tenant to Gable Landscape
Supply (MERGED), relocalized the demo geography to San Diego (MERGED, same branch),
researched real San Diego vendors to replace the Canadian catalog (RESEARCHED, NOT YET
APPLIED), reviewed a Claude Design UX-critique artifact and shipped three of its findings
(MERGED... no — PUSHED, NOT MERGED), and scoped a larger dashboard redesign the artifact
proposed (PLANNED, NOT BUILT). Read this before starting anything new — the catalog
research in particular took ~4 agent-hours and should not be re-run.

---

## 1. DONE and on `master` — the dealer rebrand + San Diego locale

`master` is at `847436d` (merge of `feature/dealer-branding`). This:

- Extended `DealerBranding` from one colour to three roles (`--brand` identity,
  `--brand-fill` action, `--brand-chrome` shell) — see `docs/brand-tokens.md`, the frozen
  contract for the token names and exact `brandingCss` output.
- Set `DEFAULT_CONFIG` to Gable Landscape Supply (Harbor `#14497B` / Gold `#FFC313` /
  Navy `#0B2338`), all measured through `npm run contrast` (24/24 gated pairs pass).
- Built a real dark-mode toggle (`src/ui/lib/theme.ts`, an Appearance card under More) —
  dark mode existed in `theme.css` since the design system was written but nothing had
  ever reached it; only `capture-guide.mjs` stamped `data-theme` for screenshots.
- Moved the demo geography from Ontario to San Diego County via a new swappable JSON
  layer, `src/core/data/demo-seed.json` + `demo-seed.ts` — two yards (Point Loma,
  Julian), the contractor account, the crew, project sites. This is the file a future
  re-localization edits, not scattered TypeScript literals.
- **The catalog itself was deliberately NOT relocalized in that pass** — see §2. It still
  lists Techo-Bloc / OAKS / Permacon / Brown's Concrete / Bestway Stone, all Canadian.
- `SCHEMA_VERSION` 4→5 (seeded tracking/activity strings bake in the dealer name at seed
  time, which is persisted — a v4 save would show the old name after this rebrand).
- Found and fixed four real bugs along the way, all documented in code comments where
  they landed: the favicon had never rendered in any browser since the LumberNow fork
  (`var(--brand)` inside an XML comment, illegal `--`); `npm run contrast` measured
  nothing with no argv and exited 0; a partial dealer config inherited the demo tenant's
  colours instead of falling back to platform defaults; `createProject` hardcoded
  `state: 'SD'` (Sioux Falls, not San Diego) on every project a contractor created.

Nothing outstanding here. If you need the reasoning behind any specific token or
decision, `docs/brand-tokens.md` and the commit message on `847436d` are more complete
than this summary.

---

## 2. RESEARCHED, NOT YET APPLIED — the catalog needs real San Diego vendors

The user's ask: **"we need it to be local/relevant... vendors that is."** Two research
passes (parallel agents, real web sources, cited) are complete and are the expensive part
of this work — do not re-research before checking here first.

### Pavers (13 products) — vendor: **Acker-Stone Industries**

Verified: independent (not Oldcastle/Belgard), plants in Corona CA and Chandler AZ,
named San Diego installs (One Paseo, Westfield UTC La Jolla, Oceanside), a dated Dec
2025 CA stock sheet, 75 colours measured from their own published swatch chart.

**Two brands considered and REJECTED — do not use them:**
- **Basalite** — confirmed a PCBP division, but zero San Diego County dealers; the
  locator's southernmost point is Bakersfield, ~300 miles off.
- **Calstone** — acquired by Oldcastle/Belgard in 2022; the brand is being actively
  retired (site diff shows it flipping to Belgard branding mid-2025); its apparent "San
  Diego dealers" are bare SiteOne/Ewing/PoolCorp branch addresses with no rep, not real
  stockists.

**The 13-slot mapping** (old SKU → new SKU, Acker-Stone product, colour + confidence):

| Old SKU (price) | New SKU | Acker-Stone product | Colour (confidence) |
|---|---|---|---|
| PVR-TB-BLU60-SM ($6.29) | PVR-ACK-PASEO60 | Paseo 4PC 60mm | Antique Pewter FM `#868481` (medium) |
| PVR-TB-BLU80-SL ($8.32) | PVR-ACK-HOLL80 | Holland I 80mm, heavy vehicular | Charcoal FM `#5A554A` (**high**) |
| PVR-TB-ANTIKA ($8.89) | PVR-ACK-SIENA70 | Siena Embossed 4PC Tumbled 70mm | Antique Pewter TM `#868481` (**high**) |
| PVR-TB-BOREALIS ($17.67) | PVR-ACK-SLAB2460 | 24x24 Slab 60mm | Antique Pewter FM `#868481` (medium) |
| PVR-TB-HEXA ($10.56) | PVR-ACK-HEX80 | Hexagon 80mm, heavy vehicular | Graphite FM `#5E5B55` (low) |
| PVR-OAK-YORK60 ($8.13) † | PVR-ACK-COMBO60 | Combo Stone 60mm, tumbled | Catina Blend FM `#9D8365` (medium) |
| PVR-OAK-RIALTO60 ($7.38) | PVR-ACK-PASEO6X9 | Paseo 6x9 60mm | Charcoal FM `#5A554A` (**high**) |
| PVR-OAK-NUEVA60 ($7.28) | PVR-ACK-PASEOGR60 | Paseo Grande 3PC 60mm | Catina Blend FM `#9D8365` (medium) |
| PVR-OAK-RIDGE70 ($6.31) | PVR-ACK-PALERMO70 | Palermo 70mm, embossed | Graphite FM `#5E5B55` (**high**) |
| PVR-PMC-MELV80 ($8.86) | PVR-ACK-AQUAVIA80 | Aqua-Via I 80mm, **permeable** | Antique Pewter TM `#868481` (**high**) |
| PVR-PMC-MOND60 ($6.16) | PVR-ACK-4X1260 | 4x12 Linear 60mm | Antique Pewter FM `#868481` (medium) |
| PVR-BRN-NORDIC60 ($4.62) | PVR-ACK-HOLL60 | Holland I 60mm | Charcoal FM `#5A554A` (**high**) |
| PVR-BWS-TREV50 ($6.47) | PVR-ACK-PALAZZO50 | Palazzo 24x24 Contempo, shot-blast | "Natural Pewter" `#B5B0AA` (medium) |

† `PVR-OAK-YORK60` is the account's CONTRACT-priced hero SKU — `account-seed.ts`
`PRICING_RULES` has `sku: 'PVR-OAK-YORK60', unitPrice: toCents(6.35)`. Renaming it means
updating that rule too, not just the catalog row.

**Two honesty calls already made, don't relitigate:**
- **No wood-grain paver exists in Acker-Stone's current catalog** (their "Wood Tiles"
  line appears only in a stale 2017 PDF). Slot 4 (Borealis) is remapped to their
  large-format 24×24 slab instead, with the "wood-grain" language dropped from the
  description — not invented.
- **Slot 2's "slate texture" claim is dropped.** Holland I is a plain smooth module;
  it's the right product for the 80mm-heavy-vehicular role, but it doesn't have a slate
  finish, so the description shouldn't claim one.

**Mechanics, checked and safe:**
- `bom_templates.json` references products by numeric `id`, never by SKU — renaming SKUs
  does not touch it.
- A global exact-string SKU rename across `src/` and `scripts/` is safe: confirmed zero
  exact-SKU-string collisions in any `fixtures/` or `fixtures-live/` directory. One
  fixture (`catalog-search-paver.json`) coincidentally contains the substrings "OAK" and
  "Permacon" — it's a real, verbatim ERP recording (`DBS-OAKS-VINTAGE`, "Permacon Lafitt
  Paver") off `dibbits-staging.gablelbm.com` and must **never** be edited; it isn't an
  exact-SKU match so a careful rename won't touch it anyway.
- Each old paver SKU is referenced across 2–13 files (test fixtures, `scenario.ts`,
  `account-seed.ts`'s pricing rule, `capture-guide.mjs`, `a11y-audit.mjs`). `PVR-OAK-YORK60`
  is the worst case at 13 files, precisely because it's the contract-price hero.

### Walls, steppers, porcelain, fire pit (8 products) — vendor: **RCP Block & Brick**

Verified: 7 real retail locations named in San Diego County (Chula Vista, Encinitas,
Escondido, Lemon Grove, Santee, Vista) — `rcpblock.com`. Confirmed it's ONE real yard
that plausibly answers most of these 8 slots (it sells Keystone walls, its own/Unilock
steppers, unbranded porcelain tile, and Bella Vista fire pit kits).

| Old product (price) | Real match | Confidence / gap |
|---|---|---|
| Modan Wall, $22.76 | Keystone Compac Contemporary, 12"×8"×18" | verified product; no published hex |
| Grand Ledge, $58.39 | Keystone Verazzo 4-Face, 10.5"×6"×16"/12" | verified product; no published hex |
| Wall Cap — Square | Keystone Straight-Face or Contemporary cap | verified name only |
| Borealis Stepping Stone, $54.30 | Beacon Hill Smooth Series (Unilock, via RCP) | verified product exists; **wood-grain attribute is UNVERIFIED** — no vendor (RCP, Belgard, Basalite, Angelus) publishes a wood-grain stepper |
| Maya Stepping Stone, $48.10 | Round/Square Aggregate Series (Natural) | verified |
| Superior Stepper, $36.57 | 16" Smooth Series (Natural) | verified |
| Outdoor Porcelain 24×24 Grey, $12.85 | RCP's "Quartzo Gray" 24×24 | size/colour-name verified; **thickness is stated as .75″ (≈19mm), not confirmed literal 20mm; manufacturer brand unnamed on the page** |
| Round Fire Pit Kit, $849.00 | Bella Vista Semplice Fire Pit, 50″ OD, via RCP | product verified real and sold through a real SD yard; **$849 price not verified against any published number** |

Belgard has real, larger wall/porcelain/fire-pit lines, but **no confirmed San Diego
County dealer** was found for Belgard specifically (its own dealer locator was
unreachable) — don't substitute it in on the strength of the product line alone.

### Bulk aggregates, soils, mulch (18 house-brand products) — SoCal renaming

Sources: RCP Block & Brick + Grangetto's Farm & Garden Supply (Escondido/Encinitas/
Fallbrook, confirmed real SD-area yard).

| Current name | Real SoCal term | Status |
|---|---|---|
| High Performance Base (HPB) | **Class II Road Base** | verified, verbatim |
| Limestone Screenings | **Decomposed Granite (DG)** | verified — SoCal has no limestone geology, DG is the real local equivalent |
| 3/4" Clearstone (bulk & bagged) | **3/4" Crushed Gravel** | verified, verbatim |
| Concrete Sand (bagged) | unchanged | verified geography-neutral |
| 1" River Rock | retail name is "Arizona Medium" (~1–2″) | verified product; exact retail name differs, "River Rock" works as a plain-English label |
| 2-6" River Rock | "Arizona Large" (~2–6″) | same caveat |
| Black Granite Chip | **could not verify** — real black decorative rock at RCP is cinder/pebble (Black Cinder, Criva Black, Black Beach Pebble), not granite, despite San Diego County being real granite country | **flag as likely wrong as currently named**; needs a quarry-facing source (Vulcan Materials, Cemex) |
| Triple Mix | no verified equivalent; closest real product is "Amended Topsoil" | partially verified |
| Screened Topsoil | "Amended Topsoil" (RCP) | verified |
| Red/Black Cedar Mulch | **could not verify** — RCP does not sell mulch at all | unverified; Agromin (Oxnard) is a lead, not confirmed |
| ("Gorilla Hair" mulch, shredded redwood — a genuinely famous SoCal product) | plausible but not independently verified this pass | worth checking before using |
| Artificial turf, PVC edging, geotextile, polymeric sand, block adhesive, LED path light, Ecoraster | assumed geography-neutral | not individually contradicted, but not positively checked item-by-item either |

### What applying this actually involves

1. Freeze the mapping (the tables above), decide the brand/SKU scheme for the RCP-backed
   products (a house convention would be `WAL-KEY-*`, `STP-RCP-*`/`STP-UNL-*`,
   `POR-RCP-*`, `FIR-BLV-*` — not yet chosen).
2. Update `brands.json`: replace the 5 Canadian brand entries. **Don't delete Permacon
   (id 3) until every SKU that references it is remapped** — it's used by both pavers
   (`PVR-PMC-*`) and the wall cap (`WAL-PMC-CAP-SQ`).
3. Global rename in `products.json` + `product-colours.json` (sku, name, description,
   tags, brand, colour fields), then every cross-referencing file (§ above).
4. `account-seed.ts`'s contract-price rule for `PVR-OAK-YORK60` → new SKU.
5. Regenerate swatches (`npm run swatches`) — deterministic from SKU, so renamed SKUs get
   fresh swatches automatically; nothing to hand-author.
6. Full gate run, then `npm run guide` **last**, and actually look at the regenerated
   screenshots — this is exactly the kind of change that silently produces a "beige card
   that says the wrong brand" if a description or colour field is missed.

---

## 3. PUSHED, NOT MERGED — three UI/UX quick wins

Branch `feature/uiux-quick-wins`, pushed, at commit `d546872`. Not merged to `master` —
no one asked for that yet.

Came out of decoding a Claude Design artifact
(`https://claude.ai/code/artifact/fdd43e17-b13b-47f5-8e57-52d7ab6f5c73` — it's a bundled
JS canvas, not a plain `.dc.html`; reading it required pulling the saved raw HTML from
the tool result and decompressing the `__bundler/manifest` gzip entries by hand, then the
`__bundler/template` JSON string for the actual `<x-dc>` content). It's a critique of the
current portal plus five mockups (a "Today" dashboard, an Order-page redesign, a
Catalog-product-page redesign).

Shipped, verified live in a headless browser (not just gates):
- **Per-yard stock on the product page** — `selectors/catalog.ts`'s `ProductDetail` now
  carries `stockByLocation`, filtered to yard-kind locations, populated only when there's
  more than one yard. Renders as "Point Loma 4472 sq ft · Julian 728 sq ft".
- **The next-volume-break line finishes its own sentence** — added "590 sq ft more saves
  $3.10 on this line" using numbers `quote` already returns; no new selector.
- **Pay pre-selects overdue invoices** — a lazy `useState` initializer, not an effect, so
  it seeds once from whatever's in the store at mount and never re-fires over a later
  hand-made deselection. Deliberately only pre-selects OVERDUE rows, so the documented
  empty-state teaching text ("Select invoices to pay") still shows for the
  open-but-not-late case.

**Checked and explicitly rejected:** the mockup's order-header "list $Y" figure. The
existing "$X below list" sentence already follows CLAUDE.md's "say the consequence, not
the arithmetic" principle better than a second raw number would.

**Don't copy the mockup's invented brand names into the catalog.** Its Order-page mockup
uses "Belgard Mega-Arbel" and SKUs like `BLG-MA-SAND` — Belgard's own San Diego dealer
presence was specifically checked in §2 and could not be verified. The mockup guessed a
plausible-sounding brand; §2's research is the one to trust.

---

## 4. PLANNED, NOT BUILT — the Today dashboard

Full plan: `/home/colton/.claude/plans/today-dashboard-redesign.md` (outside this repo —
it's in the Claude Code plans directory on this machine, not git-tracked; the essential
content is duplicated below so it survives even if that path isn't reachable).

Three decisions already made with the user:
1. **Today is additive; the existing 4-column Board stays**, reachable via a view toggle
   on the same screen — not replaced.
2. **Team + the dark-mode Appearance toggle move into a profile sheet** off the person
   avatar. No fifth nav tab.
3. **The 7-day delivery/pickup strip ships with structure and real dates only** — no
   "you could still make this date if you order today" feasibility prediction. That's
   new domain logic (lead time vs. calendar) and deserves its own pass.

These resolve, with **zero net tab-count change**: nav goes from `Board · Catalog · Pay ·
More` to `Today · Board · Catalog · Pay` — Today is genuinely new, "More" retires because
its two contents move into the profile sheet.

**The hard-looking piece is mostly already built.** The project×stage matrix needs no
new selector — `selectors/board.ts`'s `buildProjectSummaries(cards)` already returns
`{ project, cards, total, stages }[]`, exactly the matrix's row data, and
`ProjectPage.tsx` already renders this shape for one project. The matrix is that same
idea generalized across every project, in a grid instead of a stack.

**"Interchangeable with this" already ships** (`ProductPage.tsx:222`,
`selectors/catalog.ts:309`) — do not rebuild it, the mockup's version already exists.

**Genuinely new, not yet modeled anywhere:**
- **A dealer-side rep.** Nothing today models a dealer employee — `Account.contactName`
  is the *contractor's own* contact, not a dealer contact. Scope conservatively: a
  static name/yard/phone record in `demo-seed.json`, same place yards/team already live.
  **No live "at the counter now" presence** — that's a sim/scheduler feature, out of
  scope for pass one.
- **Yard hours and closures** (`Yard open · 6:00 AM – 4:30 PM · Sat 7–12`,
  `Labor Day · yard closed`) — small `demo-seed.json` addition, no logic.
- **A "Needs you" aggregation selector** — pulls three EXISTING signals (quote-desk
  returns, lead-time conflicts, overdue invoices) into one ranked list. New selector,
  not new underlying logic.

Proposed build order: (1) nav/tab shape + the profile sheet, since everything else
builds against it; (2) the Today screen's simpler pieces (header line, rep card, week
strip); (3) the matrix itself; (4) order/product-page polish (a per-line inline
volume-break nudge, reusing the arithmetic from §3's ProductPage change).

**Awaiting go-ahead to start step 1.** Nothing here has been built.

---

## Environment notes

- `node_modules` was empty on this checkout at the start of the session — `npm install`
  was run and playwright's chromium is cached. If a fresh checkout hits the same "Cannot
  find package '@vitejs/plugin-react'" error, that's why.
- There are several stray `vite` processes on this machine unrelated to this repo
  (including one from the sibling `hardscapeos_dibbits` checkout, and one whose working
  directory has been deleted). None interfere with this repo's own port-guarded scripts
  (`security`/`guide`/`e2e` claim fixed ports and refuse to start if occupied), but worth
  knowing if something seems to be listening that shouldn't be.
