import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGate } from "@/components/auth-gate";
import SignInPage from "@/pages/sign-in";
import AdminHomePage from "@/pages/admin-home";
import AdminSuppliersListPage from "@/pages/admin-suppliers-list";
import AdminSupplierNewPage from "@/pages/admin-supplier-new";
import AdminSupplierDetailPage from "@/pages/admin-supplier-detail";
import AdminClientsListPage from "@/pages/admin-clients-list";
import AdminClientNewPage from "@/pages/admin-client-new";
import AdminClientDetailPage from "@/pages/admin-client-detail";
import AdminGigsListPage from "@/pages/admin-gigs-list";
import AdminGigNewPage from "@/pages/admin-gig-new";
import AdminGigDetailPage from "@/pages/admin-gig-detail";
import AdminInvoicesListPage from "@/pages/admin-invoices-list";
import AdminInvoiceDetailPage from "@/pages/admin-invoice-detail";
import AdminAuditLogPage from "@/pages/admin-audit-log";
import OnboardingCompletePage from "@/pages/onboarding-complete";
import OnboardingExpiredPage from "@/pages/onboarding-expired";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function HomeRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/admin");
  }, [setLocation]);
  return null;
}

function gated(node: React.ReactNode) {
  return <AuthGate requireRole="admin">{node}</AuthGate>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in" component={SignInPage} />

      {/* Public supplier-facing landing pages from Stripe Connect onboarding.
          Un-gated by design — suppliers have no Club Kudo login. */}
      <Route path="/onboarding/complete" component={OnboardingCompletePage} />
      <Route path="/onboarding/expired" component={OnboardingExpiredPage} />

      <Route path="/admin">{gated(<AdminHomePage />)}</Route>

      <Route path="/admin/suppliers">{gated(<AdminSuppliersListPage />)}</Route>
      <Route path="/admin/suppliers/new">{gated(<AdminSupplierNewPage />)}</Route>
      <Route path="/admin/suppliers/:id">{gated(<AdminSupplierDetailPage />)}</Route>

      <Route path="/admin/clients">{gated(<AdminClientsListPage />)}</Route>
      <Route path="/admin/clients/new">{gated(<AdminClientNewPage />)}</Route>
      <Route path="/admin/clients/:id">{gated(<AdminClientDetailPage />)}</Route>

      <Route path="/admin/gigs">{gated(<AdminGigsListPage />)}</Route>
      <Route path="/admin/gigs/new">{gated(<AdminGigNewPage />)}</Route>
      <Route path="/admin/gigs/:id">{gated(<AdminGigDetailPage />)}</Route>

      <Route path="/admin/invoices">{gated(<AdminInvoicesListPage />)}</Route>
      <Route path="/admin/invoices/:id">{gated(<AdminInvoiceDetailPage />)}</Route>

      <Route path="/admin/audit-log">{gated(<AdminAuditLogPage />)}</Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
