import { StatusChip } from "@publira/ui-components/badge";
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
import { cookies } from "next/headers";

import { PlatformPage } from "../../../components/platform-page";
import { PLATFORM_SESSION_COOKIE_NAME } from "../../../lib/platform-auth";
import { listPlatformOperators } from "../../../lib/platform-operators";

export default async function OperatorsPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value ?? "";
  const operators = await listPlatformOperators(sessionId);

  return (
    <PlatformPage
      description="認証後にアクセスできるオペレーター管理画面です。platform_user_roles ベースの一覧を表示します。"
      eyebrow="Platform Governance"
      title="オペレーター管理"
    >
      <Card>
        <CardHeader>
          <CardTitle>ロール前提</CardTitle>
          <CardDescription>
            platform_super_admin / platform_operator / platform_auditor
            を優先順付きで扱います。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名前</TableHead>
                <TableHead>メール</TableHead>
                <TableHead className="w-56">ロール</TableHead>
                <TableHead className="w-40">状態</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operators.length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={4}>
                    オペレーターはまだ登録されていません。
                  </TableCell>
                </TableRow>
              ) : null}
              {operators.map((operator) => (
                <TableRow key={operator.publicId || operator.email}>
                  <TableCell className="font-medium">{operator.name}</TableCell>
                  <TableCell>{operator.email}</TableCell>
                  <TableCell>{operator.role}</TableCell>
                  <TableCell>
                    <StatusChip
                      status={
                        operator.status === "active" ? "success" : "warning"
                      }
                    >
                      {operator.status}
                    </StatusChip>
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
