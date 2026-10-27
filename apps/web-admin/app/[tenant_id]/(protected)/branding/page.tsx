import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { TenantAdminFieldset } from "#components/tenant-role-gate";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getTenantBrandMarks } from "#lib/brand-marks";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";
import {
  getTenantDarkThemeSettings,
  getTenantThemeSettings,
} from "#lib/theme-settings";

import { TenantBrandMarksSection } from "./_components/tenant-brand-marks-section";
import { TenantIconForm } from "./_components/tenant-icon-form";
import { TenantLogoForm } from "./_components/tenant-logo-form";
import { TenantSignInImageForm } from "./_components/tenant-sign-in-image-form";
import { ThemeSettingsForm } from "./_components/theme-settings-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.branding.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const BrandingFormsSkeleton = () => (
  <div className="grid gap-6">
    <div className="grid gap-4">
      <SkeletonLine className="h-5 w-32" />
      <Skeleton className="h-24" />
    </div>
    <div className="grid gap-4">
      <SkeletonLine className="h-5 w-40" />
      <div className="grid gap-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </div>
  </div>
);

const BrandingForms = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const [themeResult, darkThemeResult, brandMarksResult, timeZone] =
    await Promise.all([
      getTenantThemeSettings(tenantId, locale),
      getTenantDarkThemeSettings(tenantId, locale),
      getTenantBrandMarks(tenantId, locale),
      getTenantDisplayTimeZone(tenantId),
    ]);

  await redirectToLoginIfSessionRejected(
    themeResult,
    darkThemeResult,
    brandMarksResult
  );

  if (!themeResult.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.branding.section_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {themeResult.message}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  return (
    <>
      <TenantLogoForm logo={themeResult.logo} tenantId={tenantId} />
      <TenantIconForm icon={themeResult.icon} tenantId={tenantId} />
      <TenantSignInImageForm
        signInImage={themeResult.signInImage}
        tenantId={tenantId}
      />
      {brandMarksResult.ok ? (
        <TenantBrandMarksSection
          locale={locale}
          marks={brandMarksResult.marks}
          tenantId={tenantId}
          timeZone={timeZone}
        />
      ) : (
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.settings.brand_marks.section_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {brandMarksResult.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      )}
      <ThemeSettingsForm
        darkTheme={darkThemeResult}
        initialTheme={themeResult.theme}
        tenantId={tenantId}
      />
    </>
  );
};

const BrandingPage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
            <Message message="admin.branding.title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.branding.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.branding.section_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<BrandingFormsSkeleton />}>
          <TenantAdminFieldset>
            <BrandingForms />
          </TenantAdminFieldset>
        </Suspense>
      </SectionErrorBoundary>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default BrandingPage;
