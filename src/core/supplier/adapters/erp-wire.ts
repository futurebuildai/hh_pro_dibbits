/**
 * The ERP's wire shapes, transcribed field-for-field from the Go structs that
 * serialize them. This file is the ONLY place those names appear; everything
 * else in the adapter speaks domain types.
 *
 * Provenance (hardscapeos, originally branch `feedback/dib-479-portal-stage1a`;
 * re-verified against `origin/master` at 88b17b1 and against the LIVE staging
 * responses of dibbits-staging.gablelbm.com for DIB-501 — every struct below
 * matched, and the login/refresh asymmetry still holds on master):
 *   portal/model.go        LoginResponse, User, Config
 *   portal/refresh.go      RefreshResponse
 *   portal/settings.go     MeResponse (User embedded + capabilities)
 *   portal/rbac.go         Capabilities
 *   portal/catalog.go      CatalogSearchResponse
 *   portal/dashboard.go    DashboardResponse, BillingSummary
 *   product/model.go       CatalogResult
 *   customer/model.go      Account
 *   order/model.go         Order, Line, Detail
 *   billing/model.go       Invoice, Line
 *   quote/model.go         Quote, Line, Detail
 *   platform/httpx         Page[T], Error envelope
 *
 * Everything is optional at the type level on purpose: this is untrusted input
 * off a network, and `erp-map.ts` is the thing that decides what a missing or
 * hostile field costs. A wire type that promises fields are present would push
 * that decision into a `!` somewhere downstream.
 */

export interface WireUser {
  id?: string;
  customer_id?: string;
  email?: string;
  name?: string;
  role?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface WireCapabilities {
  manage_users?: boolean;
  view_billing?: boolean;
  pay_invoices?: boolean;
  manage_payment_methods?: boolean;
  submit_rfq?: boolean;
  create_orders?: boolean;
  view_orders_deliveries?: boolean;
  edit_delivery_instructions?: boolean;
  manage_files?: boolean;
}

export interface WireMe extends WireUser {
  capabilities?: WireCapabilities;
}

export interface WireConfig {
  id?: string;
  dealer_name?: string;
  logo_url?: string;
  primary_color?: string;
  support_email?: string;
  support_phone?: string;
}

export interface WireLogin {
  token?: string;
  user?: WireUser;
  config?: WireConfig;
}

export interface WireRefresh extends WireLogin {
  expires_at?: string;
  session_expires_at?: string;
}

export interface WirePage<T> {
  items?: T[];
  total?: number;
  limit?: number;
  offset?: number;
}

export interface WireCatalogResult {
  product_id?: string;
  sku?: string;
  name?: string;
  category?: string;
  base_uom?: string;
}

export interface WireCatalogSearch {
  items?: WireCatalogResult[];
}

export interface WireAccount {
  customer_id?: string;
  account_no?: string;
  name?: string;
  customer_type?: string;
  branch_id?: string;
  payment_terms_days?: number;
  credit_limit_cents?: number;
  on_hold?: boolean;
  tax_exempt?: boolean;
  balance_cents?: number;
  is_active?: boolean;
}

export interface WireDashboard {
  account?: WireAccount;
  open_balance_cents?: number;
  available_credit_cents?: number;
}

export interface WireBillingSummary {
  open_balance_cents?: number;
  credit_limit_cents?: number;
  available_credit_cents?: number;
  on_hold?: boolean;
  payment_terms_days?: number;
}

export interface WireOrder {
  id?: string;
  order_no?: string;
  customer_id?: string;
  quote_id?: string;
  status?: string;
  fulfillment?: string;
  requested_date?: string;
  subtotal_cents?: number;
  tax_cents?: number;
  total_cents?: number;
  created_at?: string;
}

export interface WireOrderDetail extends WireOrder {
  lines?: unknown[];
  delivery_instructions?: string;
}

export interface WireInvoice {
  id?: string;
  invoice_no?: string;
  customer_id?: string;
  order_id?: string;
  status?: string;
  issue_date?: string;
  due_date?: string;
  subtotal_cents?: number;
  tax_cents?: number;
  holdback_cents?: number;
  total_cents?: number;
  balance_cents?: number;
}

export interface WireQuote {
  id?: string;
  quote_no?: string;
  customer_id?: string;
  status?: string;
  valid_until?: string;
  subtotal_cents?: number;
  tax_cents?: number;
  total_cents?: number;
  created_at?: string;
}
