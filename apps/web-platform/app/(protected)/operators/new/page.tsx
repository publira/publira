import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import type { Metadata } from "next";
import Link from "next/link";

import { PlatformPage } from "#components/platform-page";

import { CreateOperatorForm } from "./_components/create-operator-form";

export const metadata: Metadata = {
  title: "オペレーターを追加",
};

const OperatorNewPage = () => (
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
        <CreateOperatorForm />
      </CardContent>
    </Card>
  </PlatformPage>
);

export default OperatorNewPage;
