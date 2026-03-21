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

import { PlatformPage } from "../../../components/platform-page";

const operators = [
  {
    email: "owner@publira.example",
    name: "中野",
    role: "platform_owner",
    status: "active",
  },
  {
    email: "ops@publira.example",
    name: "山田",
    role: "platform_operator",
    status: "active",
  },
  {
    email: "audit@publira.example",
    name: "木村",
    role: "platform_auditor",
    status: "limited",
  },
] as const;

export default function OperatorsPage() {
  return (
    <PlatformPage
      description="認証後にアクセスできるオペレーター管理画面です。ロール設計の前提を固定し、後続で API と接続します。"
      eyebrow="Platform Governance"
      title="オペレーター管理"
    >
      <Card>
        <CardHeader>
          <CardTitle>ロール前提</CardTitle>
          <CardDescription>
            platform_owner / platform_operator / platform_auditor の 3
            ロールを初期定義とします。
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
              {operators.map((operator) => (
                <TableRow key={operator.email}>
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
