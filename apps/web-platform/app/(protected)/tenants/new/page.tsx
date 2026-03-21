import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";

import { PlatformPage } from "../../../../components/platform-page";

export default function TenantNewPage() {
  return (
    <PlatformPage
      description="初期発行時に必要な最小入力項目を定義した雛形です。実処理は後続 Issue で API 接続します。"
      eyebrow="Platform Tenants"
      title="テナント作成"
    >
      <Card>
        <CardHeader>
          <CardTitle>新規テナント情報</CardTitle>
          <CardDescription>
            tenant_public_id はドメイン・API の境界キーとして扱う前提です。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:max-w-2xl">
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
              <FieldLabel htmlFor="tenant_public_id" required>
                tenant_public_id
              </FieldLabel>
              <FieldContent>
                <Input
                  id="tenant_public_id"
                  name="tenant_public_id"
                  placeholder="tenant_example"
                  required
                  type="text"
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="owner_email" required>
                オーナー連絡先メール
              </FieldLabel>
              <FieldContent>
                <Input
                  id="owner_email"
                  name="owner_email"
                  placeholder="owner@example.com"
                  required
                  type="email"
                />
              </FieldContent>
            </Field>

            <div className="mt-2 flex gap-3">
              <Button disabled type="button">
                作成 (後続 Issue で有効化)
              </Button>
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
