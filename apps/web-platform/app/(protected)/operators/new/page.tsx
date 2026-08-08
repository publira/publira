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

import {
  PlatformPage,
  PlatformPageActions,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";

import { CreateOperatorForm } from "./_components/create-operator-form";

export const metadata: Metadata = {
  title: "オペレーターを追加",
};

const OperatorNewPage = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Governance</PlatformPageEyebrow>
        <PlatformPageTitle>オペレーターを追加</PlatformPageTitle>
        <PlatformPageDescription>
          名前・メールアドレス・ロールを入力してプラットフォームオペレーターを追加します。
        </PlatformPageDescription>
      </PlatformPageHeading>
      <PlatformPageActions>
        <LinkButton render={<Link href="/operators" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      </PlatformPageActions>
    </PlatformPageHeader>
    <PlatformPageContent>
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
    </PlatformPageContent>
  </PlatformPage>
);

export default OperatorNewPage;
