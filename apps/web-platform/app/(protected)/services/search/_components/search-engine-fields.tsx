"use client";

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
import { isSearchEngine, searchEngineName } from "#lib/search-settings-shared";
import type { PlatformSearchSettings } from "#lib/search-settings-shared";

import type { PlatformSearchTestState } from "../_lib/actions";
import { SearchConnectionTest } from "./search-connection-test";
import { SearchCredentialFields } from "./search-credential-fields";

const engineItems = [
  {
    description: (
      <ClientMessage message="platform.search.form.engine_sql_description" />
    ),
    label: searchEngineName("sql"),
    value: "sql",
  },
  {
    description: (
      <ClientMessage message="platform.search.form.engine_opensearch_description" />
    ),
    label: searchEngineName("opensearch"),
    value: "opensearch",
  },
  {
    description: (
      <ClientMessage message="platform.search.form.engine_elasticsearch_description" />
    ),
    label: searchEngineName("elasticsearch"),
    value: "elasticsearch",
  },
] as const;

interface SearchEngineFieldsProps {
  disabled: boolean;
  settings: Pick<
    PlatformSearchSettings,
    "engine" | "hasPassword" | "index" | "url" | "username"
  >;
  testAction: (
    prevState: PlatformSearchTestState,
    formData: FormData
  ) => Promise<PlatformSearchTestState>;
}

/**
 * The engine, and what reaching it takes. The SQL engine searches the database
 * the servers already use, so choosing it leaves nothing else to fill in or
 * to test.
 *
 * The form remounts this whenever the settings' revision changes, so a save
 * shows the engine it stored.
 */
export const SearchEngineFields = ({
  disabled,
  settings,
  testAction,
}: SearchEngineFieldsProps) => {
  const [engine, setEngine] = useState(() => settings.engine);
  // Moves with every edit to a value the connection test sends, and remounts
  // the test with it: a result describes the values it was run with, so one
  // left beside other values would vouch for an engine nobody tested.
  const [testedValues, setTestedValues] = useState(0);

  const handleTestedValueChange = useCallback(() => {
    setTestedValues((version) => version + 1);
  }, []);
  const handleEngineChange = useCallback((value: unknown) => {
    if (isSearchEngine(value)) {
      setEngine(value);
      setTestedValues((version) => version + 1);
    }
  }, []);

  return (
    <>
      <fieldset className="grid gap-4">
        <legend className="mb-2 text-sm font-medium text-foreground">
          <ClientMessage message="platform.search.form.engine_legend" />
        </legend>
        <RadioGroup
          disabled={disabled}
          items={engineItems}
          name="engine"
          onValueChange={handleEngineChange}
          value={engine}
        />
      </fieldset>

      {engine === "sql" ? null : (
        <>
          <Field>
            <FieldLabel required>
              <ClientMessage message="platform.search.form.url" />
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="off"
                defaultValue={settings.url}
                disabled={disabled}
                name="url"
                onChange={handleTestedValueChange}
                placeholder="https://search.example.com:9200"
                required
                spellCheck={false}
                type="url"
              />
            </FieldContent>
            <FieldDescription>
              <ClientMessage message="platform.search.form.url_help" />
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>
              <ClientMessage message="platform.search.form.index" />
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="off"
                defaultValue={settings.index}
                disabled={disabled}
                name="index"
                placeholder="publira-catalog"
                spellCheck={false}
                type="text"
              />
            </FieldContent>
            <FieldDescription>
              <ClientMessage message="platform.search.form.index_help" />
            </FieldDescription>
          </Field>

          <SearchCredentialFields
            disabled={disabled}
            onCredentialChange={handleTestedValueChange}
            settings={settings}
          />

          <SearchConnectionTest
            action={testAction}
            disabled={disabled}
            key={testedValues}
          />
        </>
      )}
    </>
  );
};
