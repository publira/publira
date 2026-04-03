import { Button, LinkButton } from "@publira/ui-components/button";
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
import { Select } from "@publira/ui-components/select";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PlatformPage } from "#components/platform-page";
import { createPlatformOperator } from "#lib/operators";

export const metadata: Metadata = {
  title: "オペレーターを追加",
};

const ROLE_OPTIONS = [
  { label: "スーパー管理者", value: "platform_super_admin" },
  { label: "オペレーター", value: "platform_operator" },
  { label: "監査担当", value: "platform_auditor" },
] as const;

const createOperatorAction = async (formData: FormData): Promise<void> => {
  "use server";

  const name = String(formData.get("operator_name") ?? "").trim();
  const email = String(formData.get("operator_email") ?? "").trim();
  const role = String(formData.get("operator_role") ?? "").trim();

  if (!name || !email || !role) {
    redirect(
      `/operators/new?error=${encodeURIComponent("名前・メール・ロールはすべて必須です。")}`
    );
  }

  const result = await createPlatformOperator({ email, name, role });

  if (!result.ok) {
    redirect(`/operators/new?error=${encodeURIComponent(result.message)}`);
  }

  redirect("/operators");
};

interface OperatorNewPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function OperatorNewPage({
  searchParams,
}: OperatorNewPageProps) {
  const params = await searchParams;
  const errorMessage = params.error?.trim();

  return (
    <PlatformPage
      actions={
        <LinkButton render={<Link href="/operators" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      }
      description="名前・メールアドレス・ロールを入力してプラットフォームオペレーターを追加します。"
      eyebrow="Platform Governance"
      title="オペレーターを追加"
    >
      <Card>
        <CardHeader>
          <CardTitle>オペレーター情報</CardTitle>
          <CardDescription>
            ロールはスーパー管理者 / オペレーター / 監査担当から選択します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={createOperatorAction}
            className="grid gap-4 sm:max-w-2xl"
          >
            <Field>
              <FieldLabel htmlFor="operator_name" required>
                名前
              </FieldLabel>
              <FieldContent>
                <Input
                  id="operator_name"
                  name="operator_name"
                  required
                  type="text"
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="operator_email" required>
                メールアドレス
              </FieldLabel>
              <FieldContent>
                <Input
                  id="operator_email"
                  name="operator_email"
                  placeholder="operator@example.com"
                  required
                  type="email"
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="operator_role" required>
                ロール
              </FieldLabel>
              <FieldContent>
                <Select
                  id="operator_role"
                  items={ROLE_OPTIONS}
                  name="operator_role"
                  placeholder="選択してください"
                  required
                />
              </FieldContent>
            </Field>

            {errorMessage ? (
              <FormMessage variant="destructive">{errorMessage}</FormMessage>
            ) : null}

            <div className="mt-2 flex gap-3">
              <Button type="submit">追加</Button>
              <LinkButton render={<Link href="/operators" />} variant="outline">
                キャンセル
              </LinkButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </PlatformPage>
  );
}
