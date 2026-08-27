import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  getAuthActions,
  SiteLayout,
  SiteLayoutActions,
  SiteLayoutBrand,
  SiteLayoutFooter,
  SiteLayoutHeader,
  SiteLayoutHeaderActions,
  SiteLayoutMain,
  SiteLayoutNav,
} from "@publira/layouts";
import type { LayoutLinkItem } from "@publira/layouts";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import type { ReactNode } from "react";

import {
  CatalogSearchForm,
  CatalogSearchFormSkeleton,
} from "#components/catalog-search-form";
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
import { getLocale, loadHostMessages } from "#lib/locale";
import type { HostMessageKey, HostMessages } from "#lib/locale";
import { withLocalePrefix } from "#lib/locale-path";
import { logoutAction } from "#lib/logout-action";
import { countUnreadNotifications } from "#lib/notification";
import { listPublishedPageLinks } from "#lib/pages";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";
import { resolveTenantLogoVariant } from "#lib/tenant-logo";

/**
 * Bare hrefs, prefixed with the request's locale before they reach
 * `@publira/layouts` — that package is shared with the two consoles, which keep
 * their locale in a cookie, so it renders plain `next/link`s and cannot add the
 * prefix itself. The labels are resolved here for the same reason.
 */
const siteNavItems: { href: string; label: HostMessageKey }[] = [
  { href: "/authors", label: "host.nav.authors" },
  { href: "/labels", label: "host.nav.labels" },
  { href: "/series", label: "host.nav.series" },
  { href: "/search", label: "host.nav.search" },
];

const toNavLinkItems = (
  locale: Locale,
  messages: HostMessages
): LayoutLinkItem[] =>
  siteNavItems.map((item) => ({
    href: withLocalePrefix(locale, item.href),
    label: getMessage(messages, item.label),
  }));

const toLocaleLinkItems = (
  locale: Locale,
  items: readonly LayoutLinkItem[]
): LayoutLinkItem[] =>
  items.map((item) => ({
    ...item,
    href: withLocalePrefix(locale, item.href),
  }));

const HostNotificationBell = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [unread, messages] = await Promise.all([
    countUnreadNotifications(tenantId),
    loadHostMessages(locale),
  ]);

  return (
    <NotificationBell
      label={
        unread.unreadCount > 0
          ? getMessage(messages, "host.nav.notifications_unread", {
              count: unread.unreadCount,
            })
          : getMessage(messages, "host.nav.notifications_none")
      }
      unreadCount={unread.unreadCount}
    />
  );
};

const getHeaderActionsContent = async () => {
  const [cookieStore, tenantId, locale] = await Promise.all([
    cookies(),
    getTenantId(),
    getLocale(),
  ]);
  const messages = await loadHostMessages(locale);
  const hasSession = Boolean(
    cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value
  );
  const actions = getAuthActions(hasSession, {
    login: getMessage(messages, "host.nav.login"),
    myPage: getMessage(messages, "host.nav.my_page"),
    signup: getMessage(messages, "host.nav.signup"),
  });

  return (
    <div className="flex items-center gap-2">
      {hasSession ? (
        <NotificationBellErrorBoundary
          label={getMessage(messages, "host.nav.notifications_none")}
        >
          <Suspense fallback={<NotificationBellSkeleton />}>
            <HostNotificationBell />
          </Suspense>
        </NotificationBellErrorBoundary>
      ) : null}
      <SiteLayoutActions
        logoutAction={
          hasSession ? logoutAction.bind(null, tenantId, locale) : undefined
        }
        logoutLabel={getMessage(messages, "host.nav.logout")}
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

const resolveTenantInfo = async () => {
  const tenantId = await getTenantId();
  return getTenantSiteInfo(tenantId);
};

const getAppLabel = async (
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>
): Promise<string | undefined> => {
  const tenantInfo = await tenantInfoPromise;
  return tenantInfo?.name.trim() || undefined;
};

const getBrandMark = async (
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>
): Promise<ReactNode | undefined> => {
  const [tenantInfo, tenantId, locale] = await Promise.all([
    tenantInfoPromise,
    getTenantId(),
    getLocale(),
  ]);
  const variant = resolveTenantLogoVariant(tenantInfo);
  if (!variant) {
    return undefined;
  }

  const [siteLabel, messages] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);

  return (
    <TenantBrandLogo
      alt={getMessage(messages, "host.nav.logo_alt", { name: siteLabel })}
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

const getFooterLinksLabel = async (): Promise<string> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);
  return getMessage(messages, "host.nav.footer_links");
};

export const generateMetadata = async (): Promise<Metadata> => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [info, siteLabel] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteLabel(tenantId, locale),
  ]);
  const siteDescription = info?.siteDescription?.trim() || undefined;

  return {
    description: siteDescription,
    openGraph: {
      description: siteDescription,
      title: siteLabel,
    },
    title: {
      default: siteLabel,
      template: `%s | ${siteLabel}`,
    },
  };
};

const SiteNav = async () => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return <SiteLayoutNav items={toNavLinkItems(locale, messages)} />;
};

/** Same footprint as the rendered nav, so the header does not shift. */
const SiteNavSkeleton = () => (
  <div
    aria-hidden="true"
    className="hidden h-5 w-64 animate-pulse rounded bg-muted md:block"
  />
);

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
        <Suspense fallback={<SiteNavSkeleton />}>
          <SiteNav />
        </Suspense>
        <div className="flex max-w-40 min-w-0 flex-1 justify-end sm:max-w-64">
          <Suspense fallback={<CatalogSearchFormSkeleton />}>
            <CatalogSearchForm id="catalog-search-header" />
          </Suspense>
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
        linksLabel={getFooterLinksLabel()}
      />
    </SiteLayout>
  );
};

export default TenantLayout;
