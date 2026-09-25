# layouts

The package that provides the layout components reused across several web apps.

## What it provides

Every subpath is its own build entry, so an app imports the family it needs without pulling the others into the same module graph.

### `@publira/layouts` — the site layout

The storefront's frame, as compound components. The root also re-exports `isCurrentPath`.

- The frame: `SiteLayout`, `SiteLayoutHeader`, `SiteLayoutMain`, `SiteLayoutFooter`
- The header: `SiteLayoutBrand`, `SiteLayoutNav` / `SiteLayoutNavLink`, `SiteLayoutHeaderSearch`, `SiteLayoutHeaderWideControls`, `SiteLayoutHeaderActions`, and the actions a signed-out reader sees — `SiteLayoutActions` / `SiteLayoutPrimaryAction` / `SiteLayoutSecondaryAction`
- The user menu: `SiteLayoutUserMenu` and its parts — `SiteLayoutUserMenuTrigger`, `SiteLayoutUserMenuContent`, `SiteLayoutUserMenuAccount`, `SiteLayoutUserMenuMyPageLink`, `SiteLayoutUserMenuAnnouncementsLink`, `SiteLayoutUserMenuSeparator`, `SiteLayoutUserMenuLogout` / `SiteLayoutUserMenuLogoutButton`
- The banner above the header, for the one announcement a reader has to see first: `SiteLayoutBanner`, `SiteLayoutBannerContent`, `SiteLayoutBannerTitle`, `SiteLayoutBannerDescription`, `SiteLayoutBannerLink`, `SiteLayoutBannerActions`
- The phone header's drawer: `SiteLayoutMobileNavigation` and its parts — `SiteLayoutMobileNavigationOpenButton`, `SiteLayoutMobileNavigationCloseButton`, `SiteLayoutMobileNavigationHeader`, `SiteLayoutMobileNavigationTitle`, `SiteLayoutMobileNavigationLinks` / `SiteLayoutMobileNavigationLink`, `SiteLayoutMobileNavigationSearch`, `SiteLayoutMobileNavigationDisclosure` / `SiteLayoutMobileNavigationDisclosureTrigger` / `SiteLayoutMobileNavigationDisclosurePanel`, `SiteLayoutMobileNavigationActions` / `SiteLayoutMobileNavigationPrimaryAction` / `SiteLayoutMobileNavigationSecondaryAction`
- The footer: `SiteLayoutFooterContent`, `SiteLayoutFooterNote`, `SiteLayoutFooterLinks` / `SiteLayoutFooterLink`, `SiteLayoutFooterCopyright`
- The skeletons a `<Suspense>` shows while a part streams in: `SiteLayoutBrandSkeleton`, `SiteLayoutNavSkeleton`, `SiteLayoutHeaderActionsSkeleton`, `SiteLayoutFooterSkeleton`

`@publira/layouts/site-layout` is the frame, header, banner, footer, and skeletons alone, without the drawer, the user menu, and the signed-out actions.

### `@publira/layouts/admin` — the console layout

The shell `web-admin` and `web-platform` share: a sidebar, a 48px header, and the page and section frames inside it. It also re-exports `isCurrentPath`.

- The shell: `ConsoleLayout`, `ConsoleLayoutContent`, `ConsoleLayoutMain`, and the drawer the phone opens the sidebar in — `ConsoleMobileNavigation` / `ConsoleMobileNavigationOpenButton` / `ConsoleMobileNavigationCloseButton`
- The sidebar: `ConsoleSidebar`, `ConsoleSidebarBrand` / `ConsoleSidebarBrandName`, `ConsoleSidebarContext`, and its navigation — `ConsoleSidebarNavigation`, `ConsoleSidebarNavigationSection` / `ConsoleSidebarNavigationTitle`, `ConsoleSidebarNavigationItems` / `ConsoleSidebarNavigationItem` / `ConsoleSidebarNavigationItemIcon` / `ConsoleSidebarNavigationItemHeading` / `ConsoleSidebarNavigationItemLabel`
- The header: `ConsoleHeader`, `ConsoleHeaderContext` / `ConsoleHeaderText` / `ConsoleHeaderLabel`, `ConsoleHeaderActions`, `ConsoleHeaderUser`
- The user menu: `ConsoleUserMenu` and its parts — `ConsoleUserMenuTrigger` / `ConsoleUserMenuInitial`, `ConsoleUserMenuContent`, `ConsoleUserMenuIdentity` / `ConsoleUserMenuName` / `ConsoleUserMenuPublicId` / `ConsoleUserMenuRole`, `ConsoleUserMenuSeparator`, `ConsoleUserMenuAccountLink`, `ConsoleUserMenuLogout` / `ConsoleUserMenuLogoutButton`
- A page: `ConsolePage`, `ConsolePageHeader` / `ConsolePageHeading` / `ConsolePageTitle` / `ConsolePageDescription` / `ConsolePageContext`, `ConsolePageActions`, `ConsolePageContent`
- A section of a page: `ConsoleSections`, `ConsoleSection`, `ConsoleSectionHeader` / `ConsoleSectionHeading` / `ConsoleSectionTitle` / `ConsoleSectionDescription`, `ConsoleSectionActions`
- The skeletons: `ConsoleLayoutSkeleton`, `ConsoleSidebarSkeleton`, `ConsoleHeaderSkeleton`, `ConsoleHeaderUserSkeleton`

