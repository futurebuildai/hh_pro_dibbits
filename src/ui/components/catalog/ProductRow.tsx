import { perUnit } from '@core/domain/units';
import { formatCents } from '@core/lib/money';
import type { CatalogRow } from '@core/selectors/catalog';
import { cn } from '@ui/lib/cn';
import { ChevronRight, Package } from 'lucide-react';

/**
 * One product in a list.
 *
 * The whole row opens the product — a row with its own "add" button would be a
 * one-tap purchase decision made before anyone has said how much they need,
 * which in a catalogue sold by the square foot and the tonne is not a decision
 * at all. Quantity belongs on the product page, where the price answers back.
 *
 * Price treatment matches the order line: the contractor's number is the
 * number, list is struck through beside it. Same contrast, same reason.
 */

interface Props {
  row: CatalogRow;
  onOpen: (sku: string) => void;
  /** Dense variant for the "comparable" lists on a product page. */
  compact?: boolean;
}

export function ProductRow({ row, onOpen, compact }: Props) {
  const { product, quote } = row;
  const saves = quote.listPrice > quote.unitPrice;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(product.sku)}
        className={cn(
          'flex w-full items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-2.5 text-left transition-colors hover:bg-surface-2',
          compact && 'p-2',
        )}
      >
        <Swatch url={product.imageUrl} size={compact ? 'sm' : 'md'} />

        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-[13.5px] leading-tight">
            {product.name}
          </span>
          <span className="mt-0.5 block truncate text-data text-[11px] text-text-subtle">
            {product.sku}
          </span>

          <span className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="font-semibold text-[13.5px] tabular-nums">
              {formatCents(quote.unitPrice)}
            </span>
            <span className="text-[11.5px] text-text-muted">{perUnit(product.baseUom)}</span>
            {saves ? (
              <span className="text-[11.5px] text-text-subtle line-through tabular-nums">
                {formatCents(quote.listPrice)}
              </span>
            ) : null}
          </span>

          {compact ? null : (
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Availability availability={row.availability} inStock={row.inStock} />
              {row.savedPercent > 0 ? (
                <Chip tone="success">{row.savedPercent}% off list</Chip>
              ) : null}
            </span>
          )}
        </span>

        <ChevronRight size={16} className="shrink-0 text-text-subtle" strokeWidth={2} aria-hidden />
      </button>
    </li>
  );
}

/**
 * Availability carries the words as well as the hue, because colour is never
 * allowed to be the only signal — and it states the consequence ("21 days
 * out") rather than a stock figure nobody can act on.
 */
export function Availability({
  availability,
  inStock,
}: { availability: string; inStock: boolean }) {
  return <Chip tone={inStock ? 'success' : 'warning'}>{availability}</Chip>;
}

export function Chip({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'info';
  children: React.ReactNode;
}) {
  const color = `var(--${tone})`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-[10.5px]"
      style={{ color, background: `color-mix(in oklch, ${color}, transparent 88%)` }}
    >
      {children}
    </span>
  );
}

/**
 * The catalogue has swatches, not photographs, and that is deliberate — a
 * measured colour-and-texture chip cannot be mistaken for a photo of the exact
 * pallet that arrives. `object-contain` on a light inset keeps the chip square
 * and honest rather than cropping it to fill.
 */
export function Swatch({
  url,
  size = 'md',
}: { url?: string | undefined; size?: 'sm' | 'md' | 'hero' }) {
  const box = size === 'sm' ? 'h-10 w-10' : size === 'hero' ? 'h-44 w-full lg:h-64' : 'h-14 w-14';
  if (!url) {
    return (
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md border border-border bg-surface-inset',
          box,
        )}
      >
        <Package size={16} className="text-text-subtle" strokeWidth={1.75} aria-hidden />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className={cn('shrink-0 rounded-md border border-border bg-surface-inset object-cover', box)}
    />
  );
}
