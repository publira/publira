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
import { getTenantSiteSettings } from "#lib/site-settings";
import { getTenantId } from "#lib/tenant-id";

import { SettingsTabNav } from "./_components/settings-tab-nav";
import { SiteSettingsForm } from "./_components/site-settings-form";
import { updateSiteSettingsAction } from "./_lib/actions";

export const metadata: Metadata = {
  title: "設定 - 基本情報",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const SettingsPage = async () => {
  const tenantId = await getTenantId();

  const settingsResult = await getTenantSiteSettings(tenantId);

  if (!settingsResult.ok) {
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
          <SectionError
            description={settingsResult.message}
            title="設定を表示できませんでした"
          />
        </AdminPageContent>
      </AdminPage>
    );
  }

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

          <SiteSettingsForm
            action={updateSiteSettingsAction}
            initialSettings={settingsResult.settings}
          />
        </div>
      </AdminPageContent>
    </AdminPage>
  );
};

export default SettingsPage;
