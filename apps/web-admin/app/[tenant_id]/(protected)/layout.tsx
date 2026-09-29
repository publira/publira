import { AdminLayout } from "#components/admin-layout";
import { AdminLocaleProvider } from "#components/admin-locale-provider";
import { AdminToastProvider } from "#components/admin-toast-provider";

/**
 * Awaits nothing: this layout wraps every console route, so a read here would
 * hold back each route's static shell. The chrome waits on the tenant, the
 * logo, and the session in its own parts, and the provider hands its reads
 * down unresolved.
 */
const ProtectedLayout = ({ children }: LayoutProps<"/[tenant_id]">) => (
  <AdminLocaleProvider>
    <AdminLayout>
      <AdminToastProvider>{children}</AdminToastProvider>
    </AdminLayout>
  </AdminLocaleProvider>
);

export default ProtectedLayout;
