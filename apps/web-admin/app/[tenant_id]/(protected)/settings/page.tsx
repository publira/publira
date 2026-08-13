import { SectionError } from "@publira/ui-components/section-error";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { getAdminCurrentUser, isTenantAdminRole } from "#lib/admin-auth";
import { getTenantSiteSettings } from "#lib/site-settings";
import { getTenantId } from "#lib/tenant-id";
import { getTenantTimezone } from "#lib/tenant-timezone";

import { SettingsTabNav } from "./_components/settings-tab-nav";
import { SiteSettingsForm } from "./_components/site-settings-form";
import { TenantTimezoneForm } from "./_components/tenant-timezone-form";
import {
  updateSiteSettingsAction,
  updateTenantTimezoneAction,
} from "./_lib/actions";

export const metadata: Metadata = {
  title: "設定 - 基本情報",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const SettingsPage = async () => {
  const tenantId = await getTenantId();

  const [settingsResult, timezoneResult, currentUser] = await Promise.all([
    getTenantSiteSettings(tenantId),
    getTenantTimezone(tenantId),
    getAdminCurrentUser(tenantId),
  ]);

  return (
    <AdminPage>
      <AdminPageHeader>
        <AdminPageHeading>
          <AdminPageEyebrow>Console</AdminPageEyebrow>
          <AdminPageTitle>設定</AdminPageTitle>
          <AdminPageDescription>
            テナントごとの公開表示設定を管理します。
          </AdminPageDescription>
        </AdminPageHeading>
      </AdminPageHeader>
      <AdminPageContent>
        <div className="grid gap-6">
          <SettingsTabNav current="basic" />

          {settingsResult.ok ? (
            <SiteSettingsForm
              action={updateSiteSettingsAction}
              initialSettings={settingsResult.settings}
            />
          ) : (
            <SectionError
              description={settingsResult.message}
              title="設定を表示できませんでした"
            />
          )}

          <TenantTimezoneForm
            action={updateTenantTimezoneAction}
            canEdit={isTenantAdminRole(currentUser?.role)}
            initialTimezone={timezoneResult.timezone}
            loadErrorMessage={
              timezoneResult.ok ? undefined : timezoneResult.message
            }
          />
        </div>
      </AdminPageContent>
    </AdminPage>
  );
};

export default SettingsPage;
