import {
  BellIcon,
  ChartIcon,
  CoinsIcon,
  CollectionIcon,
  CommentIcon,
  CreditCardIcon,
  DashboardIcon,
  FileTextIcon,
  IdCardIcon,
  KeyRoundIcon,
  LinkIcon,
  MailIcon,
  MegaphoneIcon,
  PaletteIcon,
  PenLineIcon,
  ScrollTextIcon,
  SendIcon,
  SettingsIcon,
  ShapesIcon,
  TagIcon,
  TicketIcon,
  UserIcon,
  UsersIcon,
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
import { TenantAdminOnly } from "./tenant-role-gate";

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
  "/series",
  "/labels",
  "/creators",
  "/creator-roles",
  "/genres",
  "/pages",
  "/announcements",
  "/readers",
  "/comments",
  "/contact-messages",
  "/access-tickets",
  "/engagement",
  "/royalties",
  "/integrations/email",
  "/integrations/payment",
  "/integrations/mobile-push",
  "/integrations/app-links",
  "/integrations/sign-in",
  "/members",
  "/branding",
  "/audit-logs",
  "/settings",
];

export const AdminNavigation = () => (
  <ConsoleSidebarNavigation hrefs={hrefs}>
    <ConsoleSidebarNavigationSection>
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
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
          <Message message="admin.nav.catalog" />
        </Suspense>
      </ConsoleSidebarNavigationTitle>
      <ConsoleSidebarNavigationItems>
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
        <ConsoleSidebarNavigationItem href="/labels">
          <ConsoleSidebarNavigationItemIcon>
            <TagIcon className="size-4" />
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
            <PenLineIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.nav.creators_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/creator-roles">
          <ConsoleSidebarNavigationItemIcon>
            <IdCardIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.nav.creator_roles_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/genres">
          <ConsoleSidebarNavigationItemIcon>
            <ShapesIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                <Message message="admin.nav.genres_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-10" />}>
          <Message message="admin.nav.site" />
        </Suspense>
      </ConsoleSidebarNavigationTitle>
      <ConsoleSidebarNavigationItems>
        <ConsoleSidebarNavigationItem href="/pages">
          <ConsoleSidebarNavigationItemIcon>
            <FileTextIcon className="size-4" />
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
            <MegaphoneIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.nav.announcements_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
          <Message message="admin.nav.readers" />
        </Suspense>
      </ConsoleSidebarNavigationTitle>
      <ConsoleSidebarNavigationItems>
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebarNavigationItem href="/readers">
              <ConsoleSidebarNavigationItemIcon>
                <UserIcon className="size-4" />
              </ConsoleSidebarNavigationItemIcon>
              <ConsoleSidebarNavigationItemHeading>
                <ConsoleSidebarNavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.nav.readers_label" />
                  </Suspense>
                </ConsoleSidebarNavigationItemLabel>
              </ConsoleSidebarNavigationItemHeading>
            </ConsoleSidebarNavigationItem>
          </TenantAdminOnly>
        </Suspense>
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
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebarNavigationItem href="/contact-messages">
              <ConsoleSidebarNavigationItemIcon>
                <MailIcon className="size-4" />
              </ConsoleSidebarNavigationItemIcon>
              <ConsoleSidebarNavigationItemHeading>
                <ConsoleSidebarNavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                    <Message message="admin.nav.contact_messages_label" />
                  </Suspense>
                </ConsoleSidebarNavigationItemLabel>
              </ConsoleSidebarNavigationItemHeading>
            </ConsoleSidebarNavigationItem>
            <ConsoleSidebarNavigationItem href="/access-tickets">
              <ConsoleSidebarNavigationItemIcon>
                <TicketIcon className="size-4" />
              </ConsoleSidebarNavigationItemIcon>
              <ConsoleSidebarNavigationItemHeading>
                <ConsoleSidebarNavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                    <Message message="admin.nav.access_tickets_label" />
                  </Suspense>
                </ConsoleSidebarNavigationItemLabel>
              </ConsoleSidebarNavigationItemHeading>
            </ConsoleSidebarNavigationItem>
          </TenantAdminOnly>
        </Suspense>
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-14" />}>
          <Message message="admin.nav.reports" />
        </Suspense>
      </ConsoleSidebarNavigationTitle>
      <ConsoleSidebarNavigationItems>
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
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebarNavigationItem href="/royalties">
              <ConsoleSidebarNavigationItemIcon>
                <CoinsIcon className="size-4" />
              </ConsoleSidebarNavigationItemIcon>
              <ConsoleSidebarNavigationItemHeading>
                <ConsoleSidebarNavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.nav.royalties_label" />
                  </Suspense>
                </ConsoleSidebarNavigationItemLabel>
              </ConsoleSidebarNavigationItemHeading>
            </ConsoleSidebarNavigationItem>
          </TenantAdminOnly>
        </Suspense>
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <Message message="admin.nav.integrations" />
        </Suspense>
      </ConsoleSidebarNavigationTitle>
      <ConsoleSidebarNavigationItems>
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebarNavigationItem href="/integrations/email">
              <ConsoleSidebarNavigationItemIcon>
                <SendIcon className="size-4" />
              </ConsoleSidebarNavigationItemIcon>
              <ConsoleSidebarNavigationItemHeading>
                <ConsoleSidebarNavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.nav.email_label" />
                  </Suspense>
                </ConsoleSidebarNavigationItemLabel>
              </ConsoleSidebarNavigationItemHeading>
            </ConsoleSidebarNavigationItem>
            <ConsoleSidebarNavigationItem href="/integrations/payment">
              <ConsoleSidebarNavigationItemIcon>
                <CreditCardIcon className="size-4" />
              </ConsoleSidebarNavigationItemIcon>
              <ConsoleSidebarNavigationItemHeading>
                <ConsoleSidebarNavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.nav.payment_label" />
                  </Suspense>
                </ConsoleSidebarNavigationItemLabel>
              </ConsoleSidebarNavigationItemHeading>
            </ConsoleSidebarNavigationItem>
            <ConsoleSidebarNavigationItem href="/integrations/mobile-push">
              <ConsoleSidebarNavigationItemIcon>
                <BellIcon className="size-4" />
              </ConsoleSidebarNavigationItemIcon>
              <ConsoleSidebarNavigationItemHeading>
                <ConsoleSidebarNavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.nav.mobile_push_label" />
                  </Suspense>
                </ConsoleSidebarNavigationItemLabel>
              </ConsoleSidebarNavigationItemHeading>
            </ConsoleSidebarNavigationItem>
          </TenantAdminOnly>
        </Suspense>
        <ConsoleSidebarNavigationItem href="/integrations/app-links">
          <ConsoleSidebarNavigationItemIcon>
            <LinkIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.nav.app_links_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebarNavigationItem href="/integrations/sign-in">
              <ConsoleSidebarNavigationItemIcon>
                <KeyRoundIcon className="size-4" />
              </ConsoleSidebarNavigationItemIcon>
              <ConsoleSidebarNavigationItemHeading>
                <ConsoleSidebarNavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.nav.sign_in_label" />
                  </Suspense>
                </ConsoleSidebarNavigationItemLabel>
              </ConsoleSidebarNavigationItemHeading>
            </ConsoleSidebarNavigationItem>
          </TenantAdminOnly>
        </Suspense>
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
          <Message message="admin.nav.administration" />
        </Suspense>
      </ConsoleSidebarNavigationTitle>
      <ConsoleSidebarNavigationItems>
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebarNavigationItem href="/members">
              <ConsoleSidebarNavigationItemIcon>
                <UsersIcon className="size-4" />
              </ConsoleSidebarNavigationItemIcon>
              <ConsoleSidebarNavigationItemHeading>
                <ConsoleSidebarNavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.nav.members_label" />
                  </Suspense>
                </ConsoleSidebarNavigationItemLabel>
              </ConsoleSidebarNavigationItemHeading>
            </ConsoleSidebarNavigationItem>
          </TenantAdminOnly>
        </Suspense>
        <ConsoleSidebarNavigationItem href="/branding">
          <ConsoleSidebarNavigationItemIcon>
            <PaletteIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.nav.branding_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebarNavigationItem href="/audit-logs">
              <ConsoleSidebarNavigationItemIcon>
                <ScrollTextIcon className="size-4" />
              </ConsoleSidebarNavigationItemIcon>
              <ConsoleSidebarNavigationItemHeading>
                <ConsoleSidebarNavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.nav.audit_label" />
                  </Suspense>
                </ConsoleSidebarNavigationItemLabel>
              </ConsoleSidebarNavigationItemHeading>
            </ConsoleSidebarNavigationItem>
          </TenantAdminOnly>
        </Suspense>
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
