import { UserIcon } from "@publira/icons";
import * as SiteLayout from "@publira/layouts/site-layout";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { cookies } from "next/headers";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { AccountIcon } from "#components/account-icon";
import {
  CatalogSearchForm,
  CatalogSearchFormSkeleton,
} from "#components/catalog-search-form";
import * as LocaleSwitcher from "#components/locale-switcher";
import { Message } from "#components/message";
import * as NotificationBell from "#components/notification-bell";
import { NotificationBellErrorBoundary } from "#components/notification-bell-error-boundary";
import { SignOutForm } from "#components/sign-out-form";
import { TenantBrandLogo } from "#components/tenant-brand-logo";
import { ANALYTICS_CONSENT_COOKIE_NAME } from "#lib/analytics-consent-cookie";
import { getMyAccount } from "#lib/auth";
import { PUBLIC_SESSION_COOKIE_NAME } from "#lib/auth-shared";
import { getMessages } from "#lib/get-messages";
import { getTenantGoogleTag } from "#lib/google-tag";
import { getLocale, tenantDefaultLocale } from "#lib/locale";
import { withLocalePrefix } from "#lib/locale-path";
import { logoutAction } from "#lib/logout-action";
import { getMessagesFor } from "#lib/messages";
import { countUnreadNotifications, listNotifications } from "#lib/notification";
import { listPublishedPageLinks } from "#lib/pages";
import {
  getTenantLinkDefaultLocale,
  getTenantSiteCopy,
  getTenantSiteInfo,
  getTenantSiteLabel,
} from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";
import { resolveTenantLogoVariant } from "#lib/tenant-logo";

import { AnalyticsConsentBanner } from "./analytics-consent-banner";
import { AnalyticsConsentSettingsButton } from "./analytics-consent-settings-button";
import { LegalPageAgreementGate } from "./legal-page-agreement-gate";
import { PinnedAnnouncementBanner } from "./pinned-announcement-banner";

const notificationMenuLimit = 5;

const StorefrontNotificationBell = async ({
  moreHref,
}: {
  moreHref: string;
}) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [defaultLocale, list, unread] = await Promise.all([
    getTenantLinkDefaultLocale(tenantId),
    listNotifications(tenantId, { limit: notificationMenuLimit, locale }),
    countUnreadNotifications(tenantId, locale),
  ]);
  let notificationContent = (
    <NotificationBell.Error>
      <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
        <Message message="storefront.notifications.list_failed" />
      </Suspense>
    </NotificationBell.Error>
  );

  if (list.ok && list.notifications.length === 0) {
    notificationContent = (
      <NotificationBell.Empty>
        <NotificationBell.EmptyTitle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="storefront.notifications.empty_title" />
          </Suspense>
        </NotificationBell.EmptyTitle>
        <NotificationBell.EmptyDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message message="storefront.notifications.empty_description" />
          </Suspense>
        </NotificationBell.EmptyDescription>
      </NotificationBell.Empty>
    );
  }

  if (list.ok && list.notifications.length > 0) {
    notificationContent = (
      <NotificationBell.List>
        {list.notifications.map((notification) => (
          <NotificationBell.Item
            href={
              notification.href
                ? withLocalePrefix(locale, defaultLocale, notification.href)
                : undefined
            }
            isRead={notification.isRead}
            key={notification.id}
          >
            <NotificationBell.ItemState>
              <Suspense fallback={null}>
                {notification.isRead ? (
                  <Message message="storefront.common.read" />
                ) : (
                  <Message message="storefront.common.unread" />
                )}
              </Suspense>
            </NotificationBell.ItemState>
            <NotificationBell.ItemTitle>
              {notification.title}
            </NotificationBell.ItemTitle>
            <NotificationBell.ItemDescription>
              {notification.description}
            </NotificationBell.ItemDescription>
          </NotificationBell.Item>
        ))}
      </NotificationBell.List>
    );
  }

  return (
    <NotificationBell.Root>
      <NotificationBell.Trigger unreadCount={unread.unreadCount}>
        <Suspense fallback={null}>
          {unread.unreadCount > 0 ? (
            <Message
              message="storefront.nav.notifications_unread"
              values={{ count: unread.unreadCount }}
            />
          ) : (
            <Message message="storefront.nav.notifications_none" />
          )}
        </Suspense>
      </NotificationBell.Trigger>
      <NotificationBell.Content>
        <NotificationBell.Header unreadCount={unread.unreadCount}>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="storefront.notifications.list_heading" />
          </Suspense>
        </NotificationBell.Header>
        {notificationContent}
        <NotificationBell.More href={moreHref}>
          <Suspense fallback={<Skeleton className="h-4 w-16" />}>
            <Message message="storefront.notifications.menu_more" />
          </Suspense>
        </NotificationBell.More>
      </NotificationBell.Content>
    </NotificationBell.Root>
  );
};

