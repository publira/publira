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

import type { PlatformDefaultTimezoneActionState } from "../../_lib/actions";

interface PlatformTimezoneFormProps {
  action: (
    prevState: PlatformDefaultTimezoneActionState,
    formData: FormData
  ) => Promise<PlatformDefaultTimezoneActionState>;
  initialTimezone: string;
  loadErrorMessage?: string;
}

export const PlatformTimezoneForm = ({
  action,
  initialTimezone,
  loadErrorMessage,
}: PlatformTimezoneFormProps) => {
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
        <CardTitle>既定タイムゾーン</CardTitle>
        <CardDescription>
          新規に作成するテナントの初期タイムゾーンであり、このプラットフォーム管理画面が日時を表示・集計するときの基準にもなります。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 sm:max-w-lg">
          <input name="default_timezone" type="hidden" value={timezone} />

          <Field>
            <FieldLabel htmlFor="default_timezone">既定タイムゾーン</FieldLabel>
            <FieldContent>
              <Combobox
                emptyMessage="一致するタイムゾーンが見つかりません。"
                id="default_timezone"
                items={items}
                onValueChange={setTimezone}
                placeholder="例: Asia/Tokyo"
                value={timezone}
              />
              <FieldDescription>
                IANA タイムゾーン名（例:
                Asia/Tokyo）で保存されます。地域名や都市名を入力して絞り込めます。
                変更しても作成済みテナントのタイムゾーンは変わりません。各テナントのタイムゾーンはテナント管理画面から変更します。
              </FieldDescription>
            </FieldContent>
          </Field>

          {loadErrorMessage ? (
            <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
          ) : null}

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={isPending} type="submit">
              {isPending ? "保存中..." : "既定タイムゾーンを保存"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
