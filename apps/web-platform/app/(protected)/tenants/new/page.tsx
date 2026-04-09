import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import type { Metadata } from "next";

import { PlatformPage } from "#components/platform-page";

import { CreateTenantForm } from "./_components/create-tenant-form";

export const metadata: Metadata = {
  title: "テナント作成",
};

export default function TenantNewPage() {
  return (
    <PlatformPage
      description="テナント名とドメインを必須に、必要なら既存ユーザーを初期管理者として紐づけて作成します。"
      eyebrow="Platform Tenants"
      title="テナント作成"
    >
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
    </PlatformPage>
  );
}
