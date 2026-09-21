import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
  AdminSection,
  AdminSections,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getAdminCurrentUser, isTenantAdminRole } from "#lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantCommunityLimitSettings } from "#lib/tenant-community-limits";
import type { TenantCommunityLimits } from "#lib/tenant-community-limits";
import { getTenantId } from "#lib/tenant-id";
import { getTenantRetentionSettings } from "#lib/tenant-retention-settings";
import type { TenantRetentionPeriods } from "#lib/tenant-retention-settings";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import { TenantCommunityLimitsForm } from "./_components/tenant-community-limits-form";
import { TenantRetentionSettingsForm } from "./_components/tenant-retention-settings-form";
import {
  updateTenantCommunityLimitsAction,
  updateTenantRetentionSettingsAction,
} from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.settings.policy_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

/**
 * What a form shows when its read failed. Its controls are closed then, so
 * these figures only keep the fields from rendering empty.
 */
const unreadableCommunityLimits: TenantCommunityLimits = {
  commentPost: { perDay: 1, perMinute: 1 },
  commentReport: { perDay: 1, perMinute: 1 },
  contactMessagePerAccount: { perDay: 1, perHour: 1 },
  contactMessagePerClient: { perDay: 1, perHour: 1 },
  duplicateCommentWindowMinutes: 1,
  episodeRating: { perDay: 1, perMinute: 1 },
  viewerPreferences: { perDay: 1, perMinute: 1 },
};

const unreadableRetentionPeriods: TenantRetentionPeriods = {
  contentEventDays: 1,
  dailyRankingSnapshotDays: 1,
  weeklyRankingSnapshotDays: 1,
  withdrawnCommentDays: 1,
};

const PolicyFormsSkeleton = () => (
  <AdminSections>
    <AdminSection>
      <SkeletonLine className="h-5 w-40" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </AdminSection>
    <AdminSection>
      <SkeletonLine className="h-5 w-40" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </AdminSection>
  </AdminSections>
);

const PolicyForms = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const [communityResult, retentionResult, currentUserResult] =
    await Promise.all([
      getTenantCommunityLimitSettings(tenantId, locale),
      getTenantRetentionSettings(tenantId, locale),
      getAdminCurrentUser(tenantId),
    ]);

  await redirectToLoginIfSessionRejected(
    communityResult,
    retentionResult,
    currentUserResult
  );

  const canEdit = isTenantAdminRole(
    currentUserResult.ok ? currentUserResult.user.role : undefined
  );

  return (
    <AdminSections>
      <TenantCommunityLimitsForm
        action={updateTenantCommunityLimitsAction}
        canEdit={canEdit}
        loadErrorMessage={
          communityResult.ok ? undefined : communityResult.message
        }
        overrides={communityResult.ok ? communityResult.overrides : {}}
        platformDefaults={
          communityResult.ok
            ? communityResult.platformDefaults
            : unreadableCommunityLimits
        }
        revision={communityResult.ok ? communityResult.revision : "0"}
      />

      <TenantRetentionSettingsForm
        action={updateTenantRetentionSettingsAction}
        canEdit={canEdit}
        loadErrorMessage={
          retentionResult.ok ? undefined : retentionResult.message
        }
        overrides={retentionResult.ok ? retentionResult.overrides : {}}
        platformDefaults={
          retentionResult.ok
            ? retentionResult.platformDefaults
            : unreadableRetentionPeriods
        }
        revision={retentionResult.ok ? retentionResult.revision : "0"}
      />
    </AdminSections>
  );
};

const PolicySettingsPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
            <Message message="admin.settings.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.policy_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <SettingsTabNav current="policy" />
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.settings.section_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<PolicyFormsSkeleton />}>
            <PolicyForms />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default PolicySettingsPage;
