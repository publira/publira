import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { PlatformSearchSettings } from "#lib/search-settings-shared";

import {
  testPlatformSearchConnectionAction,
  updatePlatformSearchSettingsAction,
} from "../_lib/actions";
import { SearchEngineFields } from "./search-engine-fields";

interface SearchSettingsFormProps {
  loadErrorMessage?: string;
  settings: PlatformSearchSettings;
}

export const SearchSettingsForm = ({
  loadErrorMessage,
  settings,
}: SearchSettingsFormProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="platform.search.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.search.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>

    {loadErrorMessage ? (
      <FormMessage className="sm:max-w-3xl" variant="destructive">
        {loadErrorMessage}
      </FormMessage>
    ) : null}

    <ActionForm.Root
      action={updatePlatformSearchSettingsAction}
      className="grid gap-5 sm:max-w-3xl"
    >
      <input name="revision" type="hidden" value={settings.revision} />

      {/* A save refreshes the settings; the new revision remounts the fields
          instead of changing a mounted field's default. */}
      <SearchEngineFields
        disabled={Boolean(loadErrorMessage)}
        key={settings.revision}
        settings={settings}
        testAction={testPlatformSearchConnectionAction}
      />

      <div className="flex justify-end">
        <ActionForm.Submit disabled={Boolean(loadErrorMessage)}>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="platform.search.save" />
          </Suspense>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  </ConsoleSection.Root>
);
