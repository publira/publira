import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import type { Metadata } from "next";

import {
  PlatformPage,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";

import { CreateTenantForm } from "./_components/create-tenant-form";

export const metadata: Metadata = {
  title: "テナント作成",
};

const TenantNewPage = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Tenants</PlatformPageEyebrow>
        <PlatformPageTitle>テナント作成</PlatformPageTitle>
        <PlatformPageDescription>
          テナント名とドメインを必須に、必要なら既存ユーザーを初期管理者として紐づけて作成します。
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <Card>
        <CardHeader>
          <CardTitle>新規テナント情報</CardTitle>
          <CardDescription>
            public_id
            はサーバー側で自動採番されます。初期管理者メールは任意です。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateTenantForm />
        </CardContent>
      </Card>
    </PlatformPageContent>
  </PlatformPage>
);

export default TenantNewPage;
