import {
  ActivityIcon,
  BellIcon,
  BookOpenIcon,
  ChartIcon,
  CoinsIcon,
  CollectionIcon,
  CommentIcon,
  CreditCardIcon,
  DashboardIcon,
  FileTextIcon,
  HeartIcon,
  IdCardIcon,
  ImageIcon,
  KeyRoundIcon,
  LinkIcon,
  MailIcon,
  MegaphoneIcon,
  PaletteIcon,
  PenLineIcon,
  ReceiptIcon,
  RepeatIcon,
  ScrollTextIcon,
  SendIcon,
  SettingsIcon,
  ShapesIcon,
  TagIcon,
  TicketIcon,
  TrendingUpIcon,
  UserIcon,
  UsersIcon,
} from "@publira/icons";
import * as ConsoleSidebar from "@publira/layouts/admin/console-sidebar";
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
  "/campaign-banners",
  "/readers",
  "/comments",
  "/contact-messages",
  "/access-tickets",
  "/analytics/revenue",
  "/analytics/audience",
  "/analytics/episodes",
  "/analytics/cohorts",
  "/royalties",
  "/purchases",
  "/subscription-plans",
  "/integrations/payment",
  "/integrations/email",
  "/integrations/mobile-push",
  "/integrations/app-links",
  "/integrations/sign-in",
  "/integrations/google-tag",
  "/members",
  "/branding",
  "/audit-logs",
  "/settings",
];

