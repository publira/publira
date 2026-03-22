"use client";

import { Badge } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  ConfirmDialog,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@publira/ui-components/dialog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import * as React from "react";
import { useActionState } from "react";

import {
  getTenantRoleLabel,
  getTenantStatusLabel,
  getTenantStatusTone,
} from "../../../../../../lib/tenant-labels";
import type { PlatformTenantMemberSummary } from "../../../../../../lib/tenants";
import type { TenantMemberFormState } from "../../_lib/actions";

const tenantRoleOptions = [
  { label: "テナント管理者", value: "tenant_admin" },
  { label: "編集担当", value: "tenant_editor" },
  { label: "監査担当", value: "tenant_auditor" },
] as const;

interface TenantMembersManagerProps {
  addAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
  members: PlatformTenantMemberSummary[];
  removeAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
  tenantPublicId: string;
  updateRoleAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
}

interface TenantMemberRowProps {
  member: PlatformTenantMemberSummary;
  removeAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
  setDeleteState: (state: TenantMemberFormState) => void;
  tenantPublicId: string;
  updateRoleAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
}

interface TenantMemberRoleDialogProps {
  member: PlatformTenantMemberSummary;
  tenantPublicId: string;
  updateRoleAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
}

interface TenantMemberDeleteButtonProps {
  removeAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
  setDeleteState: (state: TenantMemberFormState) => void;
  tenantPublicId: string;
  userPublicId: string;
}

const TenantMemberDeleteButton = ({
  removeAction,
  setDeleteState,
  tenantPublicId,
  userPublicId,
}: TenantMemberDeleteButtonProps) => {
  const [isPending, startTransition] = React.useTransition();

  const handleDelete = React.useCallback(() => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("tenant_public_id", tenantPublicId);
      formData.set("member_user_public_id", userPublicId);

      const state = await removeAction(null, formData);
      setDeleteState(state);
    });
  }, [removeAction, setDeleteState, tenantPublicId, userPublicId]);

  return (
    <ConfirmDialog
      actionText={isPending ? "削除中..." : "削除する"}
      actionVariant="destructive"
      description="削除したメンバーはこのテナントへのアクセス権を失います。必要に応じて再追加できます。"
      onAction={handleDelete}
      title="このメンバーを削除しますか？"
      trigger={
        <Button
          disabled={isPending}
          size="sm"
          type="button"
          variant="destructive"
        >
          削除
        </Button>
      }
    />
  );
};

const TenantMemberRoleDialog = ({
  member,
  tenantPublicId,
  updateRoleAction,
}: TenantMemberRoleDialogProps) => {
  const [open, setOpen] = React.useState(false);
  const [updateState, roleFormAction, isRolePending] = useActionState(
    updateRoleAction,
    null
  );

  React.useEffect(() => {
    if (updateState?.ok) {
      setOpen(false);
    }
  }, [updateState]);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button size="sm" type="button" variant="outline">
            ロール変更
          </Button>
        }
      />
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup>
          <form action={roleFormAction} className="grid gap-4">
            <input
              name="tenant_public_id"
              type="hidden"
              value={tenantPublicId}
            />
            <input
              name="member_user_public_id"
              type="hidden"
              value={member.userPublicId}
            />

            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">
                ロールを変更
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {member.name}（{member.email}）のロールを更新します。
              </DialogDescription>
            </DialogHeader>

            <Field>
              <FieldLabel required>新しいロール</FieldLabel>
              <FieldContent>
                <div className="flex flex-wrap gap-2">
                  {tenantRoleOptions.map((roleOption) => (
                    <label
                      key={roleOption.value}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                    >
                      <input
                        defaultChecked={member.role === roleOption.value}
                        name="member_role"
                        required
                        type="radio"
                        value={roleOption.value}
                      />
                      <span>{roleOption.label}</span>
                    </label>
                  ))}
                </div>
              </FieldContent>
            </Field>

            {updateState ? (
              <FormMessage variant={updateState.ok ? "success" : "destructive"}>
                {updateState.message}
              </FormMessage>
            ) : null}

            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="outline">
                    キャンセル
                  </Button>
                }
              />
              <Button disabled={isRolePending} type="submit" variant="outline">
                {isRolePending ? "更新中..." : "更新する"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
};

