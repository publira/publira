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
  SiteLayoutHeaderSearch,
  SiteLayoutHeaderWideControls,
  SiteLayoutMain,
  SiteLayoutMobileNavigation,
  SiteLayoutMobileNavigationActions,
  SiteLayoutMobileNavigationCloseButton,
  SiteLayoutMobileNavigationHeader,
  SiteLayoutMobileNavigationLink,
  SiteLayoutMobileNavigationLinks,
  SiteLayoutMobileNavigationOpenButton,
  SiteLayoutMobileNavigationPrimaryAction,
  SiteLayoutMobileNavigationSearch,
  SiteLayoutMobileNavigationSecondaryAction,
  SiteLayoutMobileNavigationSection,
  SiteLayoutMobileNavigationSectionTitle,
  SiteLayoutMobileNavigationTitle,
  SiteLayoutNav,
  SiteLayoutNavLink,
  SiteLayoutNavSkeleton,
  SiteLayoutPrimaryAction,
  SiteLayoutSecondaryAction,
  SiteLayoutUserMenu,
  SiteLayoutUserMenuAnnouncementsLink,
  SiteLayoutUserMenuContent,
  SiteLayoutUserMenuLogout,
  SiteLayoutUserMenuLogoutButton,
  SiteLayoutUserMenuMyPageLink,
  SiteLayoutUserMenuSeparator,
  SiteLayoutUserMenuTrigger,
} from "@publira/layouts";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { cookies } from "next/headers";
import { Suspense } from "react";
import type { ReactNode } from "react";

import {
  CatalogSearchForm,
  CatalogSearchFormSkeleton,
} from "#components/catalog-search-form";
import {
  LocaleSwitcher,
  LocaleSwitcherLinks,
  LocaleSwitcherLinksSkeleton,
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
import { getLocale, loadHostMessages, tenantDefaultLocale } from "#lib/locale";
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

/** The account menu's trigger, which shows an icon and carries its name as an attribute. */
const AccountMenuTrigger = async () => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <SiteLayoutUserMenuTrigger
      aria-label={getMessage(messages, "host.nav.account_menu")}
    />
  );
};

