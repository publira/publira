# layouts

The package that provides the layout components reused across several web apps.

## What it provides

Every subpath is its own build entry, so an app imports the family it needs without pulling the others into the same module graph. Each subpath but `navigation` holds one component tree, exported as a namespace in the form `@publira/ui-components` uses: the caller writes `import * as SiteLayout from "@publira/layouts/site-layout"` and then `<SiteLayout.Root>`, `<SiteLayout.Header>`. A tree rendered inside another — the storefront's drawer and user menu, the console sidebar's navigation — is reached through the outer namespace under the longer part name (`SiteLayout.MobileNavigationLink`, `ConsoleSidebar.NavigationItem`).

### `@publira/layouts/site-layout` — the site layout

The storefront's frame, as the `SiteLayout` namespace.

- The frame: `Root`, `Header`, `Main`, `Footer`
- The header: `Brand`, `Nav` / `NavLink`, `HeaderSearch`, `HeaderWideControls`, `HeaderActions`, and the actions a signed-out reader sees — `Actions` / `PrimaryAction` / `SecondaryAction`
- The user menu: `UserMenu` and its parts — `UserMenuTrigger`, `UserMenuContent`, `UserMenuAccount`, `UserMenuMyPageLink`, `UserMenuAnnouncementsLink`, `UserMenuSeparator`, `UserMenuLogout` / `UserMenuLogoutButton`
- The banner above the header, for the one announcement a reader has to see first: `Banner`, `BannerContent`, `BannerTitle`, `BannerDescription`, `BannerLink`, `BannerActions`
- The phone header's drawer: `MobileNavigation` and its parts — `MobileNavigationOpenButton`, `MobileNavigationCloseButton`, `MobileNavigationHeader`, `MobileNavigationTitle`, `MobileNavigationLinks` / `MobileNavigationLink`, `MobileNavigationSearch`, `MobileNavigationDisclosure` / `MobileNavigationDisclosureTrigger` / `MobileNavigationDisclosurePanel`, `MobileNavigationActions` / `MobileNavigationPrimaryAction` / `MobileNavigationSecondaryAction`
- The footer: `FooterContent`, `FooterNote`, `FooterLinks` / `FooterLink`, `FooterCopyright`
- The skeletons a `<Suspense>` shows while a part streams in: `BrandSkeleton`, `NavSkeleton`, `HeaderActionsSkeleton`, `FooterSkeleton`

### `@publira/layouts/admin/*` — the console layout

The shell `web-admin` and `web-platform` share: a sidebar, a 48px header, and the page and section frames inside it, one namespace per subpath.

| Subpath | Namespace | Parts |
| --- | --- | --- |
| `admin/console-layout` | `ConsoleLayout` | The shell: `Root`, `Content`, `Main`, and the drawer the phone opens the sidebar in — `MobileNavigation` / `MobileNavigationOpenButton` / `MobileNavigationCloseButton` |
| `admin/console-sidebar` | `ConsoleSidebar` | `Root`, `Brand` / `BrandName`, `Context`, and its navigation — `Navigation`, `NavigationSection` / `NavigationTitle`, `NavigationItems` / `NavigationItem` / `NavigationItemIcon` / `NavigationItemHeading` / `NavigationItemLabel` |
| `admin/console-header` | `ConsoleHeader` | `Root`, `Context` / `Text` / `Label`, `Actions`, and the skeletons `Skeleton` and `UserSkeleton` |
| `admin/console-user-menu` | `ConsoleUserMenu` | The account menu in the header's actions: `Root`, `Trigger` / `Initial`, `Content`, `Identity` / `Name` / `PublicId` / `Role`, `Separator`, `AccountLink`, `Logout` / `LogoutButton` |
| `admin/console-page` | `ConsolePage` | A page: `Root`, `Header` / `Heading` / `Title` / `Description` / `Context`, `Actions`, `Content` |
| `admin/console-section` | `ConsoleSection` | A section of a page: `Stack`, the column several sections sit in, then `Root`, `Header` / `Heading` / `Title` / `Description`, `Actions` |

### `@publira/layouts/auth-screen` — the authentication screens

The `AuthScreen` namespace: `Root`, `Main`, `Panel`, `Pattern`, `Header`, `Title`, `Tagline`, `Body`, `Text`, `Note`, `Footer`. The split the sign-in, sign-up, password, verification, and invitation screens of all three apps are laid out in: the form in `AuthScreen.Main`, and from `lg` up a second half in `AuthScreen.Panel`, which `AuthScreen.Pattern` fills with fixed geometry.

