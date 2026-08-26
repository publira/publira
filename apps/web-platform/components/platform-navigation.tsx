import { CollectionIcon, DashboardIcon, SettingsIcon } from "@publira/icons";
import type { NavSection } from "@publira/layouts/navigation";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "./message";
import type { PlatformMessageKey } from "./message";

const navText = (message: PlatformMessageKey, skeletonClassName: string) => (
  <Suspense fallback={<SkeletonLine className={skeletonClassName} />}>
    <Message message={message} />
  </Suspense>
);

export const navigation: NavSection[] = [
  {
    id: "overview",
    items: [
      {
        description: navText("platform.nav.dashboard_description", "h-3 w-40"),
        href: "/",
        icon: DashboardIcon,
        label: navText("platform.nav.dashboard_label", "h-4 w-24"),
      },
    ],
    title: navText("platform.nav.overview", "h-3 w-16"),
  },
  {
    id: "tenants",
    items: [
      {
        description: navText(
          "platform.nav.tenants_list_description",
          "h-3 w-44"
        ),
        href: "/tenants",
        icon: CollectionIcon,
        label: navText("platform.nav.tenants_list_label", "h-4 w-20"),
      },
      {
        description: navText(
          "platform.nav.tenants_create_description",
          "h-3 w-40"
        ),
        href: "/tenants/new",
        icon: CollectionIcon,
        label: navText("platform.nav.tenants_create_label", "h-4 w-20"),
      },
    ],
    title: navText("platform.nav.tenants_section", "h-3 w-16"),
  },
  {
    id: "governance",
    items: [
      {
        description: navText("platform.nav.settings_description", "h-3 w-48"),
        href: "/settings/general",
        icon: SettingsIcon,
        label: navText("platform.nav.settings_label", "h-4 w-12"),
      },
      {
        description: navText("platform.nav.operators_description", "h-3 w-44"),
        href: "/operators",
        icon: SettingsIcon,
        label: navText("platform.nav.operators_label", "h-4 w-28"),
      },
      {
        description: navText("platform.nav.users_description", "h-3 w-40"),
        href: "/users",
        icon: SettingsIcon,
        label: navText("platform.nav.users_label", "h-4 w-20"),
      },
      {
        description: navText("platform.nav.audit_description", "h-3 w-44"),
        href: "/audit-logs",
        icon: SettingsIcon,
        label: navText("platform.nav.audit_label", "h-4 w-16"),
      },
    ],
    title: navText("platform.nav.governance", "h-3 w-20"),
  },
];