const HeaderActions = async () => {
  const [cookieStore, tenantId, locale] = await Promise.all([
    cookies(),
    getTenantId(),
    getLocale(),
  ]);
  const defaultLocale = await getTenantDefaultLocale(tenantId);
  const hasSession = Boolean(
    cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value
  );
  const moreHref = withLocalePrefix(locale, defaultLocale, "/notifications");

  // Signing in and signing up are the pair the phone band hands to the drawer,
  // so at that width this branch draws nothing and the row keeps the brand and
  // the menu button. The bell and the account menu are single icons and stay.
  if (!hasSession) {
    return (
      <SiteLayoutHeaderWideControls>
        <SiteLayoutSecondaryAction
          href={withLocalePrefix(locale, defaultLocale, "/login")}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="host.nav.login" />
          </Suspense>
        </SiteLayoutSecondaryAction>
        <SiteLayoutPrimaryAction
          href={withLocalePrefix(locale, defaultLocale, "/signup")}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.nav.signup" />
          </Suspense>
        </SiteLayoutPrimaryAction>
      </SiteLayoutHeaderWideControls>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <NotificationBellErrorBoundary moreHref={moreHref}>
        <Suspense fallback={<NotificationBellSkeleton />}>
          <HostNotificationBell moreHref={moreHref} />
        </Suspense>
      </NotificationBellErrorBoundary>
      <SiteLayoutActions>
        <SiteLayoutUserMenu>
          <Suspense fallback={<Skeleton className="size-9 rounded-control" />}>
            <AccountMenuTrigger />
          </Suspense>
          <SiteLayoutUserMenuContent>
            <SiteLayoutUserMenuMyPageLink
              href={withLocalePrefix(locale, defaultLocale, "/my")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="host.nav.my_page" />
              </Suspense>
            </SiteLayoutUserMenuMyPageLink>
            <SiteLayoutUserMenuAnnouncementsLink
              href={withLocalePrefix(locale, defaultLocale, "/announcements")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="host.nav.announcements" />
              </Suspense>
            </SiteLayoutUserMenuAnnouncementsLink>
            <SiteLayoutUserMenuSeparator />
            <SiteLayoutUserMenuLogout
              action={logoutAction.bind(null, tenantId, locale)}
            >
              <SiteLayoutUserMenuLogoutButton>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="host.nav.logout" />
                </Suspense>
              </SiteLayoutUserMenuLogoutButton>
            </SiteLayoutUserMenuLogout>
          </SiteLayoutUserMenuContent>
        </SiteLayoutUserMenu>
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
      aria-label={getMessage(messages, "host.nav.footer_links")}
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

/**
 * Bare hrefs, prefixed with the request's locale before they reach
 * `@publira/layouts` — that package is shared with the two consoles, which keep
 * their locale in a cookie, so it renders plain `next/link`s and cannot add the
 * prefix itself.
 *
 * Whether the prefix is there at all depends on the tenant's stored default, so
 * the row is resolved rather than static and stands behind
 * `<SiteLayoutNavSkeleton>`. Each label keeps a boundary of its own inside it:
 * the catalog is a separate wait, and one label is not worth holding the rest.
 */
const SiteNav = async () => {
  const [locale, defaultLocale] = await Promise.all([
    getLocale(),
    tenantDefaultLocale(),
  ]);

  return (
    <SiteLayoutNav>
      <SiteLayoutNavLink
        href={withLocalePrefix(locale, defaultLocale, "/authors")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
          <Message message="host.nav.authors" />
        </Suspense>
      </SiteLayoutNavLink>
      <SiteLayoutNavLink
        href={withLocalePrefix(locale, defaultLocale, "/labels")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="host.nav.labels" />
        </Suspense>
      </SiteLayoutNavLink>
      <SiteLayoutNavLink
        href={withLocalePrefix(locale, defaultLocale, "/series")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="host.nav.series" />
        </Suspense>
      </SiteLayoutNavLink>
      <SiteLayoutNavLink
        href={withLocalePrefix(locale, defaultLocale, "/genres")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
          <Message message="host.nav.genres" />
        </Suspense>
      </SiteLayoutNavLink>
      <SiteLayoutNavLink
        href={withLocalePrefix(locale, defaultLocale, "/search")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="host.nav.search" />
        </Suspense>
      </SiteLayoutNavLink>
    </SiteLayoutNav>
  );
};

/** Same footprint as the rendered menu button, so the header does not shift. */
const MobileNavigationOpenButtonSkeleton = () => (
  <Skeleton className="size-9 rounded-control md:hidden" />
);

/** Same five rows the drawer draws, at the height the links render at. */
const MobileNavigationLinksSkeleton = () => (
  <div aria-hidden="true" className="grid gap-1">
    <SkeletonLine className="my-2 h-4 w-14" />
    <SkeletonLine className="my-2 h-4 w-12" />
    <SkeletonLine className="my-2 h-4 w-12" />
    <SkeletonLine className="my-2 h-4 w-14" />
    <SkeletonLine className="my-2 h-4 w-12" />
  </div>
);

/** Same footprint as the pair it stands in for, at the foot of the drawer. */
const MobileNavigationAccountActionsSkeleton = () => (
  <div aria-hidden="true" className="mt-auto grid gap-2">
    <Skeleton className="h-9 rounded-control" />
    <Skeleton className="h-9 rounded-control" />
  </div>
);

/** The drawer's close button, which carries its name as an attribute. */
const MobileNavigationCloseButton = async () => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <SiteLayoutMobileNavigationCloseButton
      aria-label={getMessage(messages, "host.nav.navigation_close")}
    />
  );
};

/** The band's menu button, which carries its name as an attribute. */
const MobileNavigationOpenButton = async () => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <SiteLayoutMobileNavigationOpenButton
      aria-label={getMessage(messages, "host.nav.navigation_open")}
    />
  );
};

/**
 * The pair at the foot of the drawer, drawn for a reader who is not signed in.
 * Which of the two answers it is depends on a cookie, so this is the one part
 * of the drawer that has to wait on a read of its own.
 */
const MobileNavigationAccountActions = async () => {
  const [cookieStore, locale, defaultLocale] = await Promise.all([
    cookies(),
    getLocale(),
    tenantDefaultLocale(),
  ]);

  if (cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value) {
    return null;
  }

  return (
    <SiteLayoutMobileNavigationActions>
      <SiteLayoutMobileNavigationSecondaryAction
        href={withLocalePrefix(locale, defaultLocale, "/login")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="host.nav.login" />
        </Suspense>
      </SiteLayoutMobileNavigationSecondaryAction>
      <SiteLayoutMobileNavigationPrimaryAction
        href={withLocalePrefix(locale, defaultLocale, "/signup")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.nav.signup" />
        </Suspense>
      </SiteLayoutMobileNavigationPrimaryAction>
    </SiteLayoutMobileNavigationActions>
  );
};

/**
 * The drawer's five catalog rows. Their hrefs carry a locale prefix only when
 * the request's locale is not the tenant's stored default, so the list is
 * resolved rather than static — the same wait the band's own row makes.
 */
const MobileNavigationLinks = async () => {
  const [locale, defaultLocale] = await Promise.all([
    getLocale(),
    tenantDefaultLocale(),
  ]);

  return (
    <SiteLayoutMobileNavigationLinks>
      <SiteLayoutMobileNavigationLink
        href={withLocalePrefix(locale, defaultLocale, "/authors")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
          <Message message="host.nav.authors" />
        </Suspense>
      </SiteLayoutMobileNavigationLink>
      <SiteLayoutMobileNavigationLink
        href={withLocalePrefix(locale, defaultLocale, "/labels")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="host.nav.labels" />
        </Suspense>
      </SiteLayoutMobileNavigationLink>
      <SiteLayoutMobileNavigationLink
        href={withLocalePrefix(locale, defaultLocale, "/series")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="host.nav.series" />
        </Suspense>
      </SiteLayoutMobileNavigationLink>
      <SiteLayoutMobileNavigationLink
        href={withLocalePrefix(locale, defaultLocale, "/genres")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
          <Message message="host.nav.genres" />
        </Suspense>
      </SiteLayoutMobileNavigationLink>
      <SiteLayoutMobileNavigationLink
        href={withLocalePrefix(locale, defaultLocale, "/search")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="host.nav.search" />
        </Suspense>
      </SiteLayoutMobileNavigationLink>
    </SiteLayoutMobileNavigationLinks>
  );
};

/**
 * What the band stops drawing below `md`: the catalog field, the navigation,
 * the language, and — for a reader who is not signed in — the account actions.
 * Four controls and a 342px row do not fit, and the band would rather truncate
 * the tenant's name than any of them, so a phone reaches all four through the
 * menu button this renders beside the drawer holding them.
 *
 * The drawer itself is structure and resolves nothing: its rows, its field, and
 * its buttons are drawn from the start, and only the strings inside them, the
 * hrefs that need the tenant's stored default, and the one answer that needs a
 * cookie arrive behind boundaries of their own.
 */
const SiteMobileNavigation = () => (
  <>
    <SiteLayoutMobileNavigation>
      <SiteLayoutMobileNavigationHeader>
        <SiteLayoutMobileNavigationTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-16" />}>
            <Message message="host.nav.menu" />
          </Suspense>
        </SiteLayoutMobileNavigationTitle>
        <Suspense fallback={<Skeleton className="size-9 rounded-control" />}>
          <MobileNavigationCloseButton />
        </Suspense>
      </SiteLayoutMobileNavigationHeader>
      <SiteLayoutMobileNavigationSearch>
        <Suspense fallback={<CatalogSearchFormSkeleton />}>
          <CatalogSearchForm id="catalog-search-menu" />
        </Suspense>
      </SiteLayoutMobileNavigationSearch>
      <Suspense fallback={<MobileNavigationLinksSkeleton />}>
        <MobileNavigationLinks />
      </Suspense>
      <SiteLayoutMobileNavigationSection>
        <SiteLayoutMobileNavigationSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
            <Message message="host.nav.locale_switcher" />
          </Suspense>
        </SiteLayoutMobileNavigationSectionTitle>
        <Suspense fallback={<LocaleSwitcherLinksSkeleton />}>
          <LocaleSwitcherLinks />
        </Suspense>
      </SiteLayoutMobileNavigationSection>
      <Suspense fallback={<MobileNavigationAccountActionsSkeleton />}>
        <MobileNavigationAccountActions />
      </Suspense>
    </SiteLayoutMobileNavigation>
    <Suspense fallback={<MobileNavigationOpenButtonSkeleton />}>
      <MobileNavigationOpenButton />
    </Suspense>
  </>
);

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

/**
 * The brand, whose href is `/` on the tenant's own default locale and
 * `/{locale}` on the other, so the anchor cannot be named until the tenant read
 * answers. Its mark waits on the same read, so both sit behind one boundary.
 */
const TenantBrandLink = async () => {
  const [locale, defaultLocale] = await Promise.all([
    getLocale(),
    tenantDefaultLocale(),
  ]);

  return (
    <SiteLayoutBrand href={withLocalePrefix(locale, defaultLocale, "/")}>
      <TenantBrand />
    </SiteLayoutBrand>
  );
};

/**
 * The band, the drawer, and the footer a reader sees on every screen under
 * `(site)`, with the page between them.
 *
 * Nothing is awaited at this level. Every part that names a tenant — the brand
 * and its href, the two navigation rows, the account controls, the footer —
 * sits behind a boundary of its own, because `[tenant_id]` is a placeholder in
 * `generateStaticParams` and one static shell is shared by every tenant.
 * `children` are behind none of them: the page is prerendered with the chrome
 * around it, and a `<LocaleLink>` inside it suspends at the boundary its own
 * section already has.
 */
export const SiteChrome = ({ children }: { children: ReactNode }) => (
  <SiteLayout>
    <SiteLayoutHeader>
      <Suspense fallback={<SiteLayoutBrandSkeleton />}>
        <TenantBrandLink />
      </Suspense>
      <Suspense fallback={<SiteLayoutNavSkeleton />}>
        <SiteNav />
      </Suspense>
      <SiteLayoutHeaderSearch>
        <Suspense fallback={<CatalogSearchFormSkeleton />}>
          <CatalogSearchForm id="catalog-search-header" />
        </Suspense>
      </SiteLayoutHeaderSearch>
      <SiteLayoutHeaderWideControls>
        <Suspense fallback={<LocaleSwitcherSkeleton />}>
          <LocaleSwitcher />
        </Suspense>
      </SiteLayoutHeaderWideControls>
      <SiteLayoutHeaderActions>
        <Suspense fallback={<SiteLayoutHeaderActionsSkeleton />}>
          <HeaderActions />
        </Suspense>
      </SiteLayoutHeaderActions>
      <SiteMobileNavigation />
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
              <Skeleton className="inline-block h-4 w-56 rounded-control" />
            </SiteLayoutFooterNote>
          }
        >
          <TenantFooterNote />
        </Suspense>
        <Suspense
          fallback={
            <SiteLayoutFooterCopyright>
              <Skeleton className="inline-block h-4 w-48 rounded-control" />
            </SiteLayoutFooterCopyright>
          }
        >
          <TenantFooterCopyright />
        </Suspense>
      </SiteLayoutFooterContent>
    </SiteLayoutFooter>
  </SiteLayout>
);
