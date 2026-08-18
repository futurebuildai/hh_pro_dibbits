import type { Brand, Category, PriceQuote, Product } from '../domain/catalog';
import { discountPercent, totalOnHand } from '../domain/catalog';
import type { Order, Project, ScopeItem } from '../domain/project';
import type { Collection } from '../stores/store';
import { listOf } from '../stores/store';
import { searchProducts } from './order';
import type { QuoteFor } from './pricing';

/**
 * The read model behind the Catalog destination.
 *
 * Browsing is not shopping here. There is no cart, so nothing in this file
 * accumulates anything — it answers "what does the yard sell, what do I pay
 * for it, and can I get it by Friday", and the only action a product offers is
 * putting it on a PLAN. The board stays the spine of the product.
 *
 * Everything is a pure function over store snapshots plus an injected
 * `quoteFor`, exactly like the board and order read models, so the same shapes
 * can feed the AI's tools and a future Lit component without a React tree.
 */

export interface CatalogFilter {
  /** Free text over sku, name and tags. */
  query?: string;
  /** A category id. Parent categories include everything beneath them. */
  categoryId?: string;
  /** Hide anything the yard cannot hand over today. */
  inStockOnly?: boolean;
  sort?: CatalogSort;
}

export type CatalogSort = 'relevance' | 'price-low' | 'price-high' | 'name';

export interface CatalogRow {
  product: Product;
  /** Quoted for one unit — the shelf price. Breaks are a detail-page story. */
  quote: PriceQuote;
  /** Whole percent below list, for the "your account saves you" chip. */
  savedPercent: number;
  onHand: number;
  leadTimeDays: number;
  /**
   * Availability as a consequence, not arithmetic: "In stock", "2 days from
   * the DC", "Out of stock — 21 days". A number the contractor has to subtract
   * from something is a number they will get wrong in a truck.
   */
  availability: string;
  inStock: boolean;
}

export interface CatalogBrowse {
  rows: CatalogRow[];
  /** Rows before the display limit — "showing 30 of 45". */
  matched: number;
  /** The category being browsed, if any, with its ancestors for a breadcrumb. */
  category?: Category;
  breadcrumb: Category[];
  /**
   * Set when nothing matched, in plain words naming what was searched and
   * where. An empty grid with no sentence reads as a broken screen.
   */
  emptyMessage?: string;
  /** What to try next, when there is something obvious to try. */
  emptyHint?: string;
}

const DEFAULT_LIMIT = 60;

export function categoryById(categories: readonly Category[], id: string): Category | undefined {
  return categories.find((category) => category.id === id);
}

/**
 * A category and everything under it. Browsing "Hardscape" must show pavers,
 * walls, steps and porcelain — the same cascade the pricing rules use, for the
 * same reason: a dealer who files a product two levels down still means it to
 * appear under the heading a contractor taps.
 */