### `@publira/layouts/auth-screen` — the authentication screens

`AuthScreen` and its parts — `AuthScreenMain`, `AuthScreenPanel`, `AuthScreenPattern`, `AuthScreenHeader`, `AuthScreenTitle`, `AuthScreenTagline`, `AuthScreenBody`, `AuthScreenText`, `AuthScreenNote`, `AuthScreenFooter`. The split the sign-in, sign-up, password, verification, and invitation screens of all three apps are laid out in: the form in `AuthScreenMain`, and from `lg` up a second half in `AuthScreenPanel`, which `AuthScreenPattern` fills with fixed geometry.

### `@publira/layouts/navigation`

- `isCurrentPath(pathname, href, allHrefs?)`: whether a navigation link is the current one — `href` is the pathname or a prefix of it, unless another of `allHrefs` is a longer prefix, in which case that more specific item owns the active state
- `toConsolePathname(pathname)`: the path a console's navigation hrefs are written against, from a value read out of `usePathname()`. It drops the `[tenant_id]` segment `web-admin`'s proxy rewrites in front of every path, so the item that renders as current is the same before and after hydration

### `styles.css`

The stylesheet the layouts' classes are defined in, loaded once from the app's global CSS.

## Usage

```css
@import "@publira/layouts/styles.css";
```

```tsx
import {
  SiteLayout,
  SiteLayoutBrand,
  SiteLayoutFooter,
  SiteLayoutFooterContent,
  SiteLayoutFooterNote,
  SiteLayoutHeader,
  SiteLayoutMain,
} from "@publira/layouts";

export default function Page() {
  return (
    <SiteLayout>
      <SiteLayoutHeader>
        <SiteLayoutBrand href="/">Publira</SiteLayoutBrand>
      </SiteLayoutHeader>
      <SiteLayoutMain>content</SiteLayoutMain>
      <SiteLayoutFooter>
        <SiteLayoutFooterContent>
          <SiteLayoutFooterNote>Crafted for calm reading.</SiteLayoutFooterNote>
        </SiteLayoutFooterContent>
      </SiteLayoutFooter>
    </SiteLayout>
  );
}
```

The console layout is composed the same way. `web-platform`'s `components/platform-layout.tsx` and `web-admin`'s `components/admin-layout.tsx` fill the slots from their own catalogs and sessions:

```tsx
import {
  ConsoleHeader,
  ConsoleHeaderActions,
  ConsoleHeaderContext,
  ConsoleHeaderLabel,
  ConsoleHeaderText,
  ConsoleLayout,
  ConsoleLayoutContent,
  ConsoleLayoutMain,
  ConsoleSidebar,
  ConsoleSidebarBrand,
  ConsoleSidebarBrandName,
  ConsoleSidebarContext,
} from "@publira/layouts/admin";

export const PlatformLayout = ({ children }: { children: ReactNode }) => (
  <ConsoleLayout>
    <ConsoleSidebar>
      <ConsoleSidebarBrand>
        <ConsoleSidebarBrandName>Publira</ConsoleSidebarBrandName>
      </ConsoleSidebarBrand>
      <ConsoleSidebarContext>Platform Console</ConsoleSidebarContext>
      <PlatformNavigation />
    </ConsoleSidebar>
    <ConsoleLayoutContent>
      <ConsoleHeader>
        <ConsoleHeaderContext>
          <ConsoleHeaderText>
            <ConsoleHeaderLabel>Cross-tenant operations</ConsoleHeaderLabel>
          </ConsoleHeaderText>
        </ConsoleHeaderContext>
        <ConsoleHeaderActions>
          <PlatformUser />
        </ConsoleHeaderActions>
      </ConsoleHeader>
      <ConsoleLayoutMain>{children}</ConsoleLayoutMain>
    </ConsoleLayoutContent>
  </ConsoleLayout>
);
```

## Build

```bash
pnpm build --filter @publira/layouts
```