/**
 * Whose account the menu belongs to.
 *
 * It is the only place on the site that names the reader, which is why the
 * separator belongs to it: an account this read cannot resolve leaves the menu
 * as the links alone rather than with a rule over nothing. An account with no
 * display name yet is known by its public ID, the identifier the reader gives
 * when they ask for help.
 */
const AccountMenuName = async () => {
  const me = await getMyAccount(await getTenantId());

  if (!me) {
    return null;
  }

  return (
    <>
      <SiteLayout.UserMenuAccount>
        {me.name.trim() || me.publicId}
      </SiteLayout.UserMenuAccount>
      <SiteLayout.UserMenuSeparator />
    </>
  );
};

/**
 * The account menu's trigger, which shows the account's icon — a person glyph
 * for one that has none — and carries its name as an attribute.
 */
const AccountMenuTrigger = async () => {
  const tenantId = await getTenantId();
  const [t, me] = await Promise.all([getMessages(), getMyAccount(tenantId)]);

  return (
    <SiteLayout.UserMenuTrigger aria-label={t("storefront.nav.account_menu")}>
      {/* The trigger's label names it, so the image itself says nothing. */}
      <AccountIcon
        alt=""
        className="size-full object-cover"
        fallback={<UserIcon aria-hidden="true" className="size-4" />}
        icon={me?.icon ?? null}
        size={44}
      />
    </SiteLayout.UserMenuTrigger>
  );
};

