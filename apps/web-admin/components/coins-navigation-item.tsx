import { WalletIcon } from "@publira/icons";
import * as ConsoleSidebar from "@publira/layouts/admin/console-sidebar";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { getCoinSettings } from "#lib/coins";
import { getLocale } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { Message } from "./message";

/**
 * The entry for the coin settings, shown only while the platform lets tenants
 * issue coins: until it does, nothing on that screen could take effect.
 */
export const CoinsNavigationItem = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  let allowed = false;

  try {
    const result = await getCoinSettings(tenantId, locale);
    allowed = result.ok && result.platformAllowsCoins;
  } catch {
    // Navigation chrome: a failed read leaves the entry out rather than the
    // sidebar, and the screen itself reports the failure when it is opened.
  }

  return allowed ? (
    <ConsoleSidebar.NavigationItem href="/coins">
      <ConsoleSidebar.NavigationItemIcon>
        <WalletIcon className="size-4" />
      </ConsoleSidebar.NavigationItemIcon>
      <ConsoleSidebar.NavigationItemHeading>
        <ConsoleSidebar.NavigationItemLabel>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.nav.coins_label" />
          </Suspense>
        </ConsoleSidebar.NavigationItemLabel>
      </ConsoleSidebar.NavigationItemHeading>
    </ConsoleSidebar.NavigationItem>
  ) : null;
};
