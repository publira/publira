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
import type { Locale } from "@publira/utils/i18n";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { CatalogSearchForm } from "#components/catalog-search-form";
import {
  LocaleSwitcher,
  LocaleSwitcherSkeleton,
} from "#components/locale-switcher";
import {
  NotificationBell,
  NotificationBellSkeleton,
} from "#components/notification-bell";
import { NotificationBellErrorBoundary } from "#components/notification-bell-error-boundary";
import { TenantBrandLogo } from "#components/tenant-brand-logo";
import { PUBLIC_SESSION_COOKIE_NAME } from "#lib/auth-shared";
import { getLocale } from "#lib/locale";
import { withLocalePrefix } from "#lib/locale-path";
import { logoutAction } from "#lib/logout-action";
import { countUnreadNotifications } from "#lib/notification";
import { listPublishedPageLinks } from "#lib/pages";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";
import { resolveTenantLogoVariant } from "#lib/tenant-logo";

/**
 * Bare hrefs, prefixed with the request's locale before they reach
 * `@publira/layouts` — that package is shared with the two consoles, which keep
 * their locale in a cookie, so it renders plain `next/link`s and cannot add the
 * prefix itself.
 */
const siteNavItems: LayoutLinkItem[] = [
  { href: "/authors", label: "Authors" },
  { href: "/labels", label: "Labels" },
  { href: "/series", label: "Series" },
  { href: "/search", label: "Search" },
];

const toLocaleLinkItems = (
  locale: Locale,
  items: readonly LayoutLinkItem[]
): LayoutLinkItem[] =>
  items.map((item) => ({
    ...item,
    href: withLocalePrefix(locale, item.href),
  }));

const HostNotificationBell = async () => {
  const tenantId = await getTenantId();
  const unread = await countUnreadNotifications(tenantId);

  return <NotificationBell unreadCount={unread.unreadCount} />;
};

const getHeaderActionsContent = async () => {
  const [cookieStore, tenantId, locale] = await Promise.all([
    cookies(),
    getTenantId(),
    getLocale(),
  ]);
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
          hasSession ? logoutAction.bind(null, tenantId, locale) : undefined
        }
        primaryAction={{
          ...actions.primaryAction,
          href: withLocalePrefix(locale, actions.primaryAction.href),
        }}
        secondaryAction={
          actions.secondaryAction && {
            ...actions.secondaryAction,
            href: withLocalePrefix(locale, actions.secondaryAction.href),
          }
        }
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

const getBrandMark = async (
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>
): Promise<ReactNode | undefined> => {
  const tenantInfo = await tenantInfoPromise;
  const variant = resolveTenantLogoVariant(tenantInfo);
  if (!variant) {
    return undefined;
  }

  const siteLabel = tenantInfo?.siteLabel?.trim() || "サイト";
  return (
    <TenantBrandLogo
      alt={`${siteLabel}のロゴ`}
      fallbackLabel={siteLabel}
      priority
      variant={variant}
    />
  );
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
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const links = await listPublishedPageLinks(tenantId);
  return toLocaleLinkItems(locale, links);
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

const TenantLayout = async ({
  children,
}: LayoutProps<"/[tenant_id]/[locale]">) => {
  const tenantInfoPromise = resolveTenantInfo();
  // A root parameter, so awaiting it here costs the shell nothing.
  const locale = await getLocale();

  return (
    <SiteLayout>
      <SiteLayoutHeader>
        <SiteLayoutBrand
          brandMark={getBrandMark(tenantInfoPromise)}
          href={withLocalePrefix(locale, "/")}
          label={getAppLabel(tenantInfoPromise)}
        />
        <SiteLayoutNav items={toLocaleLinkItems(locale, siteNavItems)} />
        <div className="flex max-w-40 min-w-0 flex-1 justify-end sm:max-w-64">
          <CatalogSearchForm id="catalog-search-header" />
        </div>
        <Suspense fallback={<LocaleSwitcherSkeleton />}>
          <LocaleSwitcher />
        </Suspense>
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
