import type { AddToPlanResult } from '@core/actions/catalog';
import { supplierName } from '@core/config/runtime';
import { formatQty, perUnit, qtyStep, soldBy, unitShort } from '@core/domain/units';
import { formatCents } from '@core/lib/money';
import { buildProductDetail } from '@core/selectors/catalog';
import { accountQuoteFor } from '@core/selectors/pricing';
import { catalogStore } from '@core/stores/root';
import { AddToPlanSheet } from '@ui/components/catalog/AddToPlanSheet';
import { Availability, Chip, ProductRow, Swatch } from '@ui/components/catalog/ProductRow';
import { Button } from '@ui/components/ui/Button';
import { useStore } from '@ui/hooks/useStore';
import { ChevronLeft, Minus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

/**
 * One product, at the quantity you are actually thinking about.
 *
 * The quantity control is the point of the page, not a form field. Hardscape
 * pricing is quantity-dependent — a 600 sq ft patio crosses a volume break
 * that 40 sq ft does not — so the price has to answer back as the number
 * changes, and the next break has to be stated in words rather than left for
 * the contractor to discover after they have already ordered.
 *
 * The only action is "add to a plan". Not a cart: a plan is an order that
 * already belongs to a job, with a date and a site, and it is already on the
 * board where they look.
 */

interface Props {
  sku: string;
  /** Returns to the browse state the product was opened from — the search and
   *  the category ride in the URL, so back is where they left off. */
  onBack: () => void;
  onOpenProduct: (sku: string) => void;
  onOpenPlan: (orderId: string) => void;
}

export function ProductPage({ sku, onBack, onOpenProduct, onOpenPlan }: Props) {
  const { products, categories, brands } = useStore(catalogStore, (state) => state);
  /**
   * The typed quantity, kept PER UNIT rather than per product.
   *
   * Stepping through interchangeable pavers should compare them at the same
   * 480 sq ft — that is the whole point of looking at alternates. Carrying
   * that number onto a product sold by the tonne would price four hundred and
   * eighty tonnes of armour stone, so the unit is what the value belongs to.
   */
  const [qtyByUnit, setQtyByUnit] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; orderId?: string } | null>(null);

  const product = products.find((candidate) => candidate.sku === sku);
  const unit = product?.baseUom ?? 'EA';
  const step = qtyStep(unit);
  // The raw text is what the field shows; the price uses the last usable
  // number. Coercing the text itself meant backspacing to clear the field
  // snapped it back to "10" mid-edit, and the next keystroke made it 10640.
  const typed = qtyByUnit[unit];
  const qty = Math.max(1, Number(typed ?? step) || step);
  const setQtyText = (value: string) => setQtyByUnit((current) => ({ ...current, [unit]: value }));

  const detail = useMemo(
    () =>
      buildProductDetail({
        products,
        categories,
        brands,
        productRef: sku,
        qty,
        quoteFor: accountQuoteFor,
      }),
    [products, categories, brands, sku, qty],
  );

  if (!detail) {
    return (
      <div className="p-8 text-center text-sm text-text-subtle">
        That product is no longer in the catalog.{' '}
        <button type="button" onClick={onBack} className="text-brand underline">
          Back to the catalog
        </button>
      </div>
    );
  }

  const { quote } = detail;
  const uom = detail.product.baseUom;
  const saves = quote.listPrice > quote.unitPrice;

  function added(result: AddToPlanResult) {
    setToast({
      message: result.createdOrder
        ? `Started “${result.orderName}” with ${formatQty(qty, uom)}`
        : result.merged
          ? `${result.orderName} now has ${formatQty(result.item.qty, uom)}`
          : `Added ${formatQty(qty, uom)} to ${result.orderName}`,
      orderId: result.orderId,
    });
    setTimeout(() => setToast(null), 8000);
  }

  return (
    <>
      <header className="border-b border-border bg-surface px-4 py-3 lg:px-6">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 mb-1.5 inline-flex min-h-9 items-center gap-1 text-[12.5px] text-text-muted hover:text-text"
        >
          <ChevronLeft size={15} strokeWidth={2.5} />
          Catalog
        </button>

        <p className="truncate text-[11.5px] text-text-subtle">
          {detail.breadcrumb.map((category) => category.name).join(' › ')}
        </p>
        <h2 className="mt-0.5 text-[19px] font-semibold leading-tight tracking-tight">
          {detail.product.name}
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-data text-[11.5px] text-text-subtle">{detail.product.sku}</span>
          {detail.brand ? (
            <span className="text-[12px] text-text-muted">{detail.brand.name}</span>
          ) : null}
        </p>
      </header>

      {/* pb-40: the add-to-plan bar is fixed, and without room for it the
          volume-break line — the last thing on the page and the one worth
          reading — sat underneath it. */}
      <div className="px-4 pt-4 pb-40 lg:px-6 lg:grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-8">
        <div>
          <Swatch url={detail.product.imageUrl} size="hero" />
          {/* The guide says it and so should the screen: this is a measured
              colour-and-texture swatch, not a photograph of the pallet that
              will arrive. */}
          <p className="mt-2 text-[11.5px] text-text-subtle">
            Colour swatch, not a photograph — finish varies pallet to pallet.
          </p>
        </div>

        <div className="mt-5 lg:mt-0">
          <p className="text-[13.5px] leading-relaxed text-text-muted">
            {detail.product.description}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <Availability availability={detail.availability} inStock={detail.inStock} />
            {detail.savedPercent > 0 ? (
              <Chip tone="success">{detail.savedPercent}% below list</Chip>
            ) : null}
          </div>
          {/* How it is sold is a caption, not a signal. It spent a version as
              an info-tinted chip, which measured 4.42:1 and — worse — spent a
              state colour on a sentence that reports no state. Chips here mean
              stock and savings; prose is prose. */}
          <p className="mt-2 text-[12px] text-text-muted">{soldBy(uom)}</p>

          {/* ---- Price, at this quantity ---- */}
          <section className="mt-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <h3 className="sr-only">Your price</h3>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[26px] font-semibold tabular-nums">
                {formatCents(quote.unitPrice)}
              </span>
              <span className="text-[14px] text-text-muted">{perUnit(uom)}</span>
              {saves ? (
                <span className="text-[13px] text-text-subtle line-through tabular-nums">
                  {formatCents(quote.listPrice)}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-[12px] text-text-muted">
              Your account price at {supplierName()}
            </p>

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
              <span className="text-[13px] text-text-muted">How much?</span>
              <QtyControl
                text={typed ?? String(step)}
                qty={qty}
                step={step}
                unit={unitShort(uom)}
                onChange={(next) => setQtyText(String(Math.max(1, next)))}
                onText={setQtyText}
              />
            </div>

            <p className="mt-3 flex items-baseline justify-between">
              <span className="text-[13px] text-text-muted">{formatQty(qty, uom)}</span>
              <span className="text-[17px] font-semibold tabular-nums">
                {formatCents(detail.extended)}
              </span>
            </p>

            {/* The one piece of pricing mechanics this product exposes, said as
                a sentence rather than as an arithmetic puzzle. */}
            {quote.nextBreak ? (
              <p className="mt-3 rounded-lg bg-surface-inset p-3 text-[12.5px] leading-relaxed">
                Order <strong>{formatQty(quote.nextBreak.minQty, uom)}</strong> or more and your
                price drops to <strong>{formatCents(quote.nextBreak.unitPrice)}</strong>
                {perUnit(uom)}.
              </p>
            ) : null}
          </section>

          {detail.product.specs.length > 0 ? (
            <dl className="mt-4 space-y-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-[13px]">
              {detail.product.specs.map((spec) => (
                <div key={spec.label} className="flex justify-between gap-4">
                  <dt className="text-text-muted">{spec.label}</dt>
                  <dd className="text-right">{spec.value}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Availability</dt>
                <dd className="text-right">{detail.availability}</dd>
              </div>
            </dl>
          ) : null}

          {detail.alternates.length > 0 ? (
            <section className="mt-5">
              <h3 className="mb-2 font-semibold text-[13.5px]">Interchangeable with this</h3>
              {/* Same spec class only. A 60mm patio paver is not an alternate
                  for an 80mm vehicular one — that swap cracks under a car. */}
              <ul className="space-y-1.5">
                {detail.alternates.map((row) => (
                  <ProductRow key={row.product.id} row={row} onOpen={onOpenProduct} compact />
                ))}
              </ul>
            </section>
          ) : null}

          {detail.related.length > 0 ? (
            <section className="mt-5">
              <h3 className="mb-2 font-semibold text-[13.5px]">Goes with it</h3>
              <ul className="space-y-1.5">
                {detail.related.map((row) => (
                  <ProductRow key={row.product.id} row={row} onOpen={onOpenProduct} compact />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      {/* The single action, always reachable, above the tab bar. */}
      <div className="fixed inset-x-0 bottom-16 z-20 border-border border-t bg-surface/95 p-3 backdrop-blur lg:bottom-0 lg:left-60">
        <Button full size="lg" onClick={() => setAddOpen(true)}>
          <Plus size={17} strokeWidth={2.5} />
          Add {formatQty(qty, uom)} to a plan
        </Button>
      </div>

      <AddToPlanSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        product={detail.product}
        qty={qty}
        unitPrice={quote.unitPrice}
        onAdded={added}
        onError={(message) => {
          setToast({ message });
          setTimeout(() => setToast(null), 6000);
        }}
      />

      {toast ? (
        <output className="fixed inset-x-4 bottom-32 z-[60] flex items-center gap-3 rounded-lg bg-text px-4 py-3 text-sm text-surface shadow-[var(--shadow-lifted)] lg:inset-x-auto lg:right-6 lg:bottom-24 lg:max-w-sm">
          <span className="min-w-0 flex-1">{toast.message}</span>
          {/* Landing a line somewhere the contractor cannot see is how a cart
              behaves. The plan is one tap away, with the board behind it. */}
          {toast.orderId ? (
            <button
              type="button"
              onClick={() => onOpenPlan(toast.orderId as string)}
              className="-my-2 shrink-0 rounded-md px-2 py-2 font-semibold text-[13px] underline"
            >
              Open plan
            </button>
          ) : null}
        </output>
      ) : null}
    </>
  );
}

function QtyControl({
  text,
  qty,
  step,
  unit,
  onChange,
  onText,
}: {
  /** What the field shows — may be mid-edit, and may be empty. */
  text: string;
  qty: number;
  step: number;
  unit: string;
  onChange: (qty: number) => void;
  onText: (value: string) => void;
}) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex items-center rounded-lg border border-border">
        <button
          type="button"
          aria-label={`Decrease quantity by ${step}`}
          onClick={() => onChange(qty - step)}
          className="flex h-11 w-11 items-center justify-center text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
        >
          <Minus size={15} strokeWidth={2.5} />
        </button>
        <label>
          <span className="sr-only">Quantity in {unit}</span>
          <input
            value={text}
            inputMode="numeric"
            onChange={(event) => onText(event.target.value.replace(/[^\d]/g, ''))}
            className="h-11 w-16 bg-transparent text-center font-medium text-[15px] tabular-nums outline-none"
          />
        </label>
        <button
          type="button"
          aria-label={`Increase quantity by ${step}`}
          onClick={() => onChange(qty + step)}
          className="flex h-11 w-11 items-center justify-center text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
        >
          <Plus size={15} strokeWidth={2.5} />
        </button>
      </span>
      <span className="text-[12.5px] text-text-muted">{unit}</span>
    </span>
  );
}
