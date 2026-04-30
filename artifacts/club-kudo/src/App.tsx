import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGate } from "@/components/auth-gate";
import SignInPage from "@/pages/sign-in";
import AdminHomePage from "@/pages/admin-home";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Auth-related queries get re-fetched aggressively; the rest
      // can be cached. Per-query overrides via useQuery's options.
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

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/admin">
        <AuthGate requireRole="admin">
          <AdminHomePage />
        </AuthGate>
      </Route>
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
