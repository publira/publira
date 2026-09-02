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
  SiteLayoutPrimaryAction,
  SiteLayoutSecondaryAction,
  SiteLayoutUserMenu,
  SiteLayoutUserMenuContent,
  SiteLayoutUserMenuLogout,
  SiteLayoutUserMenuMyPageLink,
  SiteLayoutUserMenuSeparator,
  SiteLayoutUserMenuTrigger,
} from "@publira/layouts";
import { Skeleton } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";

import {
  CatalogSearchForm,
  CatalogSearchFormSkeleton,
} from "#components/catalog-search-form";
import {
  LocaleProvider,
  TenantDefaultLocaleProvider,
} from "#components/locale-provider";
import {
  LocaleSwitcher,
  LocaleSwitcherSkeleton,
} from "#components/locale-switcher";
import { Message } from "#components/message";
import {
  NotificationBell,
  NotificationBellContent,
  NotificationBellEmpty,
  NotificationBellEmptyDescription,
  NotificationBellEmptyTitle,
  NotificationBellError,
  NotificationBellHeader,
  NotificationBellItem,
  NotificationBellItemDescription,
  NotificationBellItemState,
  NotificationBellItemTitle,
  NotificationBellList,
  NotificationBellMore,
  NotificationBellSkeleton,
  NotificationBellTrigger,
} from "#components/notification-bell";
import { NotificationBellErrorBoundary } from "#components/notification-bell-error-boundary";
import { TenantBrandLogo } from "#components/tenant-brand-logo";
import { PUBLIC_SESSION_COOKIE_NAME } from "#lib/auth-shared";
import { getLocale, loadHostMessages } from "#lib/locale";
import type { HostMessageKey } from "#lib/locale";
import { withLocalePrefix } from "#lib/locale-path";
import { logoutAction } from "#lib/logout-action";
import { countUnreadNotifications, listNotifications } from "#lib/notification";
import { listPublishedPageLinks } from "#lib/pages";
import {
  getTenantDefaultLocale,
  getTenantSiteInfo,
  getTenantSiteLabel,
} from "#lib/tenant";
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

const notificationMenuLimit = 5;

const HostNotificationBell = async ({ moreHref }: { moreHref: string }) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [defaultLocale, list, unread] = await Promise.all([
    getTenantDefaultLocale(tenantId),
    listNotifications(tenantId, { limit: notificationMenuLimit, locale }),
    countUnreadNotifications(tenantId, locale),
  ]);
  const unreadMessage =
    unread.unreadCount > 0
      ? "host.nav.notifications_unread"
      : "host.nav.notifications_none";
  let notificationContent = (
    <NotificationBellError>
      <Suspense fallback={<Skeleton className="h-4 w-64" />}>
        <Message message="host.notifications.list_failed" />
      </Suspense>
    </NotificationBellError>
  );

  if (list.ok && list.notifications.length === 0) {
    notificationContent = (
      <NotificationBellEmpty>
        <NotificationBellEmptyTitle>
          <Suspense fallback={<Skeleton className="h-4 w-32" />}>
            <Message message="host.notifications.empty_title" />
          </Suspense>
        </NotificationBellEmptyTitle>
        <NotificationBellEmptyDescription>
          <Suspense fallback={<Skeleton className="mt-1 h-4 w-56" />}>
            <Message message="host.notifications.empty_description" />
          </Suspense>
        </NotificationBellEmptyDescription>
      </NotificationBellEmpty>
    );
  }

  if (list.ok && list.notifications.length > 0) {
    notificationContent = (
      <NotificationBellList>
        {list.notifications.map((notification) => (
          <NotificationBellItem
            href={
              notification.href
                ? withLocalePrefix(locale, defaultLocale, notification.href)
                : undefined
            }
            isRead={notification.isRead}
            key={notification.id}
          >
            <NotificationBellItemState>
              <Suspense fallback={null}>
                <Message
                  message={
                    notification.isRead
                      ? "host.common.read"
                      : "host.common.unread"
                  }
                />
              </Suspense>
            </NotificationBellItemState>
            <NotificationBellItemTitle>
              {notification.title}
            </NotificationBellItemTitle>
            <NotificationBellItemDescription>
              {notification.description}
            </NotificationBellItemDescription>
          </NotificationBellItem>
        ))}
      </NotificationBellList>
    );
  }

  return (
    <NotificationBell>
      <NotificationBellTrigger unreadCount={unread.unreadCount}>
        <Suspense fallback={null}>
          <Message
            message={unreadMessage}
            values={{ count: unread.unreadCount }}
          />
        </Suspense>
      </NotificationBellTrigger>
      <NotificationBellContent>
        <NotificationBellHeader unreadCount={unread.unreadCount}>
          <Suspense fallback={<Skeleton className="h-4 w-16" />}>
            <Message message="host.notifications.list_heading" />
          </Suspense>
        </NotificationBellHeader>
        {notificationContent}
        <NotificationBellMore href={moreHref}>
          <Suspense fallback={<Skeleton className="h-4 w-16" />}>
            <Message message="host.notifications.menu_more" />
          </Suspense>
        </NotificationBellMore>
      </NotificationBellContent>
    </NotificationBell>
  );
};

