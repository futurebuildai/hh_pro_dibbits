import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, getContext } from '../../boot';
import { ACCOUNT_ID, TIER_PRO_ID } from '../../data/account-seed';
import { categoryId } from '../../data/catalog-seed';
import { catalogStore, ordersStore, projectsStore, scopeStore } from '../../stores/root';
import {
  type CatalogFilter,
  buildCatalogBrowse,
  buildCategoryTree,
  buildPlanTargets,
  buildProductDetail,
  categoryWithDescendants,
} from '../catalog';
import { quoteForAccount } from '../pricing';

beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
});

const HARDSCAPE = categoryId(1);
const PAVERS = categoryId(11);
const AGGREGATES = categoryId(3);

function browse(filter: CatalogFilter, limit = 200) {
  const { products, categories } = catalogStore.get();
  return buildCatalogBrowse({ products, categories, filter, quoteFor: quoteForAccount, limit });
}

describe('browsing the catalogue', () => {
  beforeEach(() => boot({ reset: true, seed: 20_260_730 }));

  it('shows the whole catalogue when nothing is filtered', () => {
    const result = browse({});
    expect(result.matched).toBe(catalogStore.get().products.length);
    expect(result.emptyMessage).toBeUndefined();
  });

  it('caps what it returns but still says how many matched', () => {
    const result = browse({}, 12);
    expect(result.rows).toHaveLength(12);
    expect(result.matched).toBeGreaterThan(12);
  });

  it('cascades a parent category down the tree', () => {
    // "Hardscape" is a heading with nothing filed directly under it — every
    // paver, wall, step and porcelain slab sits one level below. Matching the
    // category id exactly would show an empty screen for the busiest heading
    // in the catalogue.
    const ids = categoryWithDescendants(catalogStore.get().categories, HARDSCAPE);
    expect(ids.has(PAVERS)).toBe(true);

    const hardscape = browse({ categoryId: HARDSCAPE });
    const pavers = browse({ categoryId: PAVERS });
    expect(hardscape.matched).toBeGreaterThan(pavers.matched);
    expect(hardscape.rows.some((row) => row.product.sku === 'PVR-TB-BLU60-SM')).toBe(true);
    expect(hardscape.rows.some((row) => row.product.sku === 'WAL-OAK-MODAN')).toBe(true);
    // And nothing from another root.
    expect(hardscape.rows.some((row) => row.product.sku === 'AGG-HPB-BULK')).toBe(false);
  });

  it('carries a breadcrumb from the root down', () => {
    const result = browse({ categoryId: PAVERS });
    expect(result.breadcrumb.map((category) => category.name)).toEqual(['Hardscape', 'Pavers']);
  });

  it('searches by name, tag and SKU, and combines with the category', () => {
    expect(browse({ query: 'borealis' }).rows.map((row) => row.product.sku)).toContain(
      'PVR-TB-BOREALIS',
    );
    // A SKU paste goes straight to that product.
    expect(browse({ query: 'AGG-HPB-BULK' }).rows[0]?.product.sku).toBe('AGG-HPB-BULK');
    // Tag search: "permeable" is a tag, not a word in the name.
    expect(browse({ query: 'permeable' }).matched).toBeGreaterThan(0);

    // Borealis exists as both a paver and a stepping stone; the category
    // narrows it without changing the words typed.
    const stepsOnly = browse({ query: 'borealis', categoryId: categoryId(13) });
    expect(stepsOnly.rows.map((row) => row.product.sku)).toEqual(['STP-TB-BOREALIS']);
  });

  it('says plainly when nothing matched, and names what was searched', () => {
    const result = browse({ query: 'mahogany door' });
    expect(result.rows).toHaveLength(0);
    expect(result.emptyMessage).toBe('Nothing in the catalog matches “mahogany door”.');
    expect(result.emptyHint).toContain('special order');
  });

  it('names the category too when the search was inside one', () => {
    const result = browse({ query: 'mulch', categoryId: PAVERS });
    expect(result.emptyMessage).toBe('Nothing in Pavers matches “mulch”.');
    expect(result.emptyHint).toContain('whole catalog');
  });

  it('explains an empty in-stock filter differently from an empty search', () => {
    const result = browse({ categoryId: PAVERS, inStockOnly: true, query: 'borealis' });
    // Borealis is the special-order paver: nothing on the yard, three weeks out.
    expect(result.matched).toBe(0);
    expect(result.emptyMessage).toContain('matches');

    const noQuery = browse({ query: '', categoryId: PAVERS, inStockOnly: true });
    expect(noQuery.matched).toBeGreaterThan(0);
  });

  it('hides nothing by default — an out-of-stock product is still buyable', () => {
    const all = browse({ categoryId: PAVERS });
    const stocked = browse({ categoryId: PAVERS, inStockOnly: true });
    expect(all.matched).toBeGreaterThan(stocked.matched);
    expect(all.rows.some((row) => !row.inStock)).toBe(true);
  });

  it('states availability as a consequence, not arithmetic', () => {
    const borealis = browse({ query: 'PVR-TB-BOREALIS' }).rows[0];
    expect(borealis?.inStock).toBe(false);
    expect(borealis?.availability).toBe('Out of stock — 21 days out');

    const blu = browse({ query: 'PVR-TB-BLU60-SM' }).rows[0];
    expect(blu?.availability).toBe('In stock');
  });

  it('sorts by the price the contractor pays, not by list', () => {
    const low = browse({ categoryId: PAVERS, sort: 'price-low' });
    const prices = low.rows.map((row) => row.quote.unitPrice);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);

    const high = browse({ categoryId: PAVERS, sort: 'price-high' });
    expect(high.rows[0]?.quote.unitPrice).toBe(prices[prices.length - 1]);

    // Sorting the whole catalogue is where the two orders genuinely disagree.
    // Yorkville LISTS at $8.13, above the $8.00 river rock — but it carries a
    // negotiated $6.35 contract price while the rock only gets the 15%
    // aggregate rule ($6.80). "Cheapest first" on list prices would put them
    // the wrong way round on the contractor's own screen.
    const everything = browse({ sort: 'price-low' });
    const yorkville = everything.rows.findIndex((row) => row.product.sku === 'PVR-OAK-YORK60');
    const riverRock = everything.rows.findIndex((row) => row.product.sku === 'DEC-RIVER-1IN');
    expect(yorkville).toBeLessThan(riverRock);
    expect(everything.rows[yorkville]?.product.listPrice).toBeGreaterThan(
      everything.rows[riverRock]?.product.listPrice ?? 0,
    );
  });

  it('drops empty branches from the category tree and counts descendants', () => {
    const tree = buildCategoryTree(catalogStore.get().products, catalogStore.get().categories);
    const hardscape = tree.find((node) => node.category.id === HARDSCAPE);
    expect(hardscape).toBeDefined();

    const childCount = (hardscape?.children ?? []).reduce((sum, node) => sum + node.count, 0);
    expect(hardscape?.count).toBe(childCount);
    for (const node of tree) expect(node.count).toBeGreaterThan(0);
  });
});

