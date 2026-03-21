import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PlatformPage } from "../../../../components/platform-page";
import { createPlatformTenant } from "../../../../lib/platform-tenants";

const createTenantAction = async (formData: FormData): Promise<void> => {
  "use server";

  const name = String(formData.get("tenant_name") ?? "").trim();
  const subdomain = String(formData.get("tenant_subdomain") ?? "").trim();
  const domain = String(formData.get("tenant_domain") ?? "").trim();
  const initialAdminEmailsRaw = String(
    formData.get("initial_admin_emails") ?? ""
  );
  const initialAdminEmails = initialAdminEmailsRaw
    .split(/[\n,]/)
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

  if (!name || !subdomain) {
    redirect(
      `/tenants/new?error=${encodeURIComponent(
        "テナント名とサブドメインは必須です。"
      )}`
    );
  }

  const cookieStore = await cookies();
  const sessionId = cookieStore.get("publira_platform_session")?.value ?? "";

  const result = await createPlatformTenant({
    domain,
    initialAdminEmails,
    name,
    sessionId,
    subdomain,
  });

  if (!result.ok) {
    redirect(`/tenants/new?error=${encodeURIComponent(result.message)}`);
  }

  if (result.publicId?.trim()) {
    redirect(`/tenants/${result.publicId}`);
  }
  redirect("/tenants");
};

interface TenantNewPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function TenantNewPage({
  searchParams,
}: TenantNewPageProps) {
  const params = await searchParams;
  const errorMessage = params.error?.trim();

  return (
    <PlatformPage
      description="テナント名とサブドメインを必須に、必要なら既存ユーザーを初期管理者として紐づけて作成します。"
      eyebrow="Platform Tenants"
      title="テナント作成"
    >
      <Card>
        <CardHeader>
          <CardTitle>新規テナント情報</CardTitle>
          <CardDescription>
            public_id はサーバー側で自動採番されます。domain
            と初期管理者メールは任意です。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createTenantAction} className="grid gap-4 sm:max-w-2xl">
            <Field>
              <FieldLabel htmlFor="tenant_name" required>
                テナント名
              </FieldLabel>
              <FieldContent>
                <Input
                  id="tenant_name"
                  name="tenant_name"
                  required
                  type="text"
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="tenant_subdomain" required>
                サブドメイン
              </FieldLabel>
              <FieldContent>
                <Input
                  id="tenant_subdomain"
                  name="tenant_subdomain"
                  placeholder="tenant-example"
                  required
                  type="text"
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="tenant_domain">ドメイン（任意）</FieldLabel>
              <FieldContent>
                <Input
                  id="tenant_domain"
                  name="tenant_domain"
                  placeholder="example.com"
                  type="text"
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="initial_admin_emails">
                初期管理者メール（任意・複数可）
              </FieldLabel>
              <FieldContent>
                <Input
                  id="initial_admin_emails"
                  name="initial_admin_emails"
                  placeholder="owner1@example.com, owner2@example.com"
                  type="text"
                />
              </FieldContent>
            </Field>

            {errorMessage ? (
              <FormMessage variant="destructive">{errorMessage}</FormMessage>
            ) : null}

            <div className="mt-2 flex gap-3">
              <Button type="submit">作成</Button>
              <Button type="button" variant="outline">
                下書きを保存
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PlatformPage>
  );
}
