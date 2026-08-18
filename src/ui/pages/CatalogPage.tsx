import { supplierName } from '@core/config/runtime';
import { type CatalogSort, buildCatalogBrowse, buildCategoryTree } from '@core/selectors/catalog';
import { accountQuoteFor } from '@core/selectors/pricing';
import { catalogStore } from '@core/stores/root';
import { ProductRow } from '@ui/components/catalog/ProductRow';
import { useStore } from '@ui/hooks/useStore';
import { cn } from '@ui/lib/cn';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo } from 'react';

/**
 * The catalogue as a destination.
 *
 * It answers three questions and refuses to become a store: what does the yard
 * sell, what do I pay for it, and can I get it in time. There is no cart, no
 * badge, and no running total — the only way out of a product is onto a plan,
 * which is an order that already has a job, a date and a site attached.
 *
 * Filter state lives in the URL (`?q=&cat=&stock=&sort=`) rather than in
 * component state. That is what makes the phone's back button work the way a
 * contractor expects: open a product, press back, and the search you typed and
 * the category you tapped are still there. It also makes a filtered catalogue
 * something you can send to your PM.
 */

interface Props {
  /** `?q=paver&cat=c_11` — the browse state, carried on every link. */
  search: URLSearchParams;
  onSearchChange: (next: URLSearchParams) => void;
  onOpenProduct: (sku: string) => void;
}

const SORTS: { id: CatalogSort; label: string }[] = [
  { id: 'relevance', label: 'Best match' },
  { id: 'price-low', label: 'Price: low first' },
  { id: 'price-high', label: 'Price: high first' },
  { id: 'name', label: 'Name' },
];

export function CatalogPage({ search, onSearchChange, onOpenProduct }: Props) {
  const { products, categories } = useStore(catalogStore, (state) => state);

  const query = search.get('q') ?? '';
  const categoryId = search.get('cat') ?? '';
  const inStockOnly = search.get('stock') === '1';
  const sort = (search.get('sort') as CatalogSort | null) ?? 'relevance';

  const tree = useMemo(() => buildCategoryTree(products, categories), [products, categories]);

  const browse = useMemo(
    () =>
      buildCatalogBrowse({
        products,
        categories,
        quoteFor: accountQuoteFor,
        filter: {
          ...(query ? { query } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(inStockOnly ? { inStockOnly } : {}),
          sort,
        },
      }),
    [products, categories, query, categoryId, inStockOnly, sort],
  );

  function set(key: string, value: string) {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    onSearchChange(next);
  }

  const filtered = Boolean(query || categoryId || inStockOnly);

  /**
   * One row of chips that drills in rather than listing eighteen categories at
   * once. Tap a heading and the row becomes its subcategories; tap a
   * subcategory and the row stays on its siblings so you can compare across
   * them without going back up.
   */
  const flat = useMemo(() => tree.flatMap((node) => [node, ...node.children]), [tree]);
  const selectedNode = flat.find((node) => node.category.id === categoryId);
  const parentNode = selectedNode?.category.parentId
    ? flat.find((node) => node.category.id === selectedNode.category.parentId)
    : undefined;
  const chips = selectedNode
    ? selectedNode.children.length > 0
      ? selectedNode.children
      : (parentNode?.children ?? tree)
    : tree;

  return (
    <div className="pb-28">
      {/* Search sits above everything and stays there: on a phone the thumb
          should never have to scroll back up to change the query. */}
      <div className="sticky top-0 z-20 border-b border-border bg-surface/95 px-3 pt-2 pb-2.5 backdrop-blur lg:px-6">
        <label className="relative block">
          <span className="sr-only">Search the catalog</span>
          <Search
            size={16}
            className="-translate-y-1/2 absolute top-1/2 left-3 text-text-subtle"
            strokeWidth={2}
            aria-hidden
          />
          <input
            value={query}
            onChange={(event) => set('q', event.target.value)}
            placeholder="Search products or paste a SKU"
            className="min-h-11 w-full rounded-lg border border-border bg-surface pr-10 pl-9 text-sm outline-none focus:border-brand"
          />
          {query ? (
            <button
              type="button"
              onClick={() => set('q', '')}
              aria-label="Clear the search"
              className="-translate-y-1/2 absolute top-1/2 right-1 flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text"
            >
              <X size={16} strokeWidth={2} />
            </button>
          ) : null}
        </label>

        {/* Categories scroll sideways on a phone and wrap on a desktop — the
            same control, not two. */}
        <div className="-mx-3 mt-2 flex gap-1.5 overflow-x-auto px-3 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
          <FilterChip active={categoryId === ''} onClick={() => set('cat', '')}>
            All
          </FilterChip>
          {/* Drilled into a heading: keep the heading itself tappable, so
              "everything in Hardscape" is one tap from its subcategories. */}
          {selectedNode && selectedNode.children.length > 0 ? (
            <FilterChip active onClick={() => set('cat', '')}>
              {selectedNode.category.name}
            </FilterChip>
          ) : null}
          {chips.map((node) => (
            <FilterChip
              key={node.category.id}
              active={categoryId === node.category.id}
              onClick={() => set('cat', categoryId === node.category.id ? '' : node.category.id)}
            >
              {node.category.name}
              <span className="ml-1 text-[10.5px] opacity-70 tabular-nums">{node.count}</span>
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3 pb-1 lg:px-6">
        {/* Silent when there is nothing to count: the empty block below says
            what happened, and a second sentence saying it again is noise. */}
        <p className="text-[12.5px] text-text-muted">
          {browse.matched === 0
            ? `${supplierName()} catalog`
            : browse.matched === browse.rows.length
              ? `${browse.matched} product${browse.matched === 1 ? '' : 's'}`
              : `Showing ${browse.rows.length} of ${browse.matched}`}
          {browse.breadcrumb.length > 0
            ? ` · ${browse.breadcrumb.map((category) => category.name).join(' › ')}`
            : ''}
        </p>

        <div className="flex items-center gap-1.5">
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px]">
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={(event) => set('stock', event.target.checked ? '1' : '')}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            In stock only
          </label>

          <label className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px]">
            <SlidersHorizontal size={13} strokeWidth={2} aria-hidden />
            <span className="sr-only">Sort products</span>
            <select
              value={sort}
              onChange={(event) => set('sort', event.target.value)}
              className="bg-transparent text-[12px] outline-none"
            >
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {browse.rows.length === 0 ? (
        <div className="px-6 py-14 text-center">
          {/* Say what happened. An empty grid with no sentence reads as a
              screen that failed to load, and the contractor retypes the same
              search rather than trying a different word. */}
          <p className="text-[14px] font-medium">{browse.emptyMessage}</p>
          {browse.emptyHint ? (
            <p className="mx-auto mt-1.5 max-w-xs text-[12.5px] text-text-muted">
              {browse.emptyHint}
            </p>
          ) : null}
          {filtered ? (
            <button
              type="button"
              onClick={() => onSearchChange(new URLSearchParams())}
              className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-border-strong px-4 text-[13px] font-medium hover:bg-surface-2"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 px-3 py-2 lg:grid-cols-2 lg:px-6 2xl:grid-cols-3">
          {browse.rows.map((row) => (
            <ProductRow key={row.product.id} row={row} onOpen={onOpenProduct} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-[12.5px] font-medium transition-colors',
        active
          ? 'border-brand bg-brand-tint text-brand'
          : 'border-border text-text-muted hover:bg-surface-3 hover:text-text',
      )}
    >
      {children}
    </button>
  );
}