const TenantMemberRow = ({
  member,
  removeAction,
  setDeleteState,
  tenantPublicId,
  updateRoleAction,
}: TenantMemberRowProps) => (
  <TableRow key={member.userPublicId || member.email}>
    <TableCell>
      <p className="font-medium text-foreground">{member.name}</p>
    </TableCell>
    <TableCell>{member.email}</TableCell>
    <TableCell>{getTenantRoleLabel(member.role)}</TableCell>
    <TableCell>
      <Badge tone={getTenantStatusTone(member.status)}>
        {getTenantStatusLabel(member.status)}
      </Badge>
    </TableCell>
    <TableCell>{member.createdAt || "未設定"}</TableCell>
    <TableCell>
      <div className="flex flex-wrap gap-2">
        <TenantMemberRoleDialog
          member={member}
          tenantPublicId={tenantPublicId}
          updateRoleAction={updateRoleAction}
        />
        <TenantMemberDeleteButton
          removeAction={removeAction}
          setDeleteState={setDeleteState}
          tenantPublicId={tenantPublicId}
          userPublicId={member.userPublicId}
        />
      </div>
    </TableCell>
  </TableRow>
);

export const TenantMembersManager = ({
  addAction,
  members,
  removeAction,
  tenantPublicId,
  updateRoleAction,
}: TenantMembersManagerProps) => {
  const [addState, addFormAction, isAddPending] = useActionState(
    addAction,
    null
  );
  const [deleteState, setDeleteState] =
    React.useState<TenantMemberFormState>(null);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>テナントメンバー一覧</CardTitle>
          <CardDescription>
            このテナントに所属するメンバーの一覧です。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deleteState ? (
            <FormMessage
              className="mb-4"
              variant={deleteState.ok ? "success" : "destructive"}
            >
              {deleteState.message}
            </FormMessage>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>氏名</TableHead>
                <TableHead>メール</TableHead>
                <TableHead>ロール</TableHead>
                <TableHead>状態</TableHead>
                <TableHead>参加日</TableHead>
                <TableHead className="w-56">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={6}>
                    メンバーがまだ登録されていません。メールアドレスを指定して追加してください。
                  </TableCell>
                </TableRow>
              ) : null}
              {members.map((member) => (
                <TenantMemberRow
                  key={member.userPublicId || member.email}
                  member={member}
                  removeAction={removeAction}
                  setDeleteState={setDeleteState}
                  tenantPublicId={tenantPublicId}
                  updateRoleAction={updateRoleAction}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>メンバーを追加</CardTitle>
          <CardDescription>
            メールアドレスとロールを指定して新しいメンバーを招待します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={addFormAction} className="grid gap-4">
            <input
              name="tenant_public_id"
              type="hidden"
              value={tenantPublicId}
            />
            <Field>
              <FieldLabel htmlFor="member_email" required>
                追加するユーザーのメールアドレス
              </FieldLabel>
              <FieldContent>
                <Input
                  id="member_email"
                  name="member_email"
                  placeholder="member@example.com"
                  required
                  type="email"
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="member_role" required>
                ロール
              </FieldLabel>
              <FieldContent>
                <Select
                  defaultValue="tenant_admin"
                  id="member_role"
                  items={tenantRoleOptions}
                  name="member_role"
                  required
                />
              </FieldContent>
            </Field>
            {addState ? (
              <FormMessage variant={addState.ok ? "success" : "destructive"}>
                {addState.message}
              </FormMessage>
            ) : null}
            <div className="flex justify-end">
              <Button disabled={isAddPending} type="submit" variant="outline">
                {isAddPending ? "追加中..." : "メンバーを追加"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
