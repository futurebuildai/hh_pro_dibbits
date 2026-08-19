/**
 * Recorded ERP responses — the fixtures the contract tests replay.
 *
 * These are recorded from the CONTRACT (the ERP-connection spec, §1-§2 and
 * Appendix A), not from a live server: the portal-side work is DIB-479 and is
 * in flight. That is deliberate and it is the point of building against
 * fixtures — the adapter and the routes can be built in parallel, and the day
 * the ERP answers for real these payloads are re-recorded from it and any
 * divergence fails here rather than in front of a contractor.
 *
 * Two properties every fixture keeps on purpose:
 *
 * - **snake_case, `*_cents` integers, uppercase enums.** That is the Go
 *   handlers' vocabulary, and the whole reason `map.ts` exists.
 * - **Some of them carry fields that must NEVER cross the counter.** The
 *   catalog and quote fixtures deliberately include `margin_bps`, `floor_bps`,
 *   `cost_cents` and `bypass_reason` — a projection that drifts one deploy and
 *   starts leaking them is R-2, the unrecoverable commercial failure. The
 *   mapper is a whitelist, so the mapped value contains none of them, and
 *   `erp-contract.test.ts` fails the moment that stops being true.
 */

export const LOGIN_RESPONSE = {
  token: 'eyJhbGciOiJIUzI1NiJ9.recorded.signature',
  expires_at: '2026-08-19T18:00:00.000Z',
  user: {
    id: 'pu_8812',
    customer_id: 'cus_4471',
    name: 'Dana Reyes',
    email: 'dana@summitgrade.example',
    role: 'account_admin',
    capabilities: {
      submit_rfq: true,
      create_orders: true,
      pay_invoices: true,
      manage_payment_methods: true,
      view_orders_deliveries: true,
      edit_delivery_instructions: true,
      manage_users: true,
      view_billing: true,
    },
  },
  config: {
    dealer_name: 'Dibbits Landscape Supply',
    primary_color: '#1f6feb',
  },
};

/** A field crew member: view + pickup, nothing else. */
export const ME_FIELD_CREW = {
  id: 'pu_9903',
  customer_id: 'cus_4471',
  name: 'Marcus Webb',
  email: 'marcus@summitgrade.example',
  role: 'field_crew',
  capabilities: {
    submit_rfq: false,
    create_orders: false,
    pay_invoices: false,
    manage_payment_methods: false,
    view_orders_deliveries: true,
    edit_delivery_instructions: true,
    manage_users: false,
    view_billing: false,
  },
};

/** A buyer: orders and pays, cannot manage users. */
export const ME_BUYER = {
  id: 'pu_5520',
  customer_id: 'cus_4471',
  name: 'Robin Alvarez',
  email: 'robin@summitgrade.example',
  role: 'buyer',
  capabilities: {
    submit_rfq: true,
    create_orders: true,
    pay_invoices: true,
    manage_payment_methods: true,
    view_orders_deliveries: true,
    edit_delivery_instructions: true,
    manage_users: false,
    view_billing: true,
  },
};

export const CONFIG_RESPONSE = {
  dealer_name: 'Dibbits Landscape Supply',
  primary_color: 'oklch(52% 0.19 255)',
  logo_url: '/images/dealer/dibbits.svg',
  support_email: 'orders@dibbits.example',
  support_phone: '605-555-0142',
};

/**
 * `GET /catalog/search`. The second row is a drifted projection: it carries
 * the dealer's cost and margin, which must not survive the mapper.
 */
export const CATALOG_SEARCH_RESPONSE = {
  results: [
    {
      id: 'prd_2201',
      sku: 'TB-BLU-60',
      name: 'Blu 60 Smooth Paver',
      uom: 'SF',
      list_price_cents: 689,
      on_hand: 4200,
      lead_time_days: 0,
      image_url: '/images/products/tb-blu-60.svg',
    },
    {
      id: 'prd_3310',
      sku: 'AGG-BASE-A',
      name: "Granular 'A' Base",
      uom: 'TON',
      list_price_cents: 3613,
      on_hand: 180,
      lead_time_days: 2,
      cost_cents: 2110,
      margin_bps: 4160,
      floor_bps: 1800,
      blocked: false,
      bypass_reason: '',
      source: 'category_policy',
    },
  ],
};

