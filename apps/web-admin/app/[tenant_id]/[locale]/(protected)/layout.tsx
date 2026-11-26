import { AdminLayout } from "#components/admin-layout";
import { AdminToastProvider } from "#components/admin-toast-provider";
import * as Reauthentication from "#components/reauthentication";

/**
 * Awaits nothing: this layout wraps every signed-in route, so a read here
 * would hold back each route's static shell. The chrome waits on the tenant,
 * the logo, and the session in its own parts.
 */
const ProtectedLayout = ({
  children,
}: LayoutProps<"/[tenant_id]/[locale]">) => (
  <AdminLayout>
    <AdminToastProvider>
      <Reauthentication.Root>{children}</Reauthentication.Root>
    </AdminToastProvider>
  </AdminLayout>
);

export default ProtectedLayout;
