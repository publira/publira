import {
  SiteLayout,
  SiteLayoutActions,
  SiteLayoutBrand,
  SiteLayoutFooter,
  SiteLayoutHeader,
  SiteLayoutHeaderActions,
  SiteLayoutMain,
  SiteLayoutNav,
  getAuthActions,
} from "@publira/layouts";
import type { LayoutLinkItem } from "@publira/layouts";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";

import {
  NotificationBell,
  NotificationBellSkeleton,
} from "#components/notification-bell";
import { NotificationBellErrorBoundary } from "#components/notification-bell-error-boundary";
import { PUBLIC_SESSION_COOKIE_NAME } from "#lib/auth-shared";
import { logoutAction } from "#lib/logout-action";
import { countUnreadNotifications } from "#lib/notification";
import { listPublishedPageLinks } from "#lib/pages";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

const siteNavItems: LayoutLinkItem[] = [
  { href: "/authors", label: "Authors" },
  { href: "/labels", label: "Labels" },
  { href: "/series", label: "Series" },
];

const HostNotificationBell = async () => {
  const tenantId = await getTenantId();
  const unread = await countUnreadNotifications(tenantId);

  return <NotificationBell unreadCount={unread.unreadCount} />;
};

const getHeaderActionsContent = async () => {
  const [cookieStore, tenantId] = await Promise.all([cookies(), getTenantId()]);
  const hasSession = Boolean(
    cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value
  );
  const actions = getAuthActions(hasSession);

  return (
    <div className="flex items-center gap-2">
      {hasSession ? (
        <NotificationBellErrorBoundary>
          <Suspense fallback={<NotificationBellSkeleton />}>
            <HostNotificationBell />
          </Suspense>
        </NotificationBellErrorBoundary>
      ) : null}
      <SiteLayoutActions
        logoutAction={
          hasSession ? logoutAction.bind(null, tenantId) : undefined
        }
        primaryAction={actions.primaryAction}
        secondaryAction={actions.secondaryAction}
      />
    </div>
  );
};

const buildSiteTitleBase = (siteLabel: string): string => siteLabel;

const resolveTenantInfo = async () => {
  const tenantId = await getTenantId();
  return getTenantSiteInfo(tenantId);
};

const getAppLabel = async (
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>
): Promise<string | undefined> => {
  const tenantInfo = await tenantInfoPromise;
  return tenantInfo?.siteLabel?.trim() || undefined;
};

const getCopyrightText = async (
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>
): Promise<string | undefined> => {
  const tenantInfo = await tenantInfoPromise;
  return tenantInfo?.copyrightText?.trim() || undefined;
};

const getFooterNote = async (
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>
): Promise<string | undefined> => {
  const tenantInfo = await tenantInfoPromise;
  return tenantInfo?.siteDescription?.trim() || undefined;
};

const getFooterPageLinks = async (): Promise<LayoutLinkItem[]> => {
  const tenantId = await getTenantId();
  const links = await listPublishedPageLinks(tenantId);
  return links.map((link) => ({
    href: link.href,
    label: link.label,
  }));
};

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const info = await getTenantSiteInfo(tenantId);
  const siteLabel = info?.siteLabel ?? "サイト";
  const siteDescription = info?.siteDescription?.trim() || undefined;
  const base = buildSiteTitleBase(siteLabel);

  return {
    description: siteDescription,
    openGraph: {
      description: siteDescription,
      title: base,
    },
    title: {
      default: base,
      template: `%s | ${base}`,
    },
  };
};

const TenantLayout = ({ children }: LayoutProps<"/[tenant_id]">) => {
  const tenantInfoPromise = resolveTenantInfo();

  return (
    <SiteLayout>
      <SiteLayoutHeader>
        <SiteLayoutBrand label={getAppLabel(tenantInfoPromise)} />
        <SiteLayoutNav items={siteNavItems} />
        <SiteLayoutHeaderActions content={getHeaderActionsContent()} />
      </SiteLayoutHeader>
      <SiteLayoutMain>{children}</SiteLayoutMain>
      <SiteLayoutFooter
        copyrightText={getCopyrightText(tenantInfoPromise)}
        footerNote={getFooterNote(tenantInfoPromise)}
        links={getFooterPageLinks()}
      />
    </SiteLayout>
  );
};

export default TenantLayout;
