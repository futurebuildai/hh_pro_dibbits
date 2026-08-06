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
    // Source declares inStock: 5200 sf for this paver.
    const paver = seedProducts(7).find((p) => p.sku === 'PVR-TB-BLU60-SM');
    const yard = paver?.stock.find((s) => s.locationId === 'loc_yard');
    expect(yard?.onHand).toBe(5200);
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