export function categoryWithDescendants(
  categories: readonly Category[],
  rootId: string,
): Set<string> {
  const ids = new Set<string>([rootId]);
  // Repeat until stable rather than recursing: the tree is tiny, and this
  // cannot blow the stack on malformed data that points at itself.
  let grew = true;
  while (grew) {
    grew = false;
    for (const category of categories) {
      if (category.parentId && ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** The category chain from the root down to this one, for a breadcrumb. */
export function categoryPath(categories: readonly Category[], id: string): Category[] {
  const path: Category[] = [];
  const seen = new Set<string>();
  let current = categoryById(categories, id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? categoryById(categories, current.parentId) : undefined;
  }
  return path;
}

export interface CategoryNode {
  category: Category;
  /** Products in this category AND everything under it. */
  count: number;
  children: CategoryNode[];
}

/**
 * The category tree with live counts.
 *
 * Counts include descendants, and empty branches are dropped: a heading that
 * leads to "no products" is a dead end the contractor pays for with a tap.
 */
export function buildCategoryTree(
  products: readonly Product[],
  categories: readonly Category[],
): CategoryNode[] {
  const build = (parentId: string | undefined): CategoryNode[] =>
    categories
      .filter((category) => category.parentId === parentId)
      .map((category) => {
        const ids = categoryWithDescendants(categories, category.id);
        return {
          category,
          count: products.filter((product) => ids.has(product.categoryId)).length,
          children: build(category.id),
        };
      })
      .filter((node) => node.count > 0);

  return build(undefined);
}

function availabilityOf(product: Product): { availability: string; inStock: boolean } {
  const onHand = totalOnHand(product);
  if (onHand > 0) return { availability: 'In stock', inStock: true };
  if (product.leadTimeDays === 0) return { availability: 'In stock', inStock: true };
  // Nothing on the yard. Say how long, because that is the number that decides
  // whether it can be on site for the pour.
  return {
    availability: `Out of stock — ${product.leadTimeDays} day${
      product.leadTimeDays === 1 ? '' : 's'
    } out`,
    inStock: false,
  };
}

export function toCatalogRow(product: Product, quoteFor: QuoteFor): CatalogRow {
  const quote = quoteFor(product, 1);
  const { availability, inStock } = availabilityOf(product);
  return {
    product,
    quote,
    savedPercent: discountPercent(quote),
    onHand: totalOnHand(product),
    leadTimeDays: product.leadTimeDays,
    availability,
    inStock,
  };
}

export interface BuildCatalogBrowseInput {
  products: readonly Product[];
  categories: readonly Category[];
  filter: CatalogFilter;
  quoteFor: QuoteFor;
  limit?: number;
}

export function buildCatalogBrowse(input: BuildCatalogBrowseInput): CatalogBrowse {
  const { products, categories, filter, quoteFor } = input;
  const query = (filter.query ?? '').trim();

  const category = filter.categoryId ? categoryById(categories, filter.categoryId) : undefined;
  const inCategory = category
    ? (() => {
        const ids = categoryWithDescendants(categories, category.id);
        return products.filter((product) => ids.has(product.categoryId));
      })()
    : [...products];

  // ONE search implementation. `searchProducts` is what the add-items sheet
  // and the assistant's search_catalog tool already use, so a SKU that finds a
  // product in one place finds it in all three — a catalog with its own
  // private matching rules is a catalog that disagrees with the assistant.
  const matched = query ? searchProducts(inCategory, query, inCategory.length) : inCategory;

  const stocked = filter.inStockOnly
    ? matched.filter((product) => totalOnHand(product) > 0 || product.leadTimeDays === 0)
    : matched;

  const rows = stocked.map((product) => toCatalogRow(product, quoteFor));
  sortRows(rows, filter.sort ?? 'relevance', Boolean(query));

  const limited = rows.slice(0, input.limit ?? DEFAULT_LIMIT);
  const breadcrumb = category ? categoryPath(categories, category.id) : [];

  const empty = rows.length === 0 ? emptyCopy(query, category, filter.inStockOnly) : undefined;

  return {
    rows: limited,
    matched: rows.length,
    ...(category ? { category } : {}),
    breadcrumb,
    ...(empty ? empty : {}),
  };
}

/**
 * Say what happened, in the contractor's own terms, and name the way out.
 *
 * "No results" is technically true and useless. Whether the word was wrong,
 * the category was wrong, or the in-stock filter hid it are three different
 * problems with three different next moves.
 */
function emptyCopy(
  query: string,
  category: Category | undefined,
  inStockOnly: boolean | undefined,
): { emptyMessage: string; emptyHint?: string } {
  if (query && category) {
    return {
      emptyMessage: `Nothing in ${category.name} matches “${query}”.`,
      emptyHint: 'Search the whole catalog, or try a different word.',
    };
  }
  if (query) {
    return {
      emptyMessage: `Nothing in the catalog matches “${query}”.`,
      emptyHint:
        'Check the spelling, try the product family instead of the model name, or add it as a special order from an order.',
    };
  }
  if (inStockOnly) {
    return {
      emptyMessage: category
        ? `Nothing in ${category.name} is on the yard right now.`
        : 'Nothing in the catalog is on the yard right now.',
      emptyHint: 'Turn off “In stock only” to see what can be ordered in.',
    };
  }
  return {
    emptyMessage: category
      ? `${category.name} has no products in it.`
      : 'This catalog has no products in it.',
  };
}

function sortRows(rows: CatalogRow[], sort: CatalogSort, hasQuery: boolean): void {
  switch (sort) {
    case 'price-low':
      rows.sort((a, b) => a.quote.unitPrice - b.quote.unitPrice);
      return;
    case 'price-high':
      rows.sort((a, b) => b.quote.unitPrice - a.quote.unitPrice);
      return;
    case 'name':
      rows.sort((a, b) => a.product.name.localeCompare(b.product.name));
      return;
    default:
      // Relevance means "the order the search gave us". With no search there is
      // no relevance to preserve, so fall back to something stable a person can
      // scan: name within category.
      if (!hasQuery) rows.sort((a, b) => a.product.name.localeCompare(b.product.name));
  }
}

export interface ProductDetail {
  product: Product;
  brand?: Brand;
  category?: Category;
  breadcrumb: Category[];
  /** Quoted at the quantity the contractor is currently considering. */
  quote: PriceQuote;
  qty: number;
  /** Extended price at that quantity — what the line would add to a plan. */
  extended: number;
  savedPercent: number;
  onHand: number;
  availability: string;
  inStock: boolean;
  /** Products sharing a specClass — "a cheaper 60mm paver". Never a cart nudge. */
  alternates: CatalogRow[];
  related: CatalogRow[];
}

export interface BuildProductDetailInput {
  products: readonly Product[];
  categories: readonly Category[];
  brands: readonly Brand[];
  /** Product id or SKU — the URL carries the SKU, which is what people paste. */
  productRef: string;
  qty: number;
  quoteFor: QuoteFor;
}

export function buildProductDetail(input: BuildProductDetailInput): ProductDetail | undefined {
  const product = input.products.find(
    (candidate) => candidate.id === input.productRef || candidate.sku === input.productRef,
  );
  if (!product) return undefined;

  const qty = Math.max(1, Math.round(input.qty));
  const quote = input.quoteFor(product, qty);
  const { availability, inStock } = availabilityOf(product);

  const alternates = input.products
    .filter(
      (candidate) =>
        candidate.id !== product.id &&
        product.specClass !== undefined &&
        candidate.specClass === product.specClass,
    )
    .map((candidate) => toCatalogRow(candidate, input.quoteFor))
    .sort((a, b) => a.quote.unitPrice - b.quote.unitPrice);

  const related = product.relatedSkus
    .map((sku) => input.products.find((candidate) => candidate.sku === sku))
    .filter((candidate): candidate is Product => candidate !== undefined)
    .map((candidate) => toCatalogRow(candidate, input.quoteFor));

  const brand = input.brands.find((candidate) => candidate.id === product.brandId);
  const category = categoryById(input.categories, product.categoryId);

  return {
    product,
    ...(brand ? { brand } : {}),
    ...(category ? { category } : {}),
    breadcrumb: categoryPath(input.categories, product.categoryId),
    quote,
    qty,
    extended: Math.round(quote.unitPrice * qty),
    savedPercent: discountPercent(quote),
    onHand: totalOnHand(product),
    availability,
    inStock,
    alternates,
    related,
  };
}

/**
 * The plans a product may be added to.
 *
 * Plan-stage orders only, and that is the product philosophy showing through:
 * once an order is with the quote desk or placed, the dealer is working from
 * that scope and the contractor cannot quietly add to it. Offering a locked
 * order as a destination and refusing on tap teaches nothing.
 */
export interface PlanTarget {
  order: Order;
  project: Project;
  itemCount: number;
  /** True when this plan already carries the product being added. */
  alreadyHas: boolean;
}

export function buildPlanTargets(
  orders: Collection<Order>,
  projects: Collection<Project>,
  scope: Collection<ScopeItem>,
  productId?: string,
): PlanTarget[] {
  const items = listOf(scope);

  return listOf(orders)
    .filter((order) => order.stage === 'plan')
    .map((order) => {
      const project = projects.byId[order.projectId];
      if (!project || project.archivedAt) return undefined;
      const mine = items.filter((item) => item.orderId === order.id);
      return {
        order,
        project,
        itemCount: mine.length,
        alreadyHas: productId !== undefined && mine.some((item) => item.productId === productId),
      } satisfies PlanTarget;
    })
    .filter((target): target is PlanTarget => target !== undefined)
    .sort(
      (a, b) =>
        a.project.name.localeCompare(b.project.name) || a.order.sortOrder - b.order.sortOrder,
    );
}
