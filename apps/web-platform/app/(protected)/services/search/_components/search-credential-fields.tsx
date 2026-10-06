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
  SEARCH_PASSWORD_REPLACE,
  SEARCH_PASSWORD_UNCHANGED,
  searchCredentialMode,
} from "#lib/search-settings-shared";
import type {
  PlatformSearchSettings,
  SearchCredentialMode,
} from "#lib/search-settings-shared";

const credentialModeItems = [
  {
    description: (
      <ClientMessage message="platform.search.credentials.none_description" />
    ),
    label: <ClientMessage message="platform.search.credentials.none" />,
    value: "none",
  },
  {
    description: (
      <ClientMessage message="platform.search.credentials.basic_description" />
    ),
    label: <ClientMessage message="platform.search.credentials.basic" />,
    value: "basic",
  },
] as const;

const isCredentialMode = (value: unknown): value is SearchCredentialMode =>
  value === "basic" || value === "none";

interface SearchCredentialFieldsProps {
  disabled: boolean;
  settings: Pick<PlatformSearchSettings, "hasPassword" | "username">;
}

/**
 * The credential half of the search form. A saved credential is shown by its
 * username alone; the password that goes with it never reaches the browser,
 * and the two are replaced together because the server refuses to keep a
 * stored password under another username.
 *
 * The form remounts this whenever the settings' revision changes, so a save
 * puts a newly stored password back behind "Replace credentials".
 */
export const SearchCredentialFields = ({
  disabled,
  settings,
}: SearchCredentialFieldsProps) => {
  const hasStoredCredential = Boolean(
    settings.username && settings.hasPassword
  );
  const [mode, setMode] = useState(() => searchCredentialMode(settings));
  const [isReplacing, setIsReplacing] = useState(!hasStoredCredential);

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

  const keepsStoredCredential = hasStoredCredential && !isReplacing;

  return (
    <fieldset className="grid gap-4">
      <legend className="mb-2 text-sm font-medium text-foreground">
        <ClientMessage message="platform.search.credentials.legend" />
      </legend>
      <RadioGroup
        disabled={disabled}
        items={credentialModeItems}
        name="credential_mode"
        onValueChange={handleModeChange}
        value={mode}
      />

      {mode === "basic" ? (
        <>
          <Field>
            <FieldLabel required>
              <ClientMessage message="platform.search.credentials.username" />
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="off"
                defaultValue={settings.username}
                disabled={disabled}
                key={keepsStoredCredential ? "stored" : "editable"}
                name="username"
                readOnly={keepsStoredCredential}
                required
                spellCheck={false}
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required={!keepsStoredCredential}>
              <ClientMessage message="platform.search.credentials.password" />
            </FieldLabel>
            <FieldContent>
              {keepsStoredCredential ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-foreground">
                    <ClientMessage message="platform.search.credentials.password_stored" />
                  </p>
                  <Button
                    disabled={disabled}
                    onClick={handleStartReplace}
                    type="button"
                    variant="outline"
                  >
                    <ClientMessage message="platform.search.credentials.replace" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    autoComplete="new-password"
                    disabled={disabled}
                    name="password"
                    required
                    spellCheck={false}
                    type="password"
                  />
                  {hasStoredCredential ? (
                    <Button
                      onClick={handleKeepStored}
                      type="button"
                      variant="outline"
                    >
                      <ClientMessage message="platform.search.credentials.keep" />
                    </Button>
                  ) : null}
                </div>
              )}
            </FieldContent>
            <FieldDescription>
              {keepsStoredCredential ? (
                <ClientMessage message="platform.search.credentials.password_stored_help" />
              ) : (
                <ClientMessage message="platform.search.credentials.password_help" />
              )}
            </FieldDescription>
          </Field>

          <input
            name="password_update_mode"
            type="hidden"
            value={String(
              keepsStoredCredential
                ? SEARCH_PASSWORD_UNCHANGED
                : SEARCH_PASSWORD_REPLACE
            )}
          />
        </>
      ) : null}
    </fieldset>
  );
};
