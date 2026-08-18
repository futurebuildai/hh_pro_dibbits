import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot } from '../../boot';
import { ordersStore, scopeStore, teamStore } from '../../stores/root';
import { listOf } from '../../stores/store';
import { addProductToPlan } from '../catalog';
import { switchActiveMember } from '../team';

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

/** Seeded fixtures: an empty draft, a draft with pavers on it, and locked orders. */
const EMPTY_DRAFT = 'ord_miller_pergola';
const PAVER_DRAFT = 'ord_miller_deck';
const AT_QUOTE_DESK = 'ord_anderson';
const PLACED = 'ord_wilson_frame';
const MILLER = 'prj_miller';

const FIELD_HAND = 'tm_ty'; // Ty Nguyen, field role — may not edit scope

function itemsOf(orderId: string) {
  return listOf(scopeStore.get()).filter((item) => item.orderId === orderId);
}

function orderCount() {
  return ordersStore.get().allIds.length;
}

describe('adding a catalog product to a plan', () => {
  beforeEach(() => boot({ reset: true, seed: 20_260_730 }));

  it('lands the line on the plan that was chosen, and creates nothing', () => {
    const before = orderCount();
    const result = addProductToPlan({
      product: 'JNT-POLY-SAND',
      qty: 6,
      destination: { kind: 'existing', orderId: EMPTY_DRAFT },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.orderId).toBe(EMPTY_DRAFT);
      expect(result.value.createdOrder).toBe(false);
      expect(result.value.merged).toBe(false);
      expect(result.value.orderName).toBe('Pool surround (rough idea)');
      expect(result.value.projectName).toBe('Miller Residence — Patio');
    }

    // The point of the whole feature: no second home for the contractor's
    // intentions. One line, on the plan they picked, and not one order more.
    expect(orderCount()).toBe(before);
    expect(itemsOf(EMPTY_DRAFT)).toHaveLength(1);
    expect(itemsOf(EMPTY_DRAFT)[0]?.qty).toBe(6);
  });

  it('prices the line through the account, not off the shelf', () => {
    const result = addProductToPlan({
      product: 'PVR-OAK-YORK60',
      qty: 120,
      destination: { kind: 'existing', orderId: EMPTY_DRAFT },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.item.priceSource).toBe('erp');
      expect(result.value.item.unitPrice).toBe(635); // contract price
      expect(result.value.item.listPrice).toBe(813);
      expect(result.value.item.uom).toBe('SF');
    }
  });

  it('bumps the quantity when the plan already carries that SKU', () => {
    const beforeItems = itemsOf(PAVER_DRAFT).length;
    const existing = itemsOf(PAVER_DRAFT).find((item) => item.snapshot.sku === 'PVR-OAK-YORK60');
    expect(existing?.qty).toBe(640);

    const result = addProductToPlan({
      product: 'PVR-OAK-YORK60',
      qty: 60,
      destination: { kind: 'existing', orderId: PAVER_DRAFT },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.merged).toBe(true);
      expect(result.value.item.id).toBe(existing?.id);
      expect(result.value.item.qty).toBe(700);
    }
    // No duplicate line — two lines for one SKU would also hide the volume
    // break the combined 700 sq ft qualifies for.
    expect(itemsOf(PAVER_DRAFT)).toHaveLength(beforeItems);
  });

  it('refuses a plan the supplier already holds, and names it', () => {
    const desk = addProductToPlan({
      product: 'JNT-POLY-SAND',
      qty: 2,
      destination: { kind: 'existing', orderId: AT_QUOTE_DESK },
    });
    expect(desk.ok).toBe(false);
    if (!desk.ok) {
      expect(desk.error).toContain('Permeable driveway');
      expect(desk.error).toContain('quote desk');
    }

    const placed = addProductToPlan({
      product: 'JNT-POLY-SAND',
      qty: 2,
      destination: { kind: 'existing', orderId: PLACED },
    });
    expect(placed.ok).toBe(false);
    if (!placed.ok) expect(placed.error).toContain('already been placed');

    expect(itemsOf(AT_QUOTE_DESK).some((item) => item.snapshot.sku === 'JNT-POLY-SAND')).toBe(
      false,
    );
  });

  it('refuses a plan that no longer exists rather than inventing one', () => {
    const before = orderCount();
    const result = addProductToPlan({
      product: 'JNT-POLY-SAND',
      qty: 2,
      destination: { kind: 'existing', orderId: 'ord_deleted' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('no longer exists');
    expect(orderCount()).toBe(before);
  });

  it('never creates a second order for an existing destination, whatever goes wrong', () => {
    // The property, stated once over every failure mode the destination has:
    // "add to THIS plan" either adds to that plan or does nothing at all.
    const before = orderCount();
    const cases = [
      { orderId: AT_QUOTE_DESK, product: 'JNT-POLY-SAND', qty: 2 },
      { orderId: PLACED, product: 'JNT-POLY-SAND', qty: 2 },
      { orderId: 'ord_nope', product: 'JNT-POLY-SAND', qty: 2 },
      { orderId: EMPTY_DRAFT, product: 'NOT-A-SKU', qty: 2 },
      { orderId: EMPTY_DRAFT, product: 'JNT-POLY-SAND', qty: 0 },
    ];

    for (const testCase of cases) {
      const result = addProductToPlan({
        product: testCase.product,
        qty: testCase.qty,
        destination: { kind: 'existing', orderId: testCase.orderId },
      });
      expect(result.ok).toBe(false);
      expect(orderCount()).toBe(before);
    }

    const good = addProductToPlan({
      product: 'JNT-POLY-SAND',
      qty: 2,
      destination: { kind: 'existing', orderId: EMPTY_DRAFT },
    });
    expect(good.ok).toBe(true);
    expect(orderCount()).toBe(before);
  });
});

describe('starting a new plan from a product', () => {
  beforeEach(() => boot({ reset: true, seed: 20_260_730 }));

  it('creates exactly one plan, in Plan stage, with the line on it', () => {
    const before = orderCount();
    const result = addProductToPlan({
      product: 'MLC-CEDAR-RED-CY',
      qty: 12,
      destination: { kind: 'new', projectId: MILLER, name: 'Bed mulch' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(orderCount()).toBe(before + 1);
    expect(result.value.createdOrder).toBe(true);
    expect(result.value.orderName).toBe('Bed mulch');

    const created = ordersStore.get().byId[result.value.orderId];
    expect(created?.stage).toBe('plan');
    expect(created?.projectId).toBe(MILLER);
    expect(itemsOf(result.value.orderId)).toHaveLength(1);
    expect(itemsOf(result.value.orderId)[0]?.qty).toBe(12);
  });

  it('names an unnamed plan rather than refusing on an empty field', () => {
    const result = addProductToPlan({
      product: 'MLC-CEDAR-RED-CY',
      qty: 3,
      destination: { kind: 'new', projectId: MILLER, name: '   ' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.orderName).toBe('New plan');
  });

  it('takes the empty draft back out again when the line refuses', () => {
    // The rollback. Without it, a mistyped SKU leaves a nameless empty card
    // sitting in the Plan column — the board claiming work that never existed.
    const before = orderCount();
    const result = addProductToPlan({
      product: 'NOT-A-REAL-SKU',
      qty: 4,
      destination: { kind: 'new', projectId: MILLER, name: 'Ghost plan' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('NOT-A-REAL-SKU');
    expect(orderCount()).toBe(before);
    expect(listOf(ordersStore.get()).some((order) => order.name === 'Ghost plan')).toBe(false);
  });

  it('refuses a project that does not exist, and creates nothing', () => {
    const before = orderCount();
    const result = addProductToPlan({
      product: 'MLC-CEDAR-RED-CY',
      qty: 3,
      destination: { kind: 'new', projectId: 'prj_nope' },
    });

    expect(result.ok).toBe(false);
    expect(orderCount()).toBe(before);
  });
});

describe('the permission gate reaches the catalog too', () => {
  beforeEach(() => boot({ reset: true, seed: 20_260_730 }));

  it('refuses the field hand, names who can, and leaves no order behind', () => {
    expect(teamStore.get().members.byId[FIELD_HAND]?.role).toBe('field');
    switchActiveMember(FIELD_HAND);

    const before = orderCount();
    const existing = addProductToPlan({
      product: 'JNT-POLY-SAND',
      qty: 2,
      destination: { kind: 'existing', orderId: EMPTY_DRAFT },
    });
    expect(existing.ok).toBe(false);
    if (!existing.ok) expect(existing.error).toContain('edit orders');

    const fresh = addProductToPlan({
      product: 'JNT-POLY-SAND',
      qty: 2,
      destination: { kind: 'new', projectId: MILLER, name: 'Field plan' },
    });
    expect(fresh.ok).toBe(false);

    expect(orderCount()).toBe(before);
    expect(itemsOf(EMPTY_DRAFT)).toHaveLength(0);
  });
});
