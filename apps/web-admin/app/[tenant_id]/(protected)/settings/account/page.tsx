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

import { EmailChangeForm } from "../_components/email-change-form";
import { requestEmailChangeAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "アカウント設定",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const AccountSettingsPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>アカウント設定</AdminPageTitle>
        <AdminPageDescription>
          ログイン中の管理者アカウントの情報を管理します。
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <EmailChangeForm action={requestEmailChangeAction} />
    </AdminPageContent>
  </AdminPage>
);

export default AccountSettingsPage;
