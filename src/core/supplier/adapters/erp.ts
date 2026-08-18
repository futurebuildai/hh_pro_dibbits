import type { DealerBranding } from '../../domain/config';
import type { Invoice, Quote, SalesOrder } from '../../domain/supplier';
import type { EntityId } from '../../lib/ids';
import { type Result, err, ok } from '../../lib/result';
import {
  type AccountSnapshot,
  type BillingSummary,
  type CatalogHit,
  type CatalogSearchInput,
  type LoginInput,
  type PageInput,
  SUPPLIER_ERRORS,
  type SupplierAuth,
  type SupplierIdentity,
  type SupplierPage,
  type SupplierPort,
  type SupplierReads,
  type SupplierSession,
  type TokenStore,
  memoryTokenStore,
} from '../port';
import { type ErpClient, type FetchLike, createErpClient } from './erp-client';
import {
  mapAccount,
  mapBillingSummary,
  mapBranding,
  mapCatalogHit,
  mapIdentity,
  mapInvoice,
  mapPage,
  mapQuote,
  mapSalesOrder,
} from './erp-map';
import type {
  WireBillingSummary,
  WireCatalogSearch,
  WireConfig,
  WireDashboard,
  WireInvoice,
  WireMe,
  WireOrder,
  WireOrderDetail,
  WirePage,
  WireQuote,
  WireRefresh,
} from './erp-wire';

/**
 * `ErpSupplier` — Stage 1's READ adapter (spec §7.3).
 *
 * It talks to the CP-07 portal API and it does nothing else. There is no write
 * method on this object, under any name, and `supplier/__tests__/structure.test.ts`
 * asserts that on the built object rather than on the type — writes stay sim
 * everywhere this stage, and a "small" write slipped in behind the read flag is
 * exactly the thing a staged rollout exists to prevent.
 *
 * Three properties worth stating because they are the ones that would quietly
 * erode:
 *
 * - **Mode is config, never a fallback.** A 401 ends the session; it never
 *   silently resumes the simulator. A portal that starts serving fabricated
 *   prices when its ERP session lapses is the worst failure this integration
 *   has (§1.2), and it would look like everything working.
 * - **The token never leaves the adapter.** `SupplierSession` has no `token`
 *   field, so nothing above the port can persist a bearer credential into the
 *   twelve stores HH Pro writes to `localStorage`.
 * - **Capabilities come from the server.** `login()` is not finished until
 *   `GET /me` has answered, because a session whose permissions HH Pro would
 *   have to guess is not a session — it is the local `GRANTS` table wearing a
 *   JWT.
 */

export interface ErpSupplierOptions {
  baseUrl: string;
  fetch: FetchLike;
  /** Defaults to in-memory. The shell supplies the `sessionStorage` one (§1.2). */
  tokens?: TokenStore | undefined;
  wait?: ((ms: number) => Promise<void>) | undefined;
  /** Fired when the ERP says 401, so the shell can show the login screen. */
  onSessionLost?: (() => void) | undefined;
}

