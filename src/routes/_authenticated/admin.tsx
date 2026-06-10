import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link to="/admin" className="font-semibold tracking-tight">
              Swedish AI Librarian — Admin
            </Link>
            <nav className="flex gap-4 text-sm text-muted-foreground">
              <Link to="/admin" className="hover:text-foreground" activeProps={{ className: "text-foreground" }}>Sources</Link>
              <Link to="/admin/documents" className="hover:text-foreground" activeProps={{ className: "text-foreground" }}>Documents</Link>
              <Link to="/admin/runs" className="hover:text-foreground" activeProps={{ className: "text-foreground" }}>Runs</Link>
            </nav>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/auth" });
            }}
          >
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
