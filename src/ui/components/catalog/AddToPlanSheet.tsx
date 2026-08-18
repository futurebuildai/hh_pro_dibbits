import { type AddToPlanResult, addProductToPlan } from '@core/actions/catalog';
import type { Product } from '@core/domain/catalog';
import { formatQty } from '@core/domain/units';
import { formatCents } from '@core/lib/money';
import { buildPlanTargets } from '@core/selectors/catalog';
import { ordersStore, projectsStore, scopeStore } from '@core/stores/root';
import { listOf } from '@core/stores/store';
import { Button } from '@ui/components/ui/Button';
import { Sheet } from '@ui/components/ui/Sheet';
import { useStore } from '@ui/hooks/useStore';
import { ClipboardList, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

/**
 * Where does this go?
 *
 * The question a cart never asks. Every plan on this list already has a job, a
 * delivery date and a site, so answering it is what turns "I looked at a
 * paver" into procurement rather than a wishlist. Plans the supplier already
 * holds are not offered at all — the scope is locked once the dealer is
 * pricing or picking it, and showing a destination that will refuse on tap
 * teaches nothing.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  qty: number;
  unitPrice: number;
  onAdded: (result: AddToPlanResult) => void;
  onError: (message: string) => void;
}

export function AddToPlanSheet({
  open,
  onOpenChange,
  product,
  qty,
  unitPrice,
  onAdded,
  onError,
}: Props) {
  const orders = useStore(ordersStore, (state) => state);
  const projects = useStore(projectsStore, (state) => state);
  const scope = useStore(scopeStore, (state) => state);

  const [creating, setCreating] = useState(false);
  const [planName, setPlanName] = useState('');
  const [projectId, setProjectId] = useState('');

  const targets = useMemo(
    () => buildPlanTargets(orders, projects, scope, product.id),
    [orders, projects, scope, product.id],
  );
  const projectList = useMemo(
    () => listOf(projects).filter((project) => !project.archivedAt),
    [projects],
  );

  function commit(result: ReturnType<typeof addProductToPlan>) {
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onOpenChange(false);
    setCreating(false);
    setPlanName('');
    onAdded(result.value);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add to a plan"
      description={`${formatQty(qty, product.baseUom)} of ${product.name} · ${formatCents(
        Math.round(unitPrice * qty),
      )}`}
    >
      {creating ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            commit(
              addProductToPlan({
                product: product.id,
                qty,
                destination: {
                  kind: 'new',
                  projectId: projectId || (projectList[0]?.id ?? ''),
                  ...(planName.trim() ? { name: planName.trim() } : {}),
                },
              }),
            );
          }}
        >
          <label className="block">
            <span className="mb-1 block font-medium text-[12px]">Which job?</span>
            <select
              value={projectId || (projectList[0]?.id ?? '')}
              onChange={(event) => setProjectId(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
            >
              {projectList.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block font-medium text-[12px]">Call this plan</span>
            <input
              value={planName}
              onChange={(event) => setPlanName(event.target.value)}
              placeholder="Paver field & coping"
              className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
            />
            <span className="mt-1 block text-[11.5px] text-text-subtle">
              It starts in Plan, on the board, with your delivery date still to set.
            </span>
          </label>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              Back
            </Button>
            <Button type="submit" className="flex-1" disabled={projectList.length === 0}>
              Start this plan
            </Button>
          </div>
        </form>
      ) : (
        <>
          <ul className="space-y-2">
            {targets.map((target) => (
              <li key={target.order.id}>
                <button
                  type="button"
                  onClick={() =>
                    commit(
                      addProductToPlan({
                        product: product.id,
                        qty,
                        destination: { kind: 'existing', orderId: target.order.id },
                      }),
                    )
                  }
                  className="flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-surface-2"
                >
                  <ClipboardList size={17} className="mt-0.5 shrink-0 text-brand" strokeWidth={2} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-[13.5px]">
                      {target.order.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-text-muted">
                      {target.project.name} · {target.itemCount} item
                      {target.itemCount === 1 ? '' : 's'}
                    </span>
                    {/* Adding a SKU twice bumps the quantity rather than
                        duplicating the line, so say that before the tap
                        instead of surprising them with a bigger number. */}
                    {target.alreadyHas ? (
                      <span className="mt-1 block text-[11.5px] text-text-subtle">
                        Already on this plan — this adds to that line
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
            {targets.length === 0 ? (
              <li className="rounded-lg bg-surface-inset p-3 text-[12.5px] text-text-muted">
                You have no plans open. Start one and this goes straight on it.
              </li>
            ) : null}
          </ul>

          <Button
            variant="outline"
            full
            className="mt-3"
            onClick={() => setCreating(true)}
            disabled={projectList.length === 0}
          >
            <Plus size={16} strokeWidth={2.5} />
            Start a new plan
          </Button>
          {projectList.length === 0 ? (
            <p className="mt-2 text-[12px] text-text-muted">
              There are no jobs to plan against yet.
            </p>
          ) : null}
        </>
      )}
    </Sheet>
  );
}
