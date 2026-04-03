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
  DialogViewport,
} from "@publira/ui-components/dialog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import * as React from "react";
import { useActionState } from "react";

import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "#lib/email-settings-shared";
import type { PlatformSmtpSettings } from "#lib/email-settings-shared";

import type {
  PlatformEmailSettingsFormState,
  PlatformSmtpTestFormState,
} from "../../_lib/actions";

const encryptionOptions = [
  { label: "TLS", value: "tls" },
  { label: "STARTTLS", value: "starttls" },
  { label: "なし", value: "none" },
] as const;

interface EmailSettingsFormProps {
  initialSettings: PlatformSmtpSettings;
  loadErrorMessage?: string;
  saveAction: (
    prevState: PlatformEmailSettingsFormState,
    formData: FormData
  ) => Promise<PlatformEmailSettingsFormState>;
  testAction: (
    prevState: PlatformSmtpTestFormState,
    formData: FormData
  ) => Promise<PlatformSmtpTestFormState>;
}

export const EmailSettingsForm = ({
  initialSettings,
  loadErrorMessage,
  saveAction,
  testAction,
}: EmailSettingsFormProps) => {
  const formId = React.useId();
  const [saveState, saveFormAction, isSaving] = useActionState(
    saveAction,
    null
  );
  const [testState, testFormAction, isTesting] = useActionState(
    testAction,
    null
  );
  const [hasStoredPassword, setHasStoredPassword] = React.useState(
    initialSettings.hasPassword
  );
  const [isPasswordEditing, setPasswordEditing] = React.useState(
    !initialSettings.hasPassword
  );
  const [sendToSelf, setSendToSelf] = React.useState(true);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const handleStartPasswordEdit = React.useCallback(() => {
    setPasswordEditing(true);
  }, []);

  const handleCancelPasswordEdit = React.useCallback(() => {
    setPasswordEditing(false);
  }, []);

  const handleSendToSelfChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSendToSelf(event.target.checked);
    },
    []
  );

  React.useEffect(() => {
    if (!saveState?.ok) {
      return;
    }

    setHasStoredPassword(saveState.settings.hasPassword);
    setPasswordEditing(!saveState.settings.hasPassword);
  }, [saveState]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>メール設定</CardTitle>
        <CardDescription>
          プラットフォーム既定の SMTP
          を管理します。接続テストは保存と分離して実行できます。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={saveFormAction}
          className="grid gap-5 sm:max-w-3xl"
          id={formId}
        >
          <Field>
            <FieldLabel htmlFor="host" required>
              ホスト
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSettings.host}
                id="host"
                name="host"
                placeholder="smtp.example.com"
                required
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="port" required>
              ポート
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={String(initialSettings.port || 587)}
                id="port"
                min={1}
                max={65_535}
                name="port"
                required
                type="number"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="username" required>
              ユーザー名
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSettings.username}
                id="username"
                name="username"
                required
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="password" required={isPasswordEditing}>
              パスワード
            </FieldLabel>
            <FieldContent>
              {hasStoredPassword && !isPasswordEditing ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    defaultValue="****"
                    disabled
                    key="password-masked"
                    readOnly
                    type="password"
                  />
                  <Button
                    onClick={handleStartPasswordEdit}
                    type="button"
                    variant="outline"
                  >
                    変更する
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    autoComplete="new-password"
                    id="password"
                    key="password-editable"
                    name="password"
                    required={isPasswordEditing}
                    type="password"
                  />
                  {hasStoredPassword ? (
                    <Button
                      onClick={handleCancelPasswordEdit}
                      type="button"
                      variant="outline"
                    >
                      変更を取り消す
                    </Button>
                  ) : null}
                </div>
              )}

              <input
                name="password_update_mode"
                type="hidden"
                value={
                  hasStoredPassword && !isPasswordEditing
                    ? String(SECRET_UPDATE_MODE_UNCHANGED)
                    : String(SECRET_UPDATE_MODE_REPLACE)
                }
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="encryption" required>
              暗号化方式
            </FieldLabel>
            <FieldContent>
              <Select
                defaultValue={initialSettings.encryption || "starttls"}
                id="encryption"
                items={encryptionOptions}
                name="encryption"
                required
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="from_address" required>
              送信者メールアドレス
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSettings.fromAddress}
                id="from_address"
                name="from_address"
                placeholder="noreply@example.com"
                required
                type="email"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="reply_to">
              返信先メールアドレス（任意）
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSettings.replyTo}
                id="reply_to"
                name="reply_to"
                placeholder="support@example.com"
                type="email"
              />
            </FieldContent>
          </Field>

          {loadErrorMessage ? (
            <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
          ) : null}

          {saveState ? (
            <FormMessage variant={saveState.ok ? "success" : "destructive"}>
              {saveState.message}
            </FormMessage>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
              <DialogTrigger
                render={
                  <Button type="button" variant="outline">
                    接続テスト
                  </Button>
                }
              />
              <DialogPortal>
                <DialogBackdrop />
                <DialogViewport>
                  <DialogPopup>
                    <DialogHeader>
                      <DialogTitle>SMTP 接続テスト</DialogTitle>
                      <DialogDescription>
                        現在のフォーム入力値でテストメールを送信します。
                      </DialogDescription>
                    </DialogHeader>

                    <div className="mt-4 grid gap-4">
                      <label className="inline-flex items-center gap-2 text-sm text-foreground">
                        <input
                          checked={sendToSelf}
                          onChange={handleSendToSelfChange}
                          type="checkbox"
                        />
                        自分に送信する
                      </label>
                      <input
                        form={formId}
                        name="recipient_type"
                        type="hidden"
                        value={
                          sendToSelf
                            ? String(TEST_EMAIL_RECIPIENT_TYPE_SELF)
                            : String(TEST_EMAIL_RECIPIENT_TYPE_CUSTOM)
                        }
                      />

                      {sendToSelf ? null : (
                        <Field>
                          <FieldLabel htmlFor="recipient_email" required>
                            送信先メールアドレス
                          </FieldLabel>
                          <FieldContent>
                            <Input
                              form={formId}
                              id="recipient_email"
                              name="recipient_email"
                              placeholder="recipient@example.com"
                              required={!sendToSelf}
                              type="email"
                            />
                          </FieldContent>
                        </Field>
                      )}

                      {testState ? (
                        <FormMessage
                          variant={testState.ok ? "success" : "destructive"}
                        >
                          {testState.message}
                        </FormMessage>
                      ) : null}
                    </div>

                    <DialogFooter>
                      <DialogClose
                        render={
                          <Button type="button" variant="outline">
                            閉じる
                          </Button>
                        }
                      />
                      <Button
                        disabled={isTesting}
                        form={formId}
                        formAction={testFormAction}
                        type="submit"
                        variant="outline"
                      >
                        {isTesting ? "送信中..." : "テストを実行"}
                      </Button>
                    </DialogFooter>
                  </DialogPopup>
                </DialogViewport>
              </DialogPortal>
            </Dialog>

            <Button disabled={isSaving} type="submit">
              {isSaving ? "保存中..." : "保存"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
