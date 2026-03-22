import { Badge, StatusChip } from "@publira/ui-components/badge";
import { Button, LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { PlatformPage } from "../../../components/platform-page";
import {
  getPlatformCurrentOperator,
  PLATFORM_SESSION_COOKIE_NAME,
} from "../../../lib/platform-auth";
import {
  listPlatformOperators,
  suspendPlatformOperator,
  unsuspendPlatformOperator,
} from "../../../lib/platform-operators";

export const metadata: Metadata = {
  title: "オペレーター管理",
};

const roleLabelMap: Record<string, string> = {
  platform_auditor: "監査担当",
  platform_operator: "オペレーター",
  platform_super_admin: "スーパー管理者",
};

const statusLabelMap: Record<string, string> = {
  active: "有効",
  inactive: "無効",
  suspended: "停止中",
};

const suspendAction = async (formData: FormData): Promise<void> => {
  "use server";
  const publicId = String(formData.get("public_id") ?? "").trim();
  const actionCookieStore = await cookies();
  const sid = actionCookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value ?? "";
  const me = await getPlatformCurrentOperator(sid);
  if (me?.publicId === publicId) {
    revalidatePath("/operators");
    return;
  }
  await suspendPlatformOperator(publicId, sid);
  revalidatePath("/operators");
};

const unsuspendAction = async (formData: FormData): Promise<void> => {
  "use server";
  const publicId = String(formData.get("public_id") ?? "").trim();
  const actionCookieStore = await cookies();
  const sid = actionCookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value ?? "";
  await unsuspendPlatformOperator(publicId, sid);
  revalidatePath("/operators");
};

const renderOperatorAction = (
  operator: {
    publicId: string;
    status: string;
  },
  currentOperatorPublicId?: string
) => {
  if (
    operator.status === "active" &&
    operator.publicId !== currentOperatorPublicId
  ) {
    return (
      <form action={suspendAction}>
        <input name="public_id" type="hidden" value={operator.publicId} />
        <Button size="sm" type="submit" variant="outline">
          停止
        </Button>
      </form>
    );
  }

  if (operator.status === "suspended") {
    return (
      <form action={unsuspendAction}>
        <input name="public_id" type="hidden" value={operator.publicId} />
        <Button size="sm" type="submit" variant="outline">
          再有効化
        </Button>
      </form>
    );
  }

  return null;
};

export default async function OperatorsPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value ?? "";
  const operators = await listPlatformOperators(sessionId);
  const currentOperator = await getPlatformCurrentOperator(sessionId);

  return (
    <PlatformPage
      actions={
        <LinkButton href="/operators/new">オペレーターを追加</LinkButton>
      }
      description="プラットフォームオペレーターの一覧・ロール確認・有効化／停止を行います。"
      eyebrow="Platform Governance"
      title="オペレーター管理"
    >
      <Card>
        <CardHeader>
          <CardTitle>オペレーター一覧</CardTitle>
          <CardDescription>
            スーパー管理者 / オペレーター /
            監査担当の優先順でロールを付与します。停止中のオペレーターはログインできません。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名前</TableHead>
                <TableHead>メール</TableHead>
                <TableHead className="w-48">ロール</TableHead>
                <TableHead className="w-36">状態</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {operators.length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={5}>
                    オペレーターはまだ登録されていません。
                  </TableCell>
                </TableRow>
              ) : null}
              {operators.map((operator) => (
                <TableRow key={operator.publicId || operator.email}>
                  <TableCell>
                    <div className="grid gap-1">
                      <p className="font-medium text-foreground">
                        {operator.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {operator.publicId}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>{operator.email}</TableCell>
                  <TableCell>
                    <Badge tone="info">
                      {roleLabelMap[operator.role] ?? operator.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      status={
                        operator.status === "active" ? "success" : "warning"
                      }
                    >
                      {statusLabelMap[operator.status] ?? operator.status}
                    </StatusChip>
                  </TableCell>
                  <TableCell>
                    {renderOperatorAction(operator, currentOperator?.publicId)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PlatformPage>
  );
}