const HeaderActions = async () => {
  const [cookieStore, tenantId, locale] = await Promise.all([
    cookies(),
    getTenantId(),
    getLocale(),
  ]);
  const [defaultLocale, messages] = await Promise.all([
    getTenantDefaultLocale(tenantId),
    loadHostMessages(locale),
  ]);
  const hasSession = Boolean(
    cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value
  );
  const moreHref = withLocalePrefix(locale, defaultLocale, "/notifications");
  return (
    <div className="flex items-center gap-2">
      {hasSession ? (
        <NotificationBellErrorBoundary moreHref={moreHref}>
          <Suspense fallback={<NotificationBellSkeleton />}>
            <HostNotificationBell moreHref={moreHref} />
          </Suspense>
        </NotificationBellErrorBoundary>
      ) : null}
      <SiteLayoutActions>
        {hasSession ? (
          <SiteLayoutUserMenu>
            <SiteLayoutUserMenuTrigger
              ariaLabel={getMessage(messages, "host.nav.account_menu")}
            />
            <SiteLayoutUserMenuContent>
              <SiteLayoutUserMenuMyPageLink
                href={withLocalePrefix(locale, defaultLocale, "/my")}
              >
                {getMessage(messages, "host.nav.my_page")}
              </SiteLayoutUserMenuMyPageLink>
              <SiteLayoutUserMenuSeparator />
              <SiteLayoutUserMenuLogout
                action={logoutAction.bind(null, tenantId, locale)}
                ariaLabel={getMessage(messages, "host.nav.logout")}
              >
                {getMessage(messages, "host.nav.logout")}
              </SiteLayoutUserMenuLogout>
            </SiteLayoutUserMenuContent>
          </SiteLayoutUserMenu>
        ) : (
          <SiteLayoutSecondaryAction
            href={withLocalePrefix(locale, defaultLocale, "/login")}
          >
            {getMessage(messages, "host.nav.login")}
          </SiteLayoutSecondaryAction>
        )}
        {hasSession ? null : (
          <SiteLayoutPrimaryAction
            href={withLocalePrefix(locale, defaultLocale, "/signup")}
          >
            {getMessage(messages, "host.nav.signup")}
          </SiteLayoutPrimaryAction>
        )}
      </SiteLayoutActions>
    </div>
  );
};

const TenantFooterLinks = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [defaultLocale, links, messages] = await Promise.all([
    getTenantDefaultLocale(tenantId),
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
          href={withLocalePrefix(locale, defaultLocale, link.href)}
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
  const [locale, tenantId] = await Promise.all([getLocale(), getTenantId()]);
  const [defaultLocale, messages] = await Promise.all([
    getTenantDefaultLocale(tenantId),
    loadHostMessages(locale),
  ]);

  return (
    <SiteLayoutNav>
      {siteNavItems.map((item) => (
        <SiteLayoutNavLink
          href={withLocalePrefix(locale, defaultLocale, item.href)}
          key={item.href}
        >
          {getMessage(messages, item.label)}
        </SiteLayoutNavLink>
      ))}
    </SiteLayoutNav>
  );
};

const TenantBrand = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const tenantInfo = await getTenantSiteInfo(tenantId);
  const variant = resolveTenantLogoVariant(tenantInfo);
  if (!variant) {
    return tenantInfo?.name.trim() || undefined;
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

const TenantFooterNote = async () => {
  const tenantId = await getTenantId();
  const tenantInfo = await getTenantSiteInfo(tenantId);
  const footerNote = tenantInfo?.siteDescription?.trim();

  return footerNote ? (
    <SiteLayoutFooterNote>{footerNote}</SiteLayoutFooterNote>
  ) : null;
};

const TenantFooterCopyright = async () => {
  const tenantId = await getTenantId();
  const tenantInfo = await getTenantSiteInfo(tenantId);
  const copyrightText = tenantInfo?.copyrightText?.trim();

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

/**
 * Seeds the locale context for everything under `(site)`. The root layout
 * reads nothing, so this is the first place both values exist: the request's
 * locale from the root parameter, and the tenant's stored default from
 * `GetTenant`. A failed tenant read therefore throws here, where
 * `app/[tenant_id]/[locale]/error.tsx` catches it.
 */
const TenantLayout = async ({
  children,
}: LayoutProps<"/[tenant_id]/[locale]">) => {
  const [locale, tenantId] = await Promise.all([getLocale(), getTenantId()]);
  const defaultLocale = await getTenantDefaultLocale(tenantId);
  const brandHref = withLocalePrefix(locale, defaultLocale, "/");

  return (
    <LocaleProvider locale={locale}>
      <TenantDefaultLocaleProvider defaultLocale={defaultLocale}>
        <SiteLayout>
          <SiteLayoutHeader>
            <SiteLayoutBrand href={brandHref}>
              <Suspense fallback={<SiteLayoutBrandSkeleton />}>
                <TenantBrand />
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
                <TenantFooterNote />
              </Suspense>
              <Suspense
                fallback={
                  <SiteLayoutFooterCopyright>
                    <Skeleton className="inline-block h-4 w-48 rounded" />
                  </SiteLayoutFooterCopyright>
                }
              >
                <TenantFooterCopyright />
              </Suspense>
            </SiteLayoutFooterContent>
          </SiteLayoutFooter>
        </SiteLayout>
      </TenantDefaultLocaleProvider>
    </LocaleProvider>
  );
};

export default TenantLayout;
