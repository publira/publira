import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";

import { hasTenantDarkTheme } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import * as ThemeSwitchControls from "./theme-switch-controls";

/**
 * The reader's choice of light, dark, or the system setting, offered only by a
 * tenant that has saved a dark palette: without one `/theme.css` has a single
 * palette, and every choice would paint the same page.
 *
 * Whether the tenant has one is a tenant read, so the header renders this
 * inside a `<Suspense>` with `ThemeSwitch.Skeleton`, and a tenant without a
 * dark palette sees the skeleton give way to nothing.
 */
const ThemeSwitch = async () => {
  const tenantId = await getTenantId();

  return (await hasTenantDarkTheme(tenantId)) ? (
    <ThemeSwitchControls.Root />
  ) : null;
};

/** The drawer's row for the same choice, under the same condition. */
const ThemeSwitchDisclosure = async () => {
  const tenantId = await getTenantId();

  return (await hasTenantDarkTheme(tenantId)) ? (
    <ThemeSwitchControls.Disclosure />
  ) : null;
};

/** Same footprint as the rendered control, so the header does not shift. */
const ThemeSwitchSkeleton = () => (
  <Skeleton className="size-9 pointer-coarse:size-11" />
);

/**
 * Stands in for the drawer's row at the height of its trigger. It is not a
 * button, so nothing reaches a control that may never appear.
 */
const ThemeSwitchDisclosureSkeleton = () => (
  <div aria-hidden="true" className="px-3 py-2 text-sm pointer-coarse:py-3">
    <SkeletonLine className="h-4 w-16" />
  </div>
);

export {
  ThemeSwitch as Root,
  ThemeSwitchDisclosure as Disclosure,
  ThemeSwitchDisclosureSkeleton as DisclosureSkeleton,
  ThemeSwitchSkeleton as Skeleton,
};