describe('the product page', () => {
  beforeEach(() => boot({ reset: true, seed: 20_260_730 }));

  function detail(ref: string, qty: number) {
    const { products, categories, brands } = catalogStore.get();
    return buildProductDetail({
      products,
      categories,
      brands,
      productRef: ref,
      qty,
      quoteFor: quoteForAccount,
    });
  }

  it('resolves by SKU or by product id', () => {
    const bySku = detail('PVR-OAK-YORK60', 1);
    expect(bySku?.product.name).toBe('OAKS Yorkville 60');
    expect(detail(bySku?.product.id ?? '', 1)?.product.sku).toBe('PVR-OAK-YORK60');
    expect(detail('NOT-A-SKU', 1)).toBeUndefined();
  });

  it('re-prices as the quantity changes, because breaks are quantity-dependent', () => {
    const one = detail('PVR-TB-BLU60-SM', 1);
    const patio = detail('PVR-TB-BLU60-SM', 600);

    expect(one?.quote.nextBreak?.minQty).toBe(600);
    expect(patio?.quote.unitPrice).toBeLessThan(one?.quote.unitPrice ?? 0);
    expect(patio?.extended).toBe((patio?.quote.unitPrice ?? 0) * 600);
  });

  it('offers alternates only within a substitutable class', () => {
    const driveway = detail('PVR-TB-BLU80-SL', 1);
    // 80mm vehicular pavers substitute for each other. A 60mm patio paver
    // under a car is a crack, so it must never be offered as an alternate.
    expect(driveway?.alternates.length).toBeGreaterThan(0);
    for (const alternate of driveway?.alternates ?? []) {
      expect(alternate.product.specClass).toBe('paver-80mm-vehicular');
    }
    expect(driveway?.alternates.some((row) => row.product.sku === 'PVR-TB-BLU60-SM')).toBe(false);
  });

  it('carries the unit the product is actually sold in', () => {
    expect(detail('AGG-HPB-BULK', 1)?.product.baseUom).toBe('TON');
    expect(detail('PVR-TB-BLU60-SM', 1)?.product.baseUom).toBe('SF');
    expect(detail('JNT-POLY-SAND', 1)?.product.baseUom).toBe('BG');
  });
});

/**
 * The single pricing path.
 *
 * Every number a contractor sees for a catalog product must be the number the
 * ERP produced for THEIR account. The catalog is where a second pricing path
 * would be easiest to write and hardest to notice — a "list minus the tier
 * discount" shortcut looks right on most of the shelf and is wrong on exactly
 * the products the relationship was negotiated for.
 */
