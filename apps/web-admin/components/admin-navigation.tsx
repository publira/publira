import {
  ChartIcon,
  CollectionIcon,
  CommentIcon,
  DashboardIcon,
  SettingsIcon,
} from "@publira/icons";
import type { NavSection } from "@publira/layouts/navigation";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "./message";
import type { AdminMessageKey } from "./message";
import { PendingCommentBadge } from "./pending-comment-badge";
import { PendingCommentBadgeErrorCatch } from "./pending-comment-badge-error-catch";

const navLabel = (message: AdminMessageKey, skeletonClassName: string) => (
  <Suspense fallback={<SkeletonLine className={skeletonClassName} />}>
    <Message message={message} />
  </Suspense>
);

export const navigation: NavSection[] = [
  {
    id: "operations",
    items: [
      {
        href: "/",
        icon: DashboardIcon,
        label: navLabel("admin.nav.dashboard_label", "h-4 w-24"),
      },
      {
        href: "/labels",
        icon: CollectionIcon,
        label: navLabel("admin.nav.labels_label", "h-4 w-16"),
      },
      {
        href: "/creators",
        icon: CollectionIcon,
        label: navLabel("admin.nav.creators_label", "h-4 w-12"),
      },
      {
        href: "/series",
        icon: CollectionIcon,
        label: navLabel("admin.nav.series_label", "h-4 w-20"),
      },
      {
        href: "/pages",
        icon: CollectionIcon,
        label: navLabel("admin.nav.pages_label", "h-4 w-16"),
      },
      {
        href: "/announcements",
        icon: CollectionIcon,
        label: navLabel("admin.nav.announcements_label", "h-4 w-20"),
      },
      {
        href: "/access-tickets",
        icon: CollectionIcon,
        label: navLabel("admin.nav.access_tickets_label", "h-4 w-28"),
      },
      {
        // The queue size rides on the entry itself so a backlog is visible from
        // whichever screen the operator happens to be on.
        badge: (
          <PendingCommentBadgeErrorCatch>
            <Suspense fallback={null}>
              <PendingCommentBadge />
            </Suspense>
          </PendingCommentBadgeErrorCatch>
        ),
        href: "/comments",
        icon: CommentIcon,
        label: navLabel("admin.nav.comments_label", "h-4 w-20"),
      },
      {
        href: "/engagement",
        icon: ChartIcon,
        label: navLabel("admin.nav.engagement_label", "h-4 w-24"),
      },
    ],
    title: navLabel("admin.nav.operations", "h-3 w-12"),
  },
  {
    id: "administration",
    items: [
      {
        href: "/audit-logs",
        icon: CollectionIcon,
        label: navLabel("admin.nav.audit_label", "h-4 w-16"),
      },
      {
        href: "/settings",
        icon: SettingsIcon,
        label: navLabel("admin.nav.settings_label", "h-4 w-12"),
      },
    ],
    title: navLabel("admin.nav.administration", "h-3 w-12"),
  },
];
