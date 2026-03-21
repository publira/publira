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

import { PlatformPage } from "../../../components/platform-page";

const auditLogs = [
  {
    action: "tenant.status.updated",
    actor: "operator.sato",
    at: "2026-03-21 09:45",
    resource: "tenant_hoshikawa",
  },
  {
    action: "operator.role.updated",
    actor: "owner.nakano",
    at: "2026-03-20 21:14",
    resource: "operator.kimura",
  },
  {
    action: "tenant.created",
    actor: "operator.yamada",
    at: "2026-03-20 10:07",
    resource: "tenant_kuushisha",
  },
] as const;

export default function AuditLogsPage() {
  return (
    <PlatformPage
      description="テナント横断オペレーションの追跡点を固定するための初期監査ログ画面です。"
      eyebrow="Platform Governance"
      title="監査ログ"
    >
      <Card>
        <CardHeader>
          <CardTitle>イベント一覧</CardTitle>
          <CardDescription>
            初期リリースでは「誰が」「いつ」「何を変更したか」を必須項目として定義します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>時刻</TableHead>
                <TableHead>実行者</TableHead>
                <TableHead>操作</TableHead>
                <TableHead>対象</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLogs.map((log) => (
                <TableRow key={`${log.at}-${log.resource}`}>
                  <TableCell>{log.at}</TableCell>
                  <TableCell>{log.actor}</TableCell>
                  <TableCell className="font-medium">{log.action}</TableCell>
                  <TableCell>{log.resource}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PlatformPage>
  );
}