describe('every catalog price comes from the ERP engine', () => {
  beforeEach(() => boot({ reset: true, seed: 20_260_730 }));

  it('agrees with the engine for every product, at every quantity that matters', () => {
    const { pricing } = getContext();
    const account = { accountId: ACCOUNT_ID, tierId: TIER_PRO_ID };
    const { products, categories } = catalogStore.get();

    for (const qty of [1, 20, 600, 1500]) {
      for (const row of buildCatalogBrowse({
        products,
        categories,
        filter: {},
        limit: products.length,
        quoteFor: (product) => quoteForAccount(product, qty),
      }).rows) {
        const expected = pricing.quote(row.product, qty, account);
        expect({ sku: row.product.sku, price: row.quote.unitPrice }).toEqual({
          sku: row.product.sku,
          price: expected.unitPrice,
        });
      }
    }
  });

  it('honours a contract SKU rather than the category discount', () => {
    // 18% off the $8.13 list would be $6.67. The negotiated price is $6.35,
    // and a shortcut that applies the category rule uniformly would quietly
    // overcharge the contractor on the paver they lay most.
    const row = browse({ query: 'PVR-OAK-YORK60' }).rows[0];
    expect(row?.quote.unitPrice).toBe(635);
    expect(row?.quote.listPrice).toBe(813);
  });

  it('honours the tier rule on aggregates, which is a different discount', () => {
    // Aggregates are 15% (tier), not the 18% the account has on hardscape.
    const row = browse({ query: 'AGG-SCREEN-BULK' }).rows[0];
    expect(row?.quote.unitPrice).toBe(Math.round(3800 * 0.85));
    expect(browse({ categoryId: AGGREGATES }).matched).toBeGreaterThan(0);
  });

  it('surfaces the next volume break, and only when it is actually cheaper', () => {
    const { products, categories, brands } = catalogStore.get();
    const detail = buildProductDetail({
      products,
      categories,
      brands,
      productRef: 'AGG-HPB-BULK',
      qty: 4,
      quoteFor: quoteForAccount,
    });

    // Base is $42.50 less the 15% aggregate rule = $36.13/tonne. HPB has two
    // published breaks, at 20 tonnes ($38.50) and 60 ($35.00) — and the first
    // one is WORSE than what this account already pays. The engine advertises
    // the 60-tonne break and stays quiet about the 20, which is the honest
    // answer: "buy a full truck and pay more" is not an opportunity.
    expect(detail?.quote.unitPrice).toBe(3613);
    expect(detail?.quote.nextBreak).toEqual({ minQty: 60, unitPrice: 3500 });
  });

  /**
   * The structural half of the same claim: no surface may compute a discount
   * of its own. This is what fails when someone "just" multiplies list by a
   * tier percentage in a component — the behavioural test above only catches
   * it if the shortcut happens to disagree, and on 40 of 45 products it would
   * not.
   */
  it('leaves the arithmetic to sim/pricing.ts', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join, relative } = await import('node:path');

    const root = join(__dirname, '../../..'); // src/
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !full.includes('__tests__')) files.push(full);
      }
    };
    walk(root);

    // Discount arithmetic: a percentage applied to a price. The one file
    // allowed to do this is the ERP engine itself.
    const ALLOWED = ['core/sim/pricing.ts'];
    const OFFENDERS = /percentOffList|listPrice\s*\*|\*\s*\(1\s*-|msrp\s*\*/;

    const violations = files
      .filter((file) => !ALLOWED.some((allowed) => file.endsWith(allowed)))
      .filter((file) => OFFENDERS.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file));

    // account-seed.ts declares the RULES (data, not arithmetic) and is matched
    // by `percentOffList` as a property name — the engine reads it.
    expect(violations.filter((file) => file !== 'core/data/account-seed.ts')).toEqual([]);
  });
});

describe('where a product can be added', () => {
  beforeEach(() => boot({ reset: true, seed: 20_260_730 }));

  function targets(productId?: string) {
    return buildPlanTargets(ordersStore.get(), projectsStore.get(), scopeStore.get(), productId);
  }

  it('offers plan-stage orders only', () => {
    const all = targets();
    expect(all.length).toBeGreaterThan(0);
    for (const target of all) expect(target.order.stage).toBe('plan');
    // The Anderson order is at the quote desk and the Wilson wall is placed —
    // neither may be added to, so neither is offered.
    expect(all.some((target) => target.order.id === 'ord_anderson')).toBe(false);
    expect(all.some((target) => target.order.id === 'ord_wilson_frame')).toBe(false);
  });

  it('flags the plans that already carry the product', () => {
    const yorkville = catalogStore
      .get()
      .products.find((product) => product.sku === 'PVR-OAK-YORK60');
    const flagged = targets(yorkville?.id);
    const surface = flagged.find((target) => target.order.id === 'ord_miller_deck');
    const empty = flagged.find((target) => target.order.id === 'ord_miller_pergola');

    expect(surface?.alreadyHas).toBe(true);
    expect(empty?.alreadyHas).toBe(false);
    expect(empty?.itemCount).toBe(0);
  });
});
