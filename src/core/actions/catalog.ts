import type { ScopeItem } from '../domain/project';
import { type Result, err, ok } from '../lib/result';
import { ordersStore, projectsStore, scopeStore } from '../stores/root';
import { listOf, remove } from '../stores/store';
import { createOrder, getOrder } from './orders';
import { addCatalogItem } from './scope';

/**
 * The action a product page offers: put this on a PLAN.
 *
 * This is the whole reason the catalog can be a destination without becoming a
 * store. A cart is a second, parallel place your intentions live — you fill
 * it, forget it, and it has no delivery date, no site, and no dealer pricing
 * context. A plan is an order in the Plan stage: it already belongs to a job,
 * it already has a date and a fulfillment method, and it is already on the
 * board where the contractor looks. So browsing does not accumulate anything;
 * it lands lines on a draft the contractor picked, or starts one.
 *
 * It creates nothing when it is given an existing plan, and it never invents a
 * second line for a SKU the plan already carries — both of those are delegated
 * to `addCatalogItem`, which is the single mutation path for scope. This
 * function only decides WHERE, and it must be able to say "nowhere" cleanly.
 */

export type PlanDestination =
  | { kind: 'existing'; orderId: string }
  | { kind: 'new'; projectId: string; name?: string };

export interface AddToPlanInput {
  /** Product id or SKU. */
  product: string;
  qty: number;
  destination: PlanDestination;
  addedBy?: 'user' | 'assistant';
}

export interface AddToPlanResult {
  orderId: string;
  orderName: string;
  projectName: string;
  item: ScopeItem;
  /** The SKU was already on that plan, so its quantity went up. */
  merged: boolean;
  /** A new plan was started for this. */
  createdOrder: boolean;
}

const DEFAULT_PLAN_NAME = 'New plan';

function describe(orderId: string): { orderName: string; projectName: string } {
  const order = getOrder(orderId);
  const project = order ? projectsStore.get().byId[order.projectId] : undefined;
  return {
    orderName: order?.name ?? 'this plan',
    projectName: project?.name ?? '',
  };
}

export function addProductToPlan(input: AddToPlanInput): Result<AddToPlanResult> {
  if (input.destination.kind === 'existing') {
    const orderId = input.destination.orderId;
    const order = getOrder(orderId);
    if (!order) return err('That plan no longer exists. Pick another one.');

    // A guard here as well as in addCatalogItem, because the sentence should
    // name the plan the contractor tapped rather than talk about "this order".
    if (order.stage !== 'plan') {
      return err(
        order.stage === 'quote'
          ? `“${order.name}” is with the quote desk. Pull it back to Plan to add to it.`
          : `“${order.name}” has already been placed. Start a new plan for this instead.`,
      );
    }

    return finish(orderId, input, false);
  }

  // A new plan. The order is created FIRST because the line needs somewhere to
  // land — and if the line then refuses, the empty draft is taken back out
  // again. A rejected "add to a new plan" that leaves a nameless empty card on
  // the board is the board lying about work that does not exist.
  const name = (input.destination.name ?? '').trim() || DEFAULT_PLAN_NAME;
  const created = createOrder({ projectId: input.destination.projectId, name });
  if (!created.ok) return created;

  const added = finish(created.value.id, input, true);
  if (!added.ok) {
    ordersStore.set(remove(ordersStore.get(), created.value.id));
  }
  return added;
}

function finish(
  orderId: string,
  input: AddToPlanInput,
  createdOrder: boolean,
): Result<AddToPlanResult> {
  // Resolve the product id BEFORE adding, so "did this merge?" is answered
  // against the state as it was — afterwards the line always exists.
  const existingItems = listOf(scopeStore.get()).filter((item) => item.orderId === orderId);

  const result = addCatalogItem({
    orderId,
    product: input.product,
    qty: input.qty,
    ...(input.addedBy ? { addedBy: input.addedBy } : {}),
  });
  if (!result.ok) return result;

  const merged = existingItems.some((item) => item.id === result.value.id);
  const { orderName, projectName } = describe(orderId);

  return ok({
    orderId,
    orderName,
    projectName,
    item: result.value,
    merged,
    createdOrder,
  });
}
