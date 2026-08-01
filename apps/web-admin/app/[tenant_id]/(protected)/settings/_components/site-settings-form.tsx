"use client";

import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import { useActionState, useCallback, useEffect, useState } from "react";

import type { TenantSiteSettings } from "#lib/site-settings";

import type { SiteSettingsActionState } from "../settings-types";
import { useTenantId } from "#lib/use-tenant-id";

interface SiteSettingsFormProps {
  action: (
    prevState: SiteSettingsActionState,
    formData: FormData
  ) => Promise<SiteSettingsActionState>;
  initialSettings: TenantSiteSettings;
}

export const SiteSettingsForm = ({
  action,
  initialSettings,
}: SiteSettingsFormProps) => {

  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [copyrightText, setCopyrightText] = useState(
    initialSettings.copyrightText
  );
  const [siteDescription, setSiteDescription] = useState(
    initialSettings.siteDescription
  );
  const [siteTagline, setSiteTagline] = useState(initialSettings.siteTagline);

  useEffect(() => {
    setCopyrightText(initialSettings.copyrightText);
    setSiteDescription(initialSettings.siteDescription);
    setSiteTagline(initialSettings.siteTagline);
  }, [
    initialSettings.copyrightText,
    initialSettings.siteDescription,
    initialSettings.siteTagline,
  ]);

  const handleCopyrightTextChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setCopyrightText(event.target.value);
    },
    []
  );

  const handleSiteDescriptionChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setSiteDescription(event.target.value);
    },
    []
  );

  const handleSiteTaglineChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSiteTagline(event.target.value);
    },
    []
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>公開サイト表示設定</CardTitle>
        <CardDescription>
          公開向けに利用する文言を管理します。空欄のまま保存することもできます。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel htmlFor="copyright_text">Copyright 表示</FieldLabel>
            <FieldContent>
              <Input
                id="copyright_text"
                name="copyright_text"
                onChange={handleCopyrightTextChange}
                placeholder="例: Copyright © 2026 Acme Inc."
                type="text"
                value={copyrightText}
              />
              <FieldDescription>
                権利表記として利用する文言です。空欄のままにもできます。
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="site_tagline">サイトの宣伝文句</FieldLabel>
            <FieldContent>
              <Input
                id="site_tagline"
                name="site_tagline"
                onChange={handleSiteTaglineChange}
                placeholder="例: 静かに読む、持続可能に出版する"
                type="text"
                value={siteTagline}
              />
              <FieldDescription>
                タイトルや認証画面の補助文などで利用する短い宣伝文句です。
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="site_description">サイト説明文</FieldLabel>
            <FieldContent>
              <Textarea
                id="site_description"
                name="site_description"
                onChange={handleSiteDescriptionChange}
                placeholder="例: 作品の最新情報や更新告知をお届けします。"
                rows={3}
                value={siteDescription}
              />
              <FieldDescription>
                サイト説明として利用する文言です。空欄のままにもできます。
              </FieldDescription>
            </FieldContent>
          </Field>

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={isPending} type="submit">
              {isPending ? "保存中..." : "設定を保存"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
