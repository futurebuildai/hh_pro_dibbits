import type { EntityId } from '../../lib/ids';
import { type Result, err, ok } from '../../lib/result';
import type { SupplierReadOnlyPort, SupplierSession } from '../port';
import {
  type ErpClient,
  type FetchLike,
  SESSION_ENDED,
  type TokenStore,
  createErpClient,
} from './erp/client';
import {
  mapAccountSummary,
  mapBillingSummary,
  mapBranding,
  mapCatalogHits,
  mapIdentity,
  mapInvoice,
  mapList,
  mapQuote,
  mapSalesOrder,
  mapSession,
} from './erp/map';

/**
 * The READ adapter. Stage 1 of the rollout (`erpReads`).
 *
 * Every method here is a GET, except the two that establish who is asking.
 * There is no `submitToQuoteDesk`, no `createOrderWithSupplier`, no
 * `payInvoices` — not disabled, not throwing "not implemented", ABSENT. A
 * method that does not exist cannot be reached by a button, by a stage effect,
 * or by an AI tool, and `supplier/__tests__/structure.test.ts` fails if one
 * ever appears. Writes stay with the simulator until Stages 3-5.
 *
 * The supplier is a plain object literal rather than a class instance, so its
 * own keys ARE its surface — nothing hides on a prototype where a structural
 * test would miss it.
 */
export type ErpSupplier = SupplierReadOnlyPort & { readonly mode: 'erp' };

export interface ErpSupplierOptions {
  baseUrl: string;
  /** Injected, never ambient — `src/core` reads no globals. */
  fetch: FetchLike;
  tokens?: TokenStore | undefined;
  onSessionLost?: (() => void) | undefined;
  retries?: number | undefined;
  backoffMs?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** Transport result -> domain result, in one step, so a refusal short-circuits. */
function mapped<T>(raw: Result<unknown>, map: (value: unknown) => Result<T>): Result<T> {
  return raw.ok ? map(raw.value) : err(raw.error);
}

export function createErpSupplier(options: ErpSupplierOptions): ErpSupplier {
  const client = createErpClient(options);
  return buildReads(client);
}

function buildReads(client: ErpClient): ErpSupplier {
  async function establish(path: string, body: unknown): Promise<Result<SupplierSession>> {
    const raw = await client.authPost(path, body);
    if (!raw.ok) return err(raw.error);

    const session = mapSession(raw.value);
    if (!session.ok) return err(session.error);

    // The token goes to the store and nowhere else; the caller receives an
    // identity and an expiry, never a credential.
    client.tokens.set(session.value.token, session.value.session.expiresAt);
    return ok(session.value.session);
  }

  return {
    mode: 'erp',

    login: (input) => establish('/login', { email: input.email, password: input.password }),

    refresh: () => {
      // Nothing to slide forward. Refusing here means an unauthenticated
      // refresh never reaches the network, so it cannot be mistaken for the
      // 401 that means "this session has been revoked".
      if (!client.tokens.get()) return Promise.resolve(err<SupplierSession>(SESSION_ENDED));
      return establish('/token/refresh', {});
    },

    me: async () => mapped(await client.get('/me'), mapIdentity),

    branding: async () => mapped(await client.get('/config'), mapBranding),

    searchCatalog: async (input) =>
      mapped(
        await client.get('/catalog/search', {
          query: { q: input.query, limit: input.limit ?? 25 },
        }),
        mapCatalogHits,
      ),

    accountSummary: async () => mapped(await client.get('/dashboard'), mapAccountSummary),

    billingSummary: async () => mapped(await client.get('/billing/summary'), mapBillingSummary),

    listQuotes: async () =>
      mapped(await client.get('/quotes'), (raw) => mapList(raw, 'quotes', mapQuote)),

    getQuote: async (quoteId: EntityId) =>
      mapped(await client.get(`/quotes/${encodeURIComponent(quoteId)}`), mapQuote),

    listSalesOrders: async () =>
      mapped(await client.get('/orders'), (raw) => mapList(raw, 'orders', mapSalesOrder)),

    getSalesOrder: async (salesOrderId: EntityId) =>
      mapped(await client.get(`/orders/${encodeURIComponent(salesOrderId)}`), mapSalesOrder),

    listInvoices: async () =>
      mapped(await client.get('/invoices'), (raw) => mapList(raw, 'invoices', mapInvoice)),

    getInvoice: async (invoiceId: EntityId) =>
      mapped(await client.get(`/invoices/${encodeURIComponent(invoiceId)}`), mapInvoice),
  };
}
