import { getMessage } from "@publira/i18n";
import {
  SiteLayout,
  SiteLayoutActions,
  SiteLayoutBrand,
  SiteLayoutBrandSkeleton,
  SiteLayoutFooter,
  SiteLayoutFooterContent,
  SiteLayoutFooterCopyright,
  SiteLayoutFooterLink,
  SiteLayoutFooterLinks,
  SiteLayoutFooterNote,
  SiteLayoutHeader,
  SiteLayoutHeaderActions,
  SiteLayoutHeaderActionsSkeleton,
  SiteLayoutMain,
  SiteLayoutNav,
  SiteLayoutNavLink,
  SiteLayoutLogoutAction,
  SiteLayoutPrimaryAction,
  SiteLayoutSecondaryAction,
} from "@publira/layouts";
import { Skeleton } from "@publira/ui-components/skeleton";
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
import type { HostMessageKey } from "#lib/locale";
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

const HostNotificationBell = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [unread, messages] = await Promise.all([
    countUnreadNotifications(tenantId, locale),
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

const HeaderActions = async () => {
  const [cookieStore, tenantId, locale] = await Promise.all([
    cookies(),
    getTenantId(),
    getLocale(),
  ]);
  const messages = await loadHostMessages(locale);
  const hasSession = Boolean(
    cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value
  );
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
      <SiteLayoutActions>
        {hasSession ? (
          <SiteLayoutLogoutAction
            action={logoutAction.bind(null, tenantId, locale)}
          >
            {getMessage(messages, "host.nav.logout")}
          </SiteLayoutLogoutAction>
        ) : (
          <SiteLayoutSecondaryAction href={withLocalePrefix(locale, "/login")}>
            {getMessage(messages, "host.nav.login")}
          </SiteLayoutSecondaryAction>
        )}
        <SiteLayoutPrimaryAction
          href={withLocalePrefix(locale, hasSession ? "/my" : "/signup")}
        >
          {getMessage(
            messages,
            hasSession ? "host.nav.my_page" : "host.nav.signup"
          )}
        </SiteLayoutPrimaryAction>
      </SiteLayoutActions>
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

const TenantFooterLinks = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [links, messages] = await Promise.all([
    listPublishedPageLinks(tenantId),
    loadHostMessages(locale),
  ]);

  if (links.length === 0) {
    return null;
  }

  return (
    <SiteLayoutFooterLinks
      ariaLabel={getMessage(messages, "host.nav.footer_links")}
    >
      {links.map((link) => (
        <SiteLayoutFooterLink
          href={withLocalePrefix(locale, link.href)}
          key={link.href}
        >
          {link.label}
        </SiteLayoutFooterLink>
      ))}
    </SiteLayoutFooterLinks>
  );
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

  return (
    <SiteLayoutNav>
      {siteNavItems.map((item) => (
        <SiteLayoutNavLink
          href={withLocalePrefix(locale, item.href)}
          key={item.href}
        >
          {getMessage(messages, item.label)}
        </SiteLayoutNavLink>
      ))}
    </SiteLayoutNav>
  );
};

const TenantBrand = async ({
  tenantInfoPromise,
}: {
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>;
}) => {
  const [brandMark, appLabel] = await Promise.all([
    getBrandMark(tenantInfoPromise),
    getAppLabel(tenantInfoPromise),
  ]);

  return brandMark ?? appLabel;
};

const TenantFooterNote = async ({
  tenantInfoPromise,
}: {
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>;
}) => {
  const footerNote = await getFooterNote(tenantInfoPromise);

  return footerNote ? (
    <SiteLayoutFooterNote>{footerNote}</SiteLayoutFooterNote>
  ) : null;
};

const TenantFooterCopyright = async ({
  tenantInfoPromise,
}: {
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>;
}) => {
  const copyrightText = await getCopyrightText(tenantInfoPromise);

  return copyrightText ? (
    <SiteLayoutFooterCopyright>{copyrightText}</SiteLayoutFooterCopyright>
  ) : null;
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
        <SiteLayoutBrand href={withLocalePrefix(locale, "/")}>
          <Suspense fallback={<SiteLayoutBrandSkeleton />}>
            <TenantBrand tenantInfoPromise={tenantInfoPromise} />
          </Suspense>
        </SiteLayoutBrand>
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
        <SiteLayoutHeaderActions>
          <Suspense fallback={<SiteLayoutHeaderActionsSkeleton />}>
            <HeaderActions />
          </Suspense>
        </SiteLayoutHeaderActions>
      </SiteLayoutHeader>
      <SiteLayoutMain>{children}</SiteLayoutMain>
      <SiteLayoutFooter>
        <Suspense fallback={null}>
          <TenantFooterLinks />
        </Suspense>
        <SiteLayoutFooterContent>
          <Suspense
            fallback={
              <SiteLayoutFooterNote>
                <Skeleton className="inline-block h-4 w-56 rounded" />
              </SiteLayoutFooterNote>
            }
          >
            <TenantFooterNote tenantInfoPromise={tenantInfoPromise} />
          </Suspense>
          <Suspense
            fallback={
              <SiteLayoutFooterCopyright>
                <Skeleton className="inline-block h-4 w-48 rounded" />
              </SiteLayoutFooterCopyright>
            }
          >
            <TenantFooterCopyright tenantInfoPromise={tenantInfoPromise} />
          </Suspense>
        </SiteLayoutFooterContent>
      </SiteLayoutFooter>
    </SiteLayout>
  );
};

export default TenantLayout;
