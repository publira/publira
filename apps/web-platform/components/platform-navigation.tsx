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
  SearchIcon,
  SettingsIcon,
  ShieldUserIcon,
  UsersIcon,
} from "@publira/icons";
import * as ConsoleSidebar from "@publira/layouts/admin/console-sidebar";
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
  "/services/search",
  "/services/webpush",
  "/policies/security",
  "/policies/community",
  "/policies/retention",
  "/operators",
  "/users",
  "/audit-logs",
];

export const PlatformNavigation = () => (
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
                <Message message="platform.nav.dashboard_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
      </ConsoleSidebar.NavigationItems>
    </ConsoleSidebar.NavigationSection>
    <ConsoleSidebar.NavigationSection>
      <ConsoleSidebar.NavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <Message message="platform.nav.tenants_section" />
        </Suspense>
      </ConsoleSidebar.NavigationTitle>
      <ConsoleSidebar.NavigationItems>
        <ConsoleSidebar.NavigationItem href="/tenants">
          <ConsoleSidebar.NavigationItemIcon>
            <BuildingIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.nav.tenants_list_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/tenants/new">
          <ConsoleSidebar.NavigationItemIcon>
            <PlusIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.nav.tenants_create_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
      </ConsoleSidebar.NavigationItems>
    </ConsoleSidebar.NavigationSection>
    <ConsoleSidebar.NavigationSection>
      <ConsoleSidebar.NavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <Message message="platform.nav.platform" />
        </Suspense>
      </ConsoleSidebar.NavigationTitle>
      <ConsoleSidebar.NavigationItems>
        <ConsoleSidebar.NavigationItem href="/general">
          <ConsoleSidebar.NavigationItemIcon>
            <SettingsIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.nav.general_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
      </ConsoleSidebar.NavigationItems>
    </ConsoleSidebar.NavigationSection>
    <ConsoleSidebar.NavigationSection>
      <ConsoleSidebar.NavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <Message message="platform.nav.services" />
        </Suspense>
      </ConsoleSidebar.NavigationTitle>
      <ConsoleSidebar.NavigationItems>
        <ConsoleSidebar.NavigationItem href="/services/email">
          <ConsoleSidebar.NavigationItemIcon>
            <MailIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="platform.nav.email_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/services/storage">
          <ConsoleSidebar.NavigationItemIcon>
            <ImageIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.nav.storage_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/services/search">
          <ConsoleSidebar.NavigationItemIcon>
            <SearchIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                <Message message="platform.nav.search_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/services/webpush">
          <ConsoleSidebar.NavigationItemIcon>
            <BellIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.nav.webpush_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
      </ConsoleSidebar.NavigationItems>
    </ConsoleSidebar.NavigationSection>
    <ConsoleSidebar.NavigationSection>
      <ConsoleSidebar.NavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <Message message="platform.nav.policies" />
        </Suspense>
      </ConsoleSidebar.NavigationTitle>
      <ConsoleSidebar.NavigationItems>
        <ConsoleSidebar.NavigationItem href="/policies/security">
          <ConsoleSidebar.NavigationItemIcon>
            <LockIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.nav.security_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/policies/community">
          <ConsoleSidebar.NavigationItemIcon>
            <CommentIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.nav.community_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/policies/retention">
          <ConsoleSidebar.NavigationItemIcon>
            <ArchiveIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.nav.retention_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
      </ConsoleSidebar.NavigationItems>
    </ConsoleSidebar.NavigationSection>
    <ConsoleSidebar.NavigationSection>
      <ConsoleSidebar.NavigationTitle>
        <Suspense fallback={<SkeletonLine className="h-3 w-20" />}>
          <Message message="platform.nav.governance" />
        </Suspense>
      </ConsoleSidebar.NavigationTitle>
      <ConsoleSidebar.NavigationItems>
        <ConsoleSidebar.NavigationItem href="/operators">
          <ConsoleSidebar.NavigationItemIcon>
            <ShieldUserIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="platform.nav.operators_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/users">
          <ConsoleSidebar.NavigationItemIcon>
            <UsersIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.nav.users_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
        <ConsoleSidebar.NavigationItem href="/audit-logs">
          <ConsoleSidebar.NavigationItemIcon>
            <ScrollTextIcon className="size-4" />
          </ConsoleSidebar.NavigationItemIcon>
          <ConsoleSidebar.NavigationItemHeading>
            <ConsoleSidebar.NavigationItemLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.nav.audit_label" />
              </Suspense>
            </ConsoleSidebar.NavigationItemLabel>
          </ConsoleSidebar.NavigationItemHeading>
        </ConsoleSidebar.NavigationItem>
      </ConsoleSidebar.NavigationItems>
    </ConsoleSidebar.NavigationSection>
  </ConsoleSidebar.Navigation>
);
