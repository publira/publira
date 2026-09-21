"use client";

import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { useCallback, useState } from "react";

import { ClientMessage } from "#components/client-message";
import {
  STORAGE_SECRET_REPLACE,
  STORAGE_SECRET_UNCHANGED,
  storageCredentialMode,
} from "#lib/storage-settings-shared";
import type {
  PlatformStorageSettings,
  StorageCredentialMode,
} from "#lib/storage-settings-shared";

const credentialModeItems = [
  {
    description: (
      <ClientMessage message="platform.storage.credentials.ambient_description" />
    ),
    label: <ClientMessage message="platform.storage.credentials.ambient" />,
    value: "ambient",
  },
  {
    description: (
      <ClientMessage message="platform.storage.credentials.access_key_description" />
    ),
    label: <ClientMessage message="platform.storage.credentials.access_key" />,
    value: "access_key",
  },
] as const;

const isCredentialMode = (value: unknown): value is StorageCredentialMode =>
  value === "access_key" || value === "ambient";

interface StorageCredentialFieldsProps {
  settings: Pick<PlatformStorageSettings, "accessKeyId" | "hasSecretAccessKey">;
}

/**
 * The credential half of the storage form. A saved access key is shown by its
 * id alone; the secret that goes with it never reaches the browser, and the
 * two are replaced together because the server refuses to pair a kept secret
 * with a different id.
 *
 * The page remounts this with the settings' revision as its key, so a save
 * puts a newly stored key back behind "Replace access key".
 */
export const StorageCredentialFields = ({
  settings,
}: StorageCredentialFieldsProps) => {
  const hasStoredKey = Boolean(
    settings.accessKeyId && settings.hasSecretAccessKey
  );
  const [mode, setMode] = useState(() => storageCredentialMode(settings));
  const [isReplacing, setIsReplacing] = useState(!hasStoredKey);

  const handleModeChange = useCallback((value: unknown) => {
    if (isCredentialMode(value)) {
      setMode(value);
    }
  }, []);
  const handleStartReplace = useCallback(() => {
    setIsReplacing(true);
  }, []);
  const handleKeepStored = useCallback(() => {
    setIsReplacing(false);
  }, []);

  const keepsStoredKey = hasStoredKey && !isReplacing;

  return (
    <fieldset className="grid gap-4">
      <legend className="mb-2 text-sm font-medium text-foreground">
        <ClientMessage message="platform.storage.credentials.legend" />
      </legend>
      <RadioGroup
        items={credentialModeItems}
        name="credential_mode"
        onValueChange={handleModeChange}
        value={mode}
      />

      {mode === "access_key" ? (
        <>
          <Field>
            <FieldLabel required>
              <ClientMessage message="platform.storage.credentials.access_key_id" />
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="off"
                defaultValue={settings.accessKeyId}
                key={keepsStoredKey ? "stored" : "editable"}
                name="access_key_id"
                readOnly={keepsStoredKey}
                required
                spellCheck={false}
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required={!keepsStoredKey}>
              <ClientMessage message="platform.storage.credentials.secret_access_key" />
            </FieldLabel>
            <FieldContent>
              {keepsStoredKey ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-foreground">
                    <ClientMessage message="platform.storage.credentials.secret_stored" />
                  </p>
                  <Button
                    onClick={handleStartReplace}
                    type="button"
                    variant="outline"
                  >
                    <ClientMessage message="platform.storage.credentials.replace" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    autoComplete="new-password"
                    name="secret_access_key"
                    required
                    spellCheck={false}
                    type="password"
                  />
                  {hasStoredKey ? (
                    <Button
                      onClick={handleKeepStored}
                      type="button"
                      variant="outline"
                    >
                      <ClientMessage message="platform.storage.credentials.keep" />
                    </Button>
                  ) : null}
                </div>
              )}
            </FieldContent>
            <FieldDescription>
              {keepsStoredKey ? (
                <ClientMessage message="platform.storage.credentials.secret_stored_help" />
              ) : (
                <ClientMessage message="platform.storage.credentials.secret_help" />
              )}
            </FieldDescription>
          </Field>

          <input
            name="secret_access_key_update_mode"
            type="hidden"
            value={String(
              keepsStoredKey ? STORAGE_SECRET_UNCHANGED : STORAGE_SECRET_REPLACE
            )}
          />
        </>
      ) : null}
    </fieldset>
  );
};
