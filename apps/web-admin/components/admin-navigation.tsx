import {
  ChartIcon,
  CollectionIcon,
  CommentIcon,
  DashboardIcon,
  SettingsIcon,
} from "@publira/icons";
import {
  ConsoleSidebarNavigation,
  ConsoleSidebarNavigationItem,
  ConsoleSidebarNavigationItemHeading,
  ConsoleSidebarNavigationItemIcon,
  ConsoleSidebarNavigationItemLabel,
  ConsoleSidebarNavigationItems,
  ConsoleSidebarNavigationSection,
  ConsoleSidebarNavigationTitle,
} from "@publira/layouts/admin";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "./message";
import { PendingCommentBadge } from "./pending-comment-badge";
import { PendingCommentBadgeErrorCatch } from "./pending-comment-badge-error-catch";

/**
 * Every href rendered below, in the order it appears.
 *
 * The navigation needs the whole set to decide which of two matching items is
 * the current page — a broader entry leaves the mark to a more specific one —
 * and an item added below has to be added here too, or it will share the mark
 * with the entry whose path it sits under.
 */
const hrefs = [
  "/",
  "/labels",
  "/creators",
  "/genres",
  "/series",
  "/pages",
  "/announcements",
  "/access-tickets",
  "/comments",
  "/engagement",
  "/audit-logs",
  "/settings",
];

export const AdminNavigation = () => (
  <ConsoleSidebarNavigation hrefs={hrefs}>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
          <Message message="admin.nav.operations" />
        </Suspense>
      </ConsoleSidebarNavigationTitle>
      <ConsoleSidebarNavigationItems>
        <ConsoleSidebarNavigationItem href="/">
          <ConsoleSidebarNavigationItemIcon>
            <DashboardIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.nav.dashboard_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/labels">
          <ConsoleSidebarNavigationItemIcon>
            <CollectionIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.nav.labels_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/creators">
          <ConsoleSidebarNavigationItemIcon>
            <CollectionIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.nav.creators_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/genres">
          <ConsoleSidebarNavigationItemIcon>
            <CollectionIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                <Message message="admin.nav.genres_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/series">
          <ConsoleSidebarNavigationItemIcon>
            <CollectionIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.nav.series_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/pages">
          <ConsoleSidebarNavigationItemIcon>
            <CollectionIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.nav.pages_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/announcements">
          <ConsoleSidebarNavigationItemIcon>
            <CollectionIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.nav.announcements_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/access-tickets">
          <ConsoleSidebarNavigationItemIcon>
            <CollectionIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="admin.nav.access_tickets_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/comments">
          <ConsoleSidebarNavigationItemIcon>
            <CommentIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.nav.comments_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
            {/* The queue size rides on the entry itself so a backlog is
                visible from whichever screen the operator happens to be on. */}
            <PendingCommentBadgeErrorCatch>
              <Suspense fallback={null}>
                <PendingCommentBadge />
              </Suspense>
            </PendingCommentBadgeErrorCatch>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/engagement">
          <ConsoleSidebarNavigationItemIcon>
            <ChartIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.nav.engagement_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
          <Message message="admin.nav.administration" />
        </Suspense>
      </ConsoleSidebarNavigationTitle>
      <ConsoleSidebarNavigationItems>
        <ConsoleSidebarNavigationItem href="/audit-logs">
          <ConsoleSidebarNavigationItemIcon>
            <CollectionIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.nav.audit_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/settings">
          <ConsoleSidebarNavigationItemIcon>
            <SettingsIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.nav.settings_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
  </ConsoleSidebarNavigation>
);
