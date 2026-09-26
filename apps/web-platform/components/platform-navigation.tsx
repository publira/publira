import {
  ArchiveIcon,
  BellIcon,
  BuildingIcon,
  CommentIcon,
  DashboardIcon,
  ImageIcon,
  LockIcon,
  MailIcon,
  PlusIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldUserIcon,
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

/**
 * Every href rendered below, in the order it appears.
 *
 * The navigation needs the whole set to decide which of two matching items is
 * the current page: without `/tenants/new` here, the tenant list would take the
 * mark on the screen that creates one. An item added below has to be added here
 * too.
 */
const hrefs = [
  "/",
  "/tenants",
  "/tenants/new",
  "/general",
  "/services/email",
  "/services/storage",
  "/services/webpush",
  "/policies/security",
  "/policies/community",
  "/policies/retention",
  "/operators",
  "/users",
  "/audit-logs",
];

export const PlatformNavigation = () => (
  <ConsoleSidebarNavigation hrefs={hrefs}>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <Message message="platform.nav.overview" />
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
                <Message message="platform.nav.dashboard_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <Message message="platform.nav.tenants_section" />
        </Suspense>
      </ConsoleSidebarNavigationTitle>
      <ConsoleSidebarNavigationItems>
        <ConsoleSidebarNavigationItem href="/tenants">
          <ConsoleSidebarNavigationItemIcon>
            <BuildingIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.nav.tenants_list_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/tenants/new">
          <ConsoleSidebarNavigationItemIcon>
            <PlusIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.nav.tenants_create_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <Message message="platform.nav.platform" />
        </Suspense>
      </ConsoleSidebarNavigationTitle>
      <ConsoleSidebarNavigationItems>
        <ConsoleSidebarNavigationItem href="/general">
          <ConsoleSidebarNavigationItemIcon>
            <SettingsIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.nav.general_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <Message message="platform.nav.services" />
        </Suspense>
      </ConsoleSidebarNavigationTitle>
      <ConsoleSidebarNavigationItems>
        <ConsoleSidebarNavigationItem href="/services/email">
          <ConsoleSidebarNavigationItemIcon>
            <MailIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="platform.nav.email_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/services/storage">
          <ConsoleSidebarNavigationItemIcon>
            <ImageIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.nav.storage_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/services/webpush">
          <ConsoleSidebarNavigationItemIcon>
            <BellIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.nav.webpush_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <Message message="platform.nav.policies" />
        </Suspense>
      </ConsoleSidebarNavigationTitle>
      <ConsoleSidebarNavigationItems>
        <ConsoleSidebarNavigationItem href="/policies/security">
          <ConsoleSidebarNavigationItemIcon>
            <LockIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.nav.security_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/policies/community">
          <ConsoleSidebarNavigationItemIcon>
            <CommentIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.nav.community_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/policies/retention">
          <ConsoleSidebarNavigationItemIcon>
            <ArchiveIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.nav.retention_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
    <ConsoleSidebarNavigationSection>
      <ConsoleSidebarNavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-20" />}>
          <Message message="platform.nav.governance" />
        </Suspense>
      </ConsoleSidebarNavigationTitle>
      <ConsoleSidebarNavigationItems>
        <ConsoleSidebarNavigationItem href="/operators">
          <ConsoleSidebarNavigationItemIcon>
            <ShieldUserIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="platform.nav.operators_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/users">
          <ConsoleSidebarNavigationItemIcon>
            <UsersIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.nav.users_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
        <ConsoleSidebarNavigationItem href="/audit-logs">
          <ConsoleSidebarNavigationItemIcon>
            <ScrollTextIcon className="size-4" />
          </ConsoleSidebarNavigationItemIcon>
          <ConsoleSidebarNavigationItemHeading>
            <ConsoleSidebarNavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.nav.audit_label" />
              </Suspense>
            </ConsoleSidebarNavigationItemLabel>
          </ConsoleSidebarNavigationItemHeading>
        </ConsoleSidebarNavigationItem>
      </ConsoleSidebarNavigationItems>
    </ConsoleSidebarNavigationSection>
  </ConsoleSidebarNavigation>
);
