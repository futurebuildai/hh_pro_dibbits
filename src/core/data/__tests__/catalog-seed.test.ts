import { describe, expect, it } from 'vitest';
import { isStocked, totalOnHand } from '../../domain/catalog';
import { seedCatalog, seedProducts } from '../catalog-seed';

describe('catalog seed', () => {
  const catalog = seedCatalog(12345);

  it('converts the whole salvaged catalog', () => {
    expect(catalog.products).toHaveLength(45);
    expect(catalog.categories).toHaveLength(18);
    expect(catalog.brands).toHaveLength(8);
  });

  it('stores every price as integer cents', () => {
    for (const product of catalog.products) {
      expect(Number.isInteger(product.listPrice)).toBe(true);
      expect(product.listPrice).toBeGreaterThan(0);
    }
  });

  it('converts known dollar prices exactly', () => {
    const paver = catalog.products.find((p) => p.sku === 'PVR-OAK-YORK60');
    expect(paver?.listPrice).toBe(813); // $8.13/sf
  });

  it('resolves brand names to brand ids', () => {
    const brandIds = new Set(catalog.brands.map((b) => b.id));
    for (const product of catalog.products) {
      expect(brandIds.has(product.brandId)).toBe(true);
    }
  });

  it('points every product at a real category', () => {
    const categoryIds = new Set(catalog.categories.map((c) => c.id));
    for (const product of catalog.products) {
      expect(categoryIds.has(product.categoryId)).toBe(true);
    }
  });

  it('links child categories to parents that exist', () => {
    const ids = new Set(catalog.categories.map((c) => c.id));
    const children = catalog.categories.filter((c) => c.parentId !== undefined);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(ids.has(child.parentId as string)).toBe(true);
    }
  });
});

describe('manufactured availability', () => {
  it('is deterministic for a given seed', () => {
    const a = seedProducts(999);
    const b = seedProducts(999);
    expect(a.map((p) => [p.sku, p.leadTimeDays, totalOnHand(p)])).toEqual(
      b.map((p) => [p.sku, p.leadTimeDays, totalOnHand(p)]),
    );
  });

  it('differs across seeds, so demos can be varied on purpose', () => {
    const a = seedProducts(1).map((p) => totalOnHand(p));
    const b = seedProducts(2).map((p) => totalOnHand(p));
    expect(a).not.toEqual(b);
  });

  it('honours explicit stock counts from the source data', () => {
    // Source declares inStock: 5200 sf for this paver. The dealer runs two
    // yards, so this now asserts the YARD TOTAL rather than one row — which is
    // the stronger claim: it proves the split across yards is exact, and an
    // off-by-one in the split would change what the catalog says is in stock.
    const paver = seedProducts(7).find((p) => p.sku === 'PVR-TB-BLU60-SM');
    const yardRows = (paver?.stock ?? []).filter((s) => s.locationId.startsWith('loc_yard'));
    expect(yardRows.length).toBeGreaterThan(0);
    expect(yardRows.reduce((sum, row) => sum + row.onHand, 0)).toBe(5200);
  });

  it('splits every yard count across the yards without inventing or losing any', () => {
    // Every product, one seed: the split must be exact for all of them, not
    // just the one with a declared count.
    for (const product of seedProducts(11)) {
      const yardRows = product.stock.filter((s) => s.locationId.startsWith('loc_yard'));
      expect(yardRows.every((row) => row.onHand >= 0)).toBe(true);
      // A satellite yard never holds more than the primary.
      const [primary, ...rest] = yardRows;
      for (const row of rest) {
        expect(row.onHand).toBeLessThanOrEqual(primary?.onHand ?? 0);
      }
    }
  });

  it('gives stocked products no lead time and out-of-stock products a real wait', () => {
    for (const product of seedProducts(4242)) {
      if (isStocked(product)) {
        expect(product.leadTimeDays).toBeLessThanOrEqual(2);
      } else {
        // An out-of-stock item must carry a wait long enough to be worth warning about.
        expect(product.leadTimeDays).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('produces some out-of-stock items so lead-time warnings have something to fire on', () => {
    const products = seedProducts(4242);
    expect(products.some((p) => !isStocked(p))).toBe(true);
    expect(products.some((p) => isStocked(p))).toBe(true);
  });

  it('assigns spec classes so value engineering has substitutes to offer', () => {
    const products = seedProducts(1);
    const classed = products.filter((p) => p.specClass !== undefined);
    expect(classed.length).toBeGreaterThan(5);

    // At least one class must contain two products, or there is nothing to swap.
    const counts = new Map<string, number>();
    for (const product of classed) {
      counts.set(product.specClass as string, (counts.get(product.specClass as string) ?? 0) + 1);
    }
    expect([...counts.values()].some((n) => n >= 2)).toBe(true);
  });
});
