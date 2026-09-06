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
import { PendingCommentBadge } from "./pending-comment-badge";

export const navigation: NavSection[] = [
  {
    id: "operations",
    items: [
      {
        description: (
          <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
            <Message message="admin.nav.dashboard_description" />
          </Suspense>
        ),
        href: "/",
        icon: DashboardIcon,
        label: (
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.nav.dashboard_label" />
          </Suspense>
        ),
      },
      {
        description: (
          <Suspense fallback={<SkeletonLine className="h-3 w-32" />}>
            <Message message="admin.nav.labels_description" />
          </Suspense>
        ),
        href: "/labels",
        icon: CollectionIcon,
        label: (
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.nav.labels_label" />
          </Suspense>
        ),
      },
      {
        description: (
          <Suspense fallback={<SkeletonLine className="h-3 w-32" />}>
            <Message message="admin.nav.creators_description" />
          </Suspense>
        ),
        href: "/creators",
        icon: CollectionIcon,
        label: (
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.nav.creators_label" />
          </Suspense>
        ),
      },
      {
        description: (
          <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
            <Message message="admin.nav.series_description" />
          </Suspense>
        ),
        href: "/series",
        icon: CollectionIcon,
        label: (
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.nav.series_label" />
          </Suspense>
        ),
      },
      {
        description: (
          <Suspense fallback={<SkeletonLine className="h-3 w-44" />}>
            <Message message="admin.nav.pages_description" />
          </Suspense>
        ),
        href: "/pages",
        icon: CollectionIcon,
        label: (
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.nav.pages_label" />
          </Suspense>
        ),
      },
      {
        description: (
          <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
            <Message message="admin.nav.announcements_description" />
          </Suspense>
        ),
        href: "/announcements",
        icon: CollectionIcon,
        label: (
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.nav.announcements_label" />
          </Suspense>
        ),
      },
      {
        description: (
          <Suspense fallback={<SkeletonLine className="h-3 w-44" />}>
            <Message message="admin.nav.access_tickets_description" />
          </Suspense>
        ),
        href: "/access-tickets",
        icon: CollectionIcon,
        label: (
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.nav.access_tickets_label" />
          </Suspense>
        ),
      },
      {
        // The queue size rides on the entry itself so a backlog is visible from
        // whichever screen the operator happens to be on.
        badge: (
          <Suspense fallback={null}>
            <PendingCommentBadge />
          </Suspense>
        ),
        description: (
          <Suspense fallback={<SkeletonLine className="h-3 w-44" />}>
            <Message message="admin.nav.comments_description" />
          </Suspense>
        ),
        href: "/comments",
        icon: CommentIcon,
        label: (
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.nav.comments_label" />
          </Suspense>
        ),
      },
      {
        description: (
          <Suspense fallback={<SkeletonLine className="h-3 w-44" />}>
            <Message message="admin.nav.engagement_description" />
          </Suspense>
        ),
        href: "/engagement",
        icon: ChartIcon,
        label: (
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.nav.engagement_label" />
          </Suspense>
        ),
      },
    ],
    title: (
      <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
        <Message message="admin.nav.operations" />
      </Suspense>
    ),
  },
  {
    id: "administration",
    items: [
      {
        description: (
          <Suspense fallback={<SkeletonLine className="h-3 w-36" />}>
            <Message message="admin.nav.audit_description" />
          </Suspense>
        ),
        href: "/audit-logs",
        icon: CollectionIcon,
        label: (
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.nav.audit_label" />
          </Suspense>
        ),
      },
      {
        description: (
          <Suspense fallback={<SkeletonLine className="h-3 w-44" />}>
            <Message message="admin.nav.settings_description" />
          </Suspense>
        ),
        href: "/settings",
        icon: SettingsIcon,
        label: (
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.nav.settings_label" />
          </Suspense>
        ),
      },
    ],
    title: (
      <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
        <Message message="admin.nav.administration" />
      </Suspense>
    ),
  },
];