export function createErpSupplier(options: ErpSupplierOptions): SupplierPort {
  const tokens = options.tokens ?? memoryTokenStore();
  let session: SupplierSession | null = null;

  const client: ErpClient = createErpClient({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    tokens,
    wait: options.wait,
    onUnauthorized: () => {
      session = null;
      options.onSessionLost?.();
    },
  });

  async function loadIdentity(): Promise<Result<SupplierIdentity>> {
    const response = await client.send<WireMe>({ method: 'GET', path: '/me' });
    return response.ok ? ok(mapIdentity(response.value)) : response;
  }

  /**
   * Turns a login or refresh payload into a session.
   *
   * The capability lookup is a SECOND request and it is not optional. The login
   * response carries the user record but not the resolved capability map — only
   * `GET /me` does (the DIB-479 extension), and it answers with the set the
   * request guards themselves consulted rather than a re-derivation of it.
   */
  async function establish(
    payload: WireRefresh,
    expiresAt: string | null,
    sessionExpiresAt: string | null,
  ): Promise<Result<SupplierSession>> {
    const token = typeof payload.token === 'string' ? payload.token : '';
    if (token === '') return err(SUPPLIER_ERRORS.malformed);
    client.setToken(token);

    const identity = await loadIdentity();
    if (!identity.ok) {
      // A token whose permissions we could not read is not a usable session.
      // Keeping it would leave the app authenticated and unauthorized, which is
      // the state where a client starts inventing its own answer.
      client.clearToken();
      session = null;
      return identity;
    }

    session = {
      identity: identity.value,
      branding: mapBranding(payload.config as WireConfig | undefined),
      expiresAt,
      sessionExpiresAt,
    };
    return ok(session);
  }

  const auth: SupplierAuth = {
    async login(input: LoginInput): Promise<Result<SupplierSession>> {
      client.clearToken();
      session = null;
      const response = await client.send<WireRefresh>({
        method: 'POST',
        path: '/login',
        body: { email: input.email, password: input.password },
        anonymous: true,
      });
      if (!response.ok) return response;
      // `expires_at` / `session_expires_at` are absent from the LOGIN response —
      // the ERP ships them on refresh only. They are reported as `null` rather
      // than reconstructed by decoding the JWT: handing the instants over is
      // precisely so a client never has to parse a token, and a client that
      // parses one anyway has quietly become a second authority on when the
      // session ends. Filed as a one-field ERP extension in NOTES-DIB480.md.
      return establish(response.value, null, null);
    },

    async refresh(): Promise<Result<SupplierSession>> {
      if (!client.hasToken()) return err(SUPPLIER_ERRORS.sessionGone);
      const previousRole = session?.identity.role ?? null;
      const response = await client.send<WireRefresh>({
        method: 'POST',
        path: '/token/refresh',
      });
      if (!response.ok) return response;

      const payload = response.value;
      const expiresAt = typeof payload.expires_at === 'string' ? payload.expires_at : null;
      const sessionExpiresAt =
        typeof payload.session_expires_at === 'string' ? payload.session_expires_at : null;
      const freshRole = typeof payload.user?.role === 'string' ? payload.user.role : null;

      // The ERP mints the new token from the FRESHLY LOADED user, so a person
      // demoted since their last request refreshes into their new role. When
      // the role moved, the held capability map is stale and has to be
      // re-resolved; when it did not, re-fetching /me on every refresh is a
      // round trip that can only return what we already hold.
      if (session !== null && freshRole !== null && freshRole === previousRole) {
        session = { ...session, expiresAt, sessionExpiresAt };
        const token = typeof payload.token === 'string' ? payload.token : '';
        if (token === '') return err(SUPPLIER_ERRORS.malformed);
        client.setToken(token);
        return ok(session);
      }
      return establish(payload, expiresAt, sessionExpiresAt);
    },

    signOut(): void {
      client.clearToken();
      session = null;
    },

    session: () => session,
  };

  function page(input: PageInput | undefined): Record<string, string | number | undefined> {
    return {
      ...(input?.limit === undefined ? {} : { limit: input.limit }),
      ...(input?.offset === undefined ? {} : { offset: input.offset }),
      ...(input?.status === undefined ? {} : { status: input.status }),
    };
  }

  const reads: SupplierReads = {
    me: loadIdentity,

    async branding(): Promise<Result<DealerBranding>> {
      const response = await client.send<WireConfig>({ method: 'GET', path: '/config' });
      return response.ok ? ok(mapBranding(response.value)) : response;
    },

    async searchCatalog(input: CatalogSearchInput): Promise<Result<CatalogHit[]>> {
      const response = await client.send<WireCatalogSearch>({
        method: 'GET',
        path: '/catalog/search',
        query: { q: input.query, ...(input.limit === undefined ? {} : { limit: input.limit }) },
      });
      if (!response.ok) return response;
      const items = Array.isArray(response.value?.items) ? response.value.items : [];
      return ok(items.map(mapCatalogHit));
    },

    async dashboard(): Promise<Result<AccountSnapshot>> {
      const response = await client.send<WireDashboard>({ method: 'GET', path: '/dashboard' });
      return response.ok ? ok(mapAccount(response.value)) : response;
    },

    async billingSummary(): Promise<Result<BillingSummary>> {
      const response = await client.send<WireBillingSummary>({
        method: 'GET',
        path: '/billing/summary',
      });
      return response.ok ? ok(mapBillingSummary(response.value)) : response;
    },

    async listOrders(input?: PageInput): Promise<Result<SupplierPage<SalesOrder>>> {
      const response = await client.send<WirePage<WireOrder>>({
        method: 'GET',
        path: '/orders',
        query: page(input),
      });
      return response.ok ? ok(mapPage(response.value, mapSalesOrder)) : response;
    },

    async getOrder(id: EntityId): Promise<Result<SalesOrder>> {
      const response = await client.send<WireOrderDetail>({
        method: 'GET',
        path: `/orders/${encodeURIComponent(id)}`,
      });
      return response.ok ? ok(mapSalesOrder(response.value)) : response;
    },

    async listInvoices(input?: PageInput): Promise<Result<SupplierPage<Invoice>>> {
      const response = await client.send<WirePage<WireInvoice>>({
        method: 'GET',
        path: '/invoices',
        query: page(input),
      });
      return response.ok ? ok(mapPage(response.value, mapInvoice)) : response;
    },

    async getInvoice(id: EntityId): Promise<Result<Invoice>> {
      const response = await client.send<WireInvoice>({
        method: 'GET',
        path: `/invoices/${encodeURIComponent(id)}`,
      });
      return response.ok ? ok(mapInvoice(response.value)) : response;
    },

    async listQuotes(input?: PageInput): Promise<Result<SupplierPage<Quote>>> {
      const response = await client.send<WirePage<WireQuote>>({
        method: 'GET',
        path: '/quotes',
        query: page(input),
      });
      return response.ok ? ok(mapPage(response.value, mapQuote)) : response;
    },

    async getQuote(id: EntityId): Promise<Result<Quote>> {
      const response = await client.send<WireQuote>({
        method: 'GET',
        path: `/quotes/${encodeURIComponent(id)}`,
      });
      return response.ok ? ok(mapQuote(response.value)) : response;
    },
  };

  return {
    mode: 'erp',
    reads,
    auth,
    // Stage 1 is reads only. This is not a placeholder for a later stage's
    // object — Stage 4 adds writes by giving this a value, and until then the
    // null is the enforcement.
    writes: null,
  };
}