const HeaderActions = async () => {
  const [cookieStore, tenantId, locale] = await Promise.all([
    cookies(),
    getTenantId(),
    getLocale(),
  ]);
  const defaultLocale = await getTenantLinkDefaultLocale(tenantId);
  const hasSession = Boolean(
    cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value
  );
  const moreHref = withLocalePrefix(locale, defaultLocale, "/notifications");

  // Signing in and signing up are the pair the phone band hands to the drawer,
  // so at that width this branch draws nothing and the row keeps the brand and
  // the menu button. The bell and the account menu are single icons and stay.
  if (!hasSession) {
    return (
      <SiteLayout.HeaderWideControls>
        <SiteLayout.SecondaryAction
          href={withLocalePrefix(locale, defaultLocale, "/login")}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="storefront.nav.login" />
          </Suspense>
        </SiteLayout.SecondaryAction>
        <SiteLayout.PrimaryAction
          href={withLocalePrefix(locale, defaultLocale, "/signup")}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="storefront.nav.signup" />
          </Suspense>
        </SiteLayout.PrimaryAction>
      </SiteLayout.HeaderWideControls>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <NotificationBellErrorBoundary moreHref={moreHref}>
        <Suspense fallback={<NotificationBell.Skeleton />}>
          <StorefrontNotificationBell moreHref={moreHref} />
        </Suspense>
      </NotificationBellErrorBoundary>
      <SiteLayout.Actions>
        <SiteLayout.UserMenu>
          <Suspense
            fallback={
              <Skeleton className="size-9 rounded-control pointer-coarse:size-11" />
            }
          >
            <AccountMenuTrigger />
          </Suspense>
          <SiteLayout.UserMenuContent>
            <Suspense
              fallback={<SkeletonLine className="mx-3 my-2 h-4 w-24" />}
            >
              <AccountMenuName />
            </Suspense>
            <SiteLayout.UserMenuMyPageLink
              href={withLocalePrefix(locale, defaultLocale, "/my")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="storefront.nav.my_page" />
              </Suspense>
            </SiteLayout.UserMenuMyPageLink>
            <SiteLayout.UserMenuAnnouncementsLink
              href={withLocalePrefix(locale, defaultLocale, "/announcements")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="storefront.nav.announcements" />
              </Suspense>
            </SiteLayout.UserMenuAnnouncementsLink>
            <SiteLayout.UserMenuSeparator />
            <SignOutForm
              locale={locale}
              signOut={logoutAction.bind(null, tenantId, locale)}
              tenantId={tenantId}
            >
              <SiteLayout.UserMenuLogoutButton>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="storefront.nav.logout" />
                </Suspense>
              </SiteLayout.UserMenuLogoutButton>
            </SignOutForm>
          </SiteLayout.UserMenuContent>
        </SiteLayout.UserMenu>
      </SiteLayout.Actions>
    </div>
  );
};

/**
 * The tenant's published pages, then the contact form. The form is the one
 * link every site has, so the row is never empty. A tenant that asks before
 * its Google tag runs ends the row with **Cookie settings**.
 */
const TenantFooterLinks = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [defaultLocale, links, t, googleTag] = await Promise.all([
    getTenantLinkDefaultLocale(tenantId),
    listPublishedPageLinks(tenantId, locale),
    getMessagesFor(locale),
    getTenantGoogleTag(tenantId),
  ]);

  return (
    <SiteLayout.FooterLinks aria-label={t("storefront.nav.footer_links")}>
      {links.map((link) => (
        <SiteLayout.FooterLink
          href={withLocalePrefix(locale, defaultLocale, link.href)}
          key={link.href}
        >
          {link.label}
        </SiteLayout.FooterLink>
      ))}
      <SiteLayout.FooterLink
        href={withLocalePrefix(locale, defaultLocale, "/contact")}
      >
        {t("storefront.nav.contact")}
      </SiteLayout.FooterLink>
      {googleTag?.consentMode === "opt_in" ? (
        <AnalyticsConsentSettingsButton
          cookieName={ANALYTICS_CONSENT_COOKIE_NAME}
        >
          {t("storefront.analytics_consent.settings")}
        </AnalyticsConsentSettingsButton>
      ) : null}
    </SiteLayout.FooterLinks>
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
 * `<SiteLayout.NavSkeleton>`. Each label keeps a boundary of its own inside it:
 * the catalog is a separate wait, and one label is not worth holding the rest.
 */
const SiteNav = async () => {
  const [locale, defaultLocale] = await Promise.all([
    getLocale(),
    tenantDefaultLocale(),
  ]);

  return (
    <SiteLayout.Nav>
      <SiteLayout.NavLink
        href={withLocalePrefix(locale, defaultLocale, "/labels")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="storefront.nav.labels" />
        </Suspense>
      </SiteLayout.NavLink>
      <SiteLayout.NavLink
        href={withLocalePrefix(locale, defaultLocale, "/genres")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
          <Message message="storefront.nav.genres" />
        </Suspense>
      </SiteLayout.NavLink>
    </SiteLayout.Nav>
  );
};

/** Same footprint as the rendered menu button, so the header does not shift. */
const MobileNavigationOpenButtonSkeleton = () => (
  <Skeleton className="size-9 rounded-control md:hidden pointer-coarse:size-11" />
);

/** Same two rows the drawer draws, at the height the links render at. */
const MobileNavigationLinksSkeleton = () => (
  <div aria-hidden="true" className="grid gap-1">
    <SkeletonLine className="my-2 h-4 w-12 pointer-coarse:my-3.5" />
    <SkeletonLine className="my-2 h-4 w-14 pointer-coarse:my-3.5" />
  </div>
);

/** Same footprint as the pair it stands in for, at the foot of the drawer. */
const MobileNavigationAccountActionsSkeleton = () => (
  <div aria-hidden="true" className="mt-auto grid gap-2">
    <Skeleton className="h-9 rounded-control pointer-coarse:h-11" />
    <Skeleton className="h-9 rounded-control pointer-coarse:h-11" />
  </div>
);

/** The drawer's close button, which carries its name as an attribute. */
const MobileNavigationCloseButton = async () => {
  const t = await getMessages();

  return (
    <SiteLayout.MobileNavigationCloseButton
      aria-label={t("storefront.nav.navigation_close")}
    />
  );
};

/** The band's menu button, which carries its name as an attribute. */
const MobileNavigationOpenButton = async () => {
  const t = await getMessages();

  return (
    <SiteLayout.MobileNavigationOpenButton
      aria-label={t("storefront.nav.navigation_open")}
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
    <SiteLayout.MobileNavigationActions>
      <SiteLayout.MobileNavigationSecondaryAction
        href={withLocalePrefix(locale, defaultLocale, "/login")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="storefront.nav.login" />
        </Suspense>
      </SiteLayout.MobileNavigationSecondaryAction>
      <SiteLayout.MobileNavigationPrimaryAction
        href={withLocalePrefix(locale, defaultLocale, "/signup")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="storefront.nav.signup" />
        </Suspense>
      </SiteLayout.MobileNavigationPrimaryAction>
    </SiteLayout.MobileNavigationActions>
  );
};

/**
 * The drawer's two catalog rows. Their hrefs carry a locale prefix only when
 * the request's locale is not the tenant's stored default, so the list is
 * resolved rather than static — the same wait the band's own row makes.
 */
const MobileNavigationLinks = async () => {
  const [locale, defaultLocale] = await Promise.all([
    getLocale(),
    tenantDefaultLocale(),
  ]);

  return (
    <SiteLayout.MobileNavigationLinks>
      <SiteLayout.MobileNavigationLink
        href={withLocalePrefix(locale, defaultLocale, "/labels")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="storefront.nav.labels" />
        </Suspense>
      </SiteLayout.MobileNavigationLink>
      <SiteLayout.MobileNavigationLink
        href={withLocalePrefix(locale, defaultLocale, "/genres")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
          <Message message="storefront.nav.genres" />
        </Suspense>
      </SiteLayout.MobileNavigationLink>
    </SiteLayout.MobileNavigationLinks>
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
 * hrefs that need the tenant's stored default, the language row a tenant that
 * offers one locale does without, and the one answer that needs a cookie arrive
 * behind boundaries of their own.
 */
const SiteMobileNavigation = () => (
  <>
    <SiteLayout.MobileNavigation>
      <SiteLayout.MobileNavigationHeader>
        <SiteLayout.MobileNavigationTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-16" />}>
            <Message message="storefront.nav.menu" />
          </Suspense>
        </SiteLayout.MobileNavigationTitle>
        <Suspense
          fallback={
            <Skeleton className="size-9 rounded-control pointer-coarse:size-11" />
          }
        >
          <MobileNavigationCloseButton />
        </Suspense>
      </SiteLayout.MobileNavigationHeader>
      <SiteLayout.MobileNavigationSearch>
        <Suspense fallback={<CatalogSearchFormSkeleton />}>
          <CatalogSearchForm id="catalog-search-menu" />
        </Suspense>
      </SiteLayout.MobileNavigationSearch>
      <Suspense fallback={<MobileNavigationLinksSkeleton />}>
        <MobileNavigationLinks />
      </Suspense>
      <Suspense fallback={<LocaleSwitcher.DisclosureSkeleton />}>
        <LocaleSwitcher.Disclosure />
      </Suspense>
      <Suspense fallback={<MobileNavigationAccountActionsSkeleton />}>
        <MobileNavigationAccountActions />
      </Suspense>
    </SiteLayout.MobileNavigation>
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

  const [siteLabel, t] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    getMessagesFor(locale),
  ]);

  return (
    <TenantBrandLogo
      alt={t("storefront.nav.logo_alt", { name: siteLabel })}
      fallbackLabel={siteLabel}
      priority
      variant={variant}
    />
  );
};

const TenantFooterNote = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const { siteDescription } = await getTenantSiteCopy(tenantId, locale);

  return siteDescription ? (
    <SiteLayout.FooterNote>{siteDescription}</SiteLayout.FooterNote>
  ) : null;
};

const TenantFooterCopyright = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const { copyrightText } = await getTenantSiteCopy(tenantId, locale);

  return copyrightText ? (
    <SiteLayout.FooterCopyright>{copyrightText}</SiteLayout.FooterCopyright>
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
    <SiteLayout.Brand href={withLocalePrefix(locale, defaultLocale, "/")}>
      <TenantBrand />
    </SiteLayout.Brand>
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
  <SiteLayout.Root>
    {/* Draws nothing; it only sends a reader who owes an agreement to give it. */}
    <Suspense fallback={null}>
      <LegalPageAgreementGate />
    </Suspense>
    {/*
      The band has no skeleton: a tenant with nothing pinned draws nothing here,
      and a placeholder above the header would push the page down on every
      render only to disappear.
    */}
    <Suspense fallback={null}>
      <PinnedAnnouncementBanner />
    </Suspense>
    {/*
      Over a wide episode viewer the header leaves the flow and lies across its
      top, sliding away while the viewer marks its controls hidden.
    */}
    <SiteLayout.Header className="transition-[translate,visibility] duration-state ease-state group-has-data-wide-viewer/document:absolute group-has-data-wide-viewer/document:inset-x-0 group-has-data-wide-viewer/document:top-0 group-has-data-wide-viewer/document:z-30 group-has-data-[wide-viewer=retracted]/document:invisible group-has-data-[wide-viewer=retracted]/document:-translate-y-full">
      <Suspense fallback={<SiteLayout.BrandSkeleton />}>
        <TenantBrandLink />
      </Suspense>
      <Suspense fallback={<SiteLayout.NavSkeleton />}>
        <SiteNav />
      </Suspense>
      <SiteLayout.HeaderSearch>
        <Suspense fallback={<CatalogSearchFormSkeleton />}>
          <CatalogSearchForm id="catalog-search-header" />
        </Suspense>
      </SiteLayout.HeaderSearch>
      <SiteLayout.HeaderWideControls>
        <Suspense fallback={<LocaleSwitcher.Skeleton />}>
          <LocaleSwitcher.Root />
        </Suspense>
      </SiteLayout.HeaderWideControls>
      <SiteLayout.HeaderActions>
        <Suspense fallback={<SiteLayout.HeaderActionsSkeleton />}>
          <HeaderActions />
        </Suspense>
      </SiteLayout.HeaderActions>
      <SiteMobileNavigation />
    </SiteLayout.Header>
    <SiteLayout.Main>{children}</SiteLayout.Main>
    <SiteLayout.Footer>
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <TenantFooterLinks />
      </Suspense>
      <SiteLayout.FooterContent>
        <Suspense
          fallback={
            <SiteLayout.FooterNote>
              <SkeletonLine className="h-4 w-56" />
            </SiteLayout.FooterNote>
          }
        >
          <TenantFooterNote />
        </Suspense>
        <Suspense
          fallback={
            <SiteLayout.FooterCopyright>
              <SkeletonLine className="h-4 w-48" />
            </SiteLayout.FooterCopyright>
          }
        >
          <TenantFooterCopyright />
        </Suspense>
      </SiteLayout.FooterContent>
    </SiteLayout.Footer>
    {/*
      Last in the chrome and sticky, so it sits at the foot of the window
      without covering the footer. A tenant that does not ask draws nothing.
    */}
    <Suspense fallback={null}>
      <AnalyticsConsentBanner />
    </Suspense>
  </SiteLayout.Root>
);