export const AdminNavigation = () => (
  <ConsoleSidebar.Navigation hrefs={hrefs}>
    <ConsoleSidebar.NavigationSection>
      <ConsoleSidebar.NavigationItems>
        <ConsoleSidebar.NavigationItem href="/">
          <ConsoleSidebar.NavigationItemIcon>
            <DashboardIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.nav.dashboard_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
      </ConsoleSidebar.NavigationItems>
    </ConsoleSidebar.NavigationSection>
    <ConsoleSidebar.NavigationSection>
      <ConsoleSidebar.NavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
          <Message message="admin.nav.catalog" />
        </Suspense>
      </ConsoleSidebar.NavigationTitle>
      <ConsoleSidebar.NavigationItems>
        <ConsoleSidebar.NavigationItem href="/series">
          <ConsoleSidebar.NavigationItemIcon>
            <CollectionIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.nav.series_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/labels">
          <ConsoleSidebar.NavigationItemIcon>
            <TagIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.nav.labels_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/creators">
          <ConsoleSidebar.NavigationItemIcon>
            <PenLineIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.nav.creators_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/creator-roles">
          <ConsoleSidebar.NavigationItemIcon>
            <IdCardIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.nav.creator_roles_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/genres">
          <ConsoleSidebar.NavigationItemIcon>
            <ShapesIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                <Message message="admin.nav.genres_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
      </ConsoleSidebar.NavigationItems>
    </ConsoleSidebar.NavigationSection>
    <ConsoleSidebar.NavigationSection>
      <ConsoleSidebar.NavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-10" />}>
          <Message message="admin.nav.site" />
        </Suspense>
      </ConsoleSidebar.NavigationTitle>
      <ConsoleSidebar.NavigationItems>
        <ConsoleSidebar.NavigationItem href="/pages">
          <ConsoleSidebar.NavigationItemIcon>
            <FileTextIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.nav.pages_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/announcements">
          <ConsoleSidebar.NavigationItemIcon>
            <MegaphoneIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.nav.announcements_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/campaign-banners">
          <ConsoleSidebar.NavigationItemIcon>
            <ImageIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="admin.nav.campaign_banners_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
      </ConsoleSidebar.NavigationItems>
    </ConsoleSidebar.NavigationSection>
    <ConsoleSidebar.NavigationSection>
      <ConsoleSidebar.NavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
          <Message message="admin.nav.readers" />
        </Suspense>
      </ConsoleSidebar.NavigationTitle>
      <ConsoleSidebar.NavigationItems>
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebar.NavigationItem href="/readers">
              <ConsoleSidebar.NavigationItemIcon>
                <UserIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.nav.readers_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
          </TenantAdminOnly>
        </Suspense>
        <ConsoleSidebar.NavigationItem href="/comments">
          <ConsoleSidebar.NavigationItemIcon>
            <CommentIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.nav.comments_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
            {/* The queue size rides on the entry itself so a backlog is
                visible from whichever screen the operator happens to be on. */}
            <PendingCommentBadgeErrorCatch>
              <Suspense fallback={null}>
                <PendingCommentBadge />
              </Suspense>
            </PendingCommentBadgeErrorCatch>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebar.NavigationItem href="/contact-messages">
              <ConsoleSidebar.NavigationItemIcon>
                <MailIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                    <Message message="admin.nav.contact_messages_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
            <ConsoleSidebar.NavigationItem href="/access-tickets">
              <ConsoleSidebar.NavigationItemIcon>
                <TicketIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                    <Message message="admin.nav.access_tickets_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
          </TenantAdminOnly>
        </Suspense>
      </ConsoleSidebar.NavigationItems>
    </ConsoleSidebar.NavigationSection>
    <ConsoleSidebar.NavigationSection>
      <ConsoleSidebar.NavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <Message message="admin.nav.analytics" />
        </Suspense>
      </ConsoleSidebar.NavigationTitle>
      <ConsoleSidebar.NavigationItems>
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebar.NavigationItem href="/analytics/revenue">
              <ConsoleSidebar.NavigationItemIcon>
                <TrendingUpIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.nav.revenue_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
          </TenantAdminOnly>
        </Suspense>
        <ConsoleSidebar.NavigationItem href="/analytics/audience">
          <ConsoleSidebar.NavigationItemIcon>
            <HeartIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.nav.audience_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/analytics/episodes">
          <ConsoleSidebar.NavigationItemIcon>
            <BookOpenIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.nav.episodes_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/analytics/cohorts">
          <ConsoleSidebar.NavigationItemIcon>
            <ChartIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.nav.cohorts_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
      </ConsoleSidebar.NavigationItems>
    </ConsoleSidebar.NavigationSection>
    {/* Royalties is a tenant admin's alone, so the section title goes with it
        rather than heading an empty list for anyone else. */}
    <Suspense fallback={null}>
      <TenantAdminOnly>
        <ConsoleSidebar.NavigationSection>
          <ConsoleSidebar.NavigationTitle>
            <Suspense fallback={<SkeletonLine className="h-3 w-14" />}>
              <Message message="admin.nav.reports" />
            </Suspense>
          </ConsoleSidebar.NavigationTitle>
          <ConsoleSidebar.NavigationItems>
            <ConsoleSidebar.NavigationItem href="/royalties">
              <ConsoleSidebar.NavigationItemIcon>
                <CoinsIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.nav.royalties_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
          </ConsoleSidebar.NavigationItems>
        </ConsoleSidebar.NavigationSection>
      </TenantAdminOnly>
    </Suspense>
    {/* Every entry here is a tenant admin's, so the section title goes with
        them rather than heading an empty list for anyone else. */}
    <Suspense fallback={null}>
      <TenantAdminOnly>
        <ConsoleSidebar.NavigationSection>
          <ConsoleSidebar.NavigationTitle>
            <Suspense fallback={<SkeletonLine className="h-3 w-14" />}>
              <Message message="admin.nav.payments" />
            </Suspense>
          </ConsoleSidebar.NavigationTitle>
          <ConsoleSidebar.NavigationItems>
            <ConsoleSidebar.NavigationItem href="/purchases">
              <ConsoleSidebar.NavigationItemIcon>
                <ReceiptIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.nav.purchases_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
            <ConsoleSidebar.NavigationItem href="/subscription-plans">
              <ConsoleSidebar.NavigationItemIcon>
                <RepeatIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                    <Message message="admin.nav.subscription_plans_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
            <ConsoleSidebar.NavigationItem href="/integrations/payment">
              <ConsoleSidebar.NavigationItemIcon>
                <CreditCardIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.nav.payment_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
          </ConsoleSidebar.NavigationItems>
        </ConsoleSidebar.NavigationSection>
      </TenantAdminOnly>
    </Suspense>
    <ConsoleSidebar.NavigationSection>
      <ConsoleSidebar.NavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <Message message="admin.nav.integrations" />
        </Suspense>
      </ConsoleSidebar.NavigationTitle>
      <ConsoleSidebar.NavigationItems>
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebar.NavigationItem href="/integrations/email">
              <ConsoleSidebar.NavigationItemIcon>
                <SendIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.nav.email_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
            <ConsoleSidebar.NavigationItem href="/integrations/mobile-push">
              <ConsoleSidebar.NavigationItemIcon>
                <BellIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.nav.mobile_push_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
          </TenantAdminOnly>
        </Suspense>
        <ConsoleSidebar.NavigationItem href="/integrations/app-links">
          <ConsoleSidebar.NavigationItemIcon>
            <LinkIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.nav.app_links_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebar.NavigationItem href="/integrations/sign-in">
              <ConsoleSidebar.NavigationItemIcon>
                <KeyRoundIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.nav.sign_in_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
            <ConsoleSidebar.NavigationItem href="/integrations/google-tag">
              <ConsoleSidebar.NavigationItemIcon>
                <ActivityIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.nav.google_tag_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
          </TenantAdminOnly>
        </Suspense>
      </ConsoleSidebar.NavigationItems>
    </ConsoleSidebar.NavigationSection>
    <ConsoleSidebar.NavigationSection>
      <ConsoleSidebar.NavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
          <Message message="admin.nav.administration" />
        </Suspense>
      </ConsoleSidebar.NavigationTitle>
      <ConsoleSidebar.NavigationItems>
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebar.NavigationItem href="/members">
              <ConsoleSidebar.NavigationItemIcon>
                <UsersIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.nav.members_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
          </TenantAdminOnly>
        </Suspense>
        <ConsoleSidebar.NavigationItem href="/branding">
          <ConsoleSidebar.NavigationItemIcon>
            <PaletteIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.nav.branding_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <Suspense fallback={null}>
          <TenantAdminOnly>
            <ConsoleSidebar.NavigationItem href="/audit-logs">
              <ConsoleSidebar.NavigationItemIcon>
                <ScrollTextIcon className="size-4" />
              </ConsoleSidebar.NavigationItemIcon>
              <ConsoleSidebar.NavigationItemHeading>
                <ConsoleSidebar.NavigationItemLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.nav.audit_label" />
                  </Suspense>
                </ConsoleSidebar.NavigationItemLabel>
              </ConsoleSidebar.NavigationItemHeading>
            </ConsoleSidebar.NavigationItem>
          </TenantAdminOnly>
        </Suspense>
        <ConsoleSidebar.NavigationItem href="/settings">
          <ConsoleSidebar.NavigationItemIcon>
            <SettingsIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.nav.settings_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
      </ConsoleSidebar.NavigationItems>
    </ConsoleSidebar.NavigationSection>
  </ConsoleSidebar.Navigation>
);
