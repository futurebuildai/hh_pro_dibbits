import { boot } from '@core/boot';
import { clearPersistedState } from '@core/stores/persistence';
import { sessionStore } from '@core/stores/root';
import { ActivitySheet } from '@ui/components/ActivitySheet';
import { DemoDirector } from '@ui/components/DemoDirector';
import { AssistantSheet } from '@ui/components/assistant/AssistantSheet';
import { useStore } from '@ui/hooks/useStore';
import { PortalLayout, type PortalTab } from '@ui/layouts/PortalLayout';
import { BoardPage } from '@ui/pages/BoardPage';
import { CatalogPage } from '@ui/pages/CatalogPage';
import { CustomerQuotePage } from '@ui/pages/CustomerQuotePage';
import { OrderPage } from '@ui/pages/OrderPage';
import { OrderTrackingPage } from '@ui/pages/OrderTrackingPage';
import { PayPage } from '@ui/pages/PayPage';
import { ProductPage } from '@ui/pages/ProductPage';
import { ProjectPage } from '@ui/pages/ProjectPage';
import { QuoteStudioPage } from '@ui/pages/QuoteStudioPage';
import { TeamPage } from '@ui/pages/TeamPage';
import { useEffect, useState } from 'react';
import {
  Navigate,
  Route,
  BrowserRouter as Router,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router';

/**
 * The browser's fetch, handed to core rather than reached for by it.
 *
 * `src/core` reads no ambient globals — that is what lets its tests run in
 * node and what will let a Lit build embed it — so the shell is where the
 * host's capabilities are injected. In sim mode nothing uses this.
 */
const hostFetch = (input: string, init?: RequestInit) => globalThis.fetch(input, init);

// Wire the core once, before first render. If a poisoned save makes boot
// itself throw, wipe and reseed rather than white-screening forever — the
// stored state that caused the crash would otherwise crash every reload too.
try {
  boot({ fetch: hostFetch });
} catch (error) {
  console.error('[app] boot failed — clearing saved state and reseeding', error);
  clearPersistedState();
  boot({ reset: true, fetch: hostFetch });
}

/**
 * Real routes rather than view state, because on a phone the hardware back
 * button has to work: opening an order and pressing back must return to the
 * board, not exit the app. It also gives M5's customer share link (/q/:token)
 * somewhere to live.
 */
export function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Shell />} />
        <Route path="/orders/:orderId" element={<Shell />} />
        <Route path="/orders/:orderId/quote" element={<Shell />} />
        <Route path="/orders/:orderId/tracking" element={<Shell />} />
        {/* Public: the homeowner's link. No portal chrome, no auth. */}
        <Route path="/q/:token" element={<PublicQuote />} />
        <Route path="/projects/:projectId" element={<Shell />} />
        <Route path="/catalog" element={<Shell />} />
        {/* A product is its own destination, so the phone's back button
            returns to the search that found it rather than leaving the app. */}
        <Route path="/catalog/:sku" element={<Shell />} />
        <Route path="/pay" element={<Shell />} />
        <Route path="/more" element={<Shell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

function Shell() {
  const navigate = useNavigate();
  const params = useParams();
  // The catalogue keeps its filters in the query string, so opening a product
  // and coming back does not silently reset what was typed.
  const [search, setSearch] = useSearchParams();
  const account = useStore(sessionStore, (state) => state.account);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  // Asked once at boot so the assistant can render an honest disabled state
  // instead of failing on first use. The assistant is usable if EITHER the
  // server holds a key or the contractor pasted their own, so the health
  // answer is kept separate and OR-ed with local state.
  const [serverHasKey, setServerHasKey] = useState<boolean | null>(null);
  // Subscribed, so a key added or removed from EITHER key sheet (the
  // assistant's or the More page's) re-gates the assistant immediately.

  useEffect(() => {
    // A hung dev server must not leave the assistant stuck on "checking"
    // forever — fall back to whatever key the browser already has.
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 5000);

    fetch('/api/anthropic/health', { signal: abort.signal })
      .then((response) => response.json())
      .then((body) => setServerHasKey(Boolean(body?.hasKey)))
      .catch(() => setServerHasKey(false))
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      abort.abort();
    };
  }, []);

  const hasKey =
    // The dealer owns the key now, so the server's answer IS the answer.
    serverHasKey === null ? null : serverHasKey === true;

  const path = window.location.pathname;
  const orderId = params.orderId;
  const projectId = params.projectId;
  const sku = params.sku;
  const isQuoteStudio = path.endsWith('/quote');
  const isTracking = path.endsWith('/tracking');

  const tab: PortalTab = path.startsWith('/catalog')
    ? 'catalog'
    : path.startsWith('/pay')
      ? 'pay'
      : path.startsWith('/more')
        ? 'more'
        : 'board';

  const heading = orderId
    ? { title: 'Order', subtitle: undefined }
    : projectId || sku
      ? { title: 'Product', subtitle: undefined }
      : tab === 'board'
        ? { title: 'Procurement Board', subtitle: account?.name }
        : {
            title: tab === 'catalog' ? 'Catalog' : tab === 'pay' ? 'Pay' : 'Team',
            subtitle: undefined,
          };

  return (
    <>
      <PortalLayout
        tab={tab}
        onTabChange={(next) => navigate(next === 'board' ? '/' : `/${next}`)}
        onOpenAssistant={() => setAssistantOpen(true)}
        onOpenActivity={() => setActivityOpen(true)}
        onOpenDemo={() => setDemoOpen(true)}
        title={heading.title}
        subtitle={heading.subtitle}
        hideChrome={Boolean(orderId || projectId || sku)}
      >
        {orderId && isQuoteStudio ? (
          <QuoteStudioPage orderId={orderId} onBack={() => navigate(`/orders/${orderId}`)} />
        ) : orderId && isTracking ? (
          <OrderTrackingPage orderId={orderId} onBack={() => navigate(`/orders/${orderId}`)} />
        ) : orderId ? (
          <OrderPage
            orderId={orderId}
            onBack={() => navigate('/')}
            onOpenProject={(id) => navigate(`/projects/${id}`)}
            onOpenQuote={() => navigate(`/orders/${orderId}/quote`)}
            onOpenTracking={() => navigate(`/orders/${orderId}/tracking`)}
          />
        ) : projectId ? (
          <ProjectPage
            projectId={projectId}
            onBack={() => navigate('/')}
            onOpenOrder={(id) => navigate(`/orders/${id}`)}
          />
        ) : sku ? (
          <ProductPage
            sku={sku}
            onBack={() => navigate({ pathname: '/catalog', search: search.toString() })}
            onOpenProduct={(next) =>
              navigate({ pathname: `/catalog/${next}`, search: search.toString() })
            }
            onOpenPlan={(id) => navigate(`/orders/${id}`)}
          />
        ) : tab === 'board' ? (
          <BoardPage onOpenOrder={(id) => navigate(`/orders/${id}`)} />
        ) : tab === 'catalog' ? (
          <CatalogPage
            search={search}
            onSearchChange={(next) => setSearch(next, { replace: true })}
            onOpenProduct={(next) =>
              navigate({ pathname: `/catalog/${next}`, search: search.toString() })
            }
          />
        ) : tab === 'pay' ? (
          <PayPage onOpenOrder={(id) => navigate(`/orders/${id}`)} />
        ) : (
          <TeamPage />
        )}
      </PortalLayout>

      <ActivitySheet open={activityOpen} onOpenChange={setActivityOpen} />
      <DemoDirector open={demoOpen} onOpenChange={setDemoOpen} />

      <AssistantSheet
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        hasKey={hasKey}
      />
    </>
  );
}

function PublicQuote() {
  const params = useParams();
  return <CustomerQuotePage token={params.token ?? ''} />;
}