### `@publira/layouts/navigation`

The helpers, as plain named exports:

- `isCurrentPath(pathname, href, allHrefs?)`: whether a navigation link is the current one — `href` is the pathname or a prefix of it, unless another of `allHrefs` is a longer prefix, in which case that more specific item owns the active state
- `toConsolePathname(pathname)`: the path a console's navigation hrefs are written against, from a value read out of `usePathname()`. It drops the `[tenant_id]` segment `web-admin`'s proxy rewrites in front of every path, so the item that renders as current is the same before and after hydration

### `styles.css`

The stylesheet the layouts' classes are defined in, loaded once from the app's global CSS.

## Breakpoints

What each layout draws at each width. `md` and `lg` are the only two steps: `@publira/brand/theme.css` sets `md` to 744px, the narrowest tablet held upright, and `lg` is Tailwind's 1024px, the narrowest tablet held sideways.

| Width | Who holds it | Storefront header | Console |
| --- | --- | --- | --- |
| Below `md` (< 744px) | A phone, either way up | Brand, account icons, and the menu button; the catalog field, the navigation, the language, and the signed-out actions are in the drawer | The floating menu button, opening the sidebar in a drawer |
| `md` to `lg` (744–1023px) | A tablet held upright | Brand, navigation, a catalog field up to 12rem, the language, and the account controls, on one row | The sidebar |
| From `lg` (≥ 1024px) | A tablet held sideways, and a desktop | The same row, with a catalog field up to 16rem | The sidebar |

Touch is a separate axis from width, because a phone, a tablet, and a touch laptop all have one. Where the pointer is coarse (`pointer-coarse:`), every control the layouts draw — a header icon, a navigation link, a menu or drawer row, a sidebar item — is at least 44px tall, and the same holds for `Button` and `LinkButton` from `@publira/ui-components`. Nothing the layouts draw opens on hover: every menu and popover opens on a press, and `hover:` styles in Tailwind v4 apply only where the device can hover.

## Usage

```css
@import "@publira/layouts/styles.css";
```

```tsx
import * as SiteLayout from "@publira/layouts/site-layout";

export default function Page() {
  return (
    <SiteLayout.Root>
      <SiteLayout.Header>
        <SiteLayout.Brand href="/">Publira</SiteLayout.Brand>
      </SiteLayout.Header>
      <SiteLayout.Main>content</SiteLayout.Main>
      <SiteLayout.Footer>
        <SiteLayout.FooterContent>
          <SiteLayout.FooterNote>
            Crafted for calm reading.
          </SiteLayout.FooterNote>
        </SiteLayout.FooterContent>
      </SiteLayout.Footer>
    </SiteLayout.Root>
  );
}
```

The console layout is composed the same way. `web-platform`'s `components/platform-layout.tsx` and `web-admin`'s `components/admin-layout.tsx` fill the slots from their own catalogs and sessions:

```tsx
import * as ConsoleHeader from "@publira/layouts/admin/console-header";
import * as ConsoleLayout from "@publira/layouts/admin/console-layout";
import * as ConsoleSidebar from "@publira/layouts/admin/console-sidebar";

export const PlatformLayout = ({ children }: { children: ReactNode }) => (
  <ConsoleLayout.Root>
    <ConsoleSidebar.Root>
      <ConsoleSidebar.Brand>
        <ConsoleSidebar.BrandName>Publira</ConsoleSidebar.BrandName>
      </ConsoleSidebar.Brand>
      <ConsoleSidebar.Context>Platform Console</ConsoleSidebar.Context>
      <PlatformNavigation />
    </ConsoleSidebar.Root>
    <ConsoleLayout.Content>
      <ConsoleHeader.Root>
        <ConsoleHeader.Context>
          <ConsoleHeader.Text>
            <ConsoleHeader.Label>Cross-tenant operations</ConsoleHeader.Label>
          </ConsoleHeader.Text>
        </ConsoleHeader.Context>
        <ConsoleHeader.Actions>
          <PlatformUser />
        </ConsoleHeader.Actions>
      </ConsoleHeader.Root>
      <ConsoleLayout.Main>{children}</ConsoleLayout.Main>
    </ConsoleLayout.Content>
  </ConsoleLayout.Root>
);
```

## Build

```bash
pnpm build --filter @publira/layouts
```