export const DASHBOARD_RESPONSE = {
  account: {
    id: 'cus_4471',
    name: 'Summit Grade Hardscapes',
    account_number: 'SG-10442',
    customer_type: 'contractor',
    payment_terms_days: 30,
    credit_limit_cents: 2_000_000,
    on_hold: false,
    branch_id: 'br_02',
  },
};

/** A dealer running Net-45 — a term HH Pro's code union cannot express. */
export const DASHBOARD_NET45 = {
  account: {
    id: 'cus_4471',
    name: 'Summit Grade Hardscapes',
    account_number: 'SG-10442',
    customer_type: 'contractor',
    payment_terms_days: 45,
    credit_limit_cents: 2_000_000,
    on_hold: true,
    branch_id: 'br_02',
  },
};

/** A cash account: due on receipt, no credit line. */
export const DASHBOARD_COD = {
  account: {
    id: 'cus_7788',
    name: 'Copps Landscaping',
    account_number: 'CP-20991',
    customer_type: 'contractor',
    payment_terms_days: 0,
    on_hold: false,
  },
};

export const BILLING_SUMMARY_RESPONSE = {
  balance_cents: 1_420_000,
  past_due_cents: 318_500,
  credit_limit_cents: 2_000_000,
  credit_available_cents: 580_000,
  card_fee_percent: 2.9,
};

export const QUOTES_RESPONSE = {
  quotes: [
    {
      id: 'q_7001',
      project_id: 'ord_1188',
      quote_no: 'Q-1043',
      status: 'PRICED',
      submitted_at: '2026-08-14T13:20:00.000Z',
      priced_at: '2026-08-14T18:05:00.000Z',
      valid_until: '2026-08-28T18:05:00.000Z',
      desk_note: 'Held the Blu 60 at the spring price. Coping is a 3-week order.',
      lines: [
        { line_id: 'li_5501', unit_price_cents: 645, lead_time_days: 0, margin_bps: 3900 },
        { line_id: 'li_5502', unit_price_cents: 12_400, lead_time_days: 21, cost_cents: 9100 },
      ],
    },
  ],
};

/** A status this build has never seen. It must not read as "priced". */
export const QUOTE_UNKNOWN_STATUS = {
  id: 'q_7002',
  project_id: 'ord_1190',
  quote_no: 'Q-1044',
  status: 'AWAITING_BRANCH_APPROVAL',
  submitted_at: '2026-08-18T09:00:00.000Z',
  lines: [],
};

export const ORDERS_RESPONSE = {
  orders: [
    {
      id: 'so_9100',
      project_id: 'ord_1188',
      order_no: 'SO-5211',
      status: 'PICKING',
      fulfillment: 'delivery',
      created_at: '2026-08-15T14:02:00.000Z',
      promised_date: '2026-08-22T00:00:00.000Z',
      subtotal_cents: 894_300,
      delivery_instructions: 'Drop at the north gate.',
    },
  ],
};

/** A will-call order the yard has staged. READY means the counter, not a truck. */
export const ORDER_READY_WILLCALL = {
  id: 'so_9101',
  project_id: 'ord_1191',
  order_no: 'SO-5212',
  status: 'READY',
  fulfillment: 'willcall',
  created_at: '2026-08-16T08:30:00.000Z',
  subtotal_cents: 41_200,
};

/** The same status on a delivery: nothing has left the yard. */
export const ORDER_READY_DELIVERY = {
  ...ORDER_READY_WILLCALL,
  id: 'so_9102',
  order_no: 'SO-5213',
  fulfillment: 'delivery',
};

export const INVOICES_RESPONSE = {
  invoices: [
    {
      id: 'inv_3301',
      invoice_no: 'INV-9042',
      customer_id: 'cus_4471',
      project_id: 'ord_1188',
      order_id: 'so_9100',
      origin: 'portal',
      issued_at: '2026-08-16T00:00:00.000Z',
      due_at: '2026-09-15T00:00:00.000Z',
      subtotal_cents: 894_300,
      balance_cents: 894_300,
      description: 'Wilson Custom Home — paver field',
    },
    {
      id: 'inv_3302',
      invoice_no: 'INV-9051',
      customer_id: 'cus_4471',
      origin: 'counter',
      issued_at: '2026-08-17T00:00:00.000Z',
      due_at: '2026-09-16T00:00:00.000Z',
      subtotal_cents: 12_600,
      balance_cents: 0,
      description: 'Counter sale — polymeric sand',
    },
  ],
};
