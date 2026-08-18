"use client";

import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Combobox } from "@publira/ui-components/combobox";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { listSupportedTimeZones } from "@publira/utils";
import { useActionState, useMemo, useState } from "react";

import { useTenantId } from "#lib/use-tenant-id";

import type { TenantTimezoneActionState } from "../settings-types";

interface TenantTimezoneFormProps {
  action: (
    prevState: TenantTimezoneActionState,
    formData: FormData
  ) => Promise<TenantTimezoneActionState>;
  canEdit: boolean;
  initialTimezone: string;
  loadErrorMessage?: string;
}

export const TenantTimezoneForm = ({
  action,
  canEdit,
  initialTimezone,
  loadErrorMessage,
}: TenantTimezoneFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [timezone, setTimezone] = useState(initialTimezone);

  const items = useMemo<ComboboxItem[]>(() => {
    const zones = listSupportedTimeZones();
    // A stored alias (`Asia/Calcutta`) is valid but is not always enumerated by
    // the runtime's ICU build, so keep it selectable instead of dropping it.
    const values =
      !initialTimezone || zones.includes(initialTimezone)
        ? zones
        : [initialTimezone, ...zones];

    return values.map((zone) => ({ label: zone, value: zone }));
  }, [initialTimezone]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>タイムゾーン</CardTitle>
        <CardDescription>
          管理画面と公開サイトで日時を表示・入力するときの基準になるタイムゾーンです。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 sm:max-w-lg">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="timezone" type="hidden" value={timezone} />

          <Field>
            <FieldLabel>タイムゾーン</FieldLabel>
            <FieldContent>
              <Combobox
                disabled={!canEdit}
                emptyMessage="一致するタイムゾーンが見つかりません。"
                items={items}
                onValueChange={setTimezone}
                placeholder="例: Asia/Tokyo"
                value={timezone}
              />
              <FieldDescription>
                IANA タイムゾーン名（例:
                Asia/Tokyo）で保存されます。地域名や都市名を入力して絞り込めます。
              </FieldDescription>
            </FieldContent>
          </Field>

          {canEdit ? null : (
            <FormMessage variant="destructive">
              この設定はテナント管理者のみ編集できます。現在は閲覧専用です。
            </FormMessage>
          )}

          {loadErrorMessage ? (
            <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
          ) : null}

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={!canEdit || isPending} type="submit">
              {isPending ? "保存中..." : "タイムゾーンを保存"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
