import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Fragment, Suspense } from "react";

import { Message } from "#components/message";
import type { PlatformStorageSettings } from "#lib/storage-settings-shared";

import {
  testPlatformStorageConnectionAction,
  updatePlatformStorageSettingsAction,
} from "../_lib/actions";
import { StorageConnectionTest } from "./storage-connection-test";
import { StorageCredentialFields } from "./storage-credential-fields";

interface StorageSettingsFormProps {
  loadErrorMessage?: string;
  settings: PlatformStorageSettings;
}

export const StorageSettingsForm = ({
  loadErrorMessage,
  settings,
}: StorageSettingsFormProps) => {
  const isUnconfigured = !loadErrorMessage && settings.revision === "0";

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="platform.storage.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="platform.storage.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>

      {loadErrorMessage ? (
        <FormMessage className="sm:max-w-3xl" variant="destructive">
          {loadErrorMessage}
        </FormMessage>
      ) : null}
      {isUnconfigured ? (
        <FormMessage className="sm:max-w-3xl" variant="warning">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.storage.unconfigured" />
          </Suspense>
        </FormMessage>
      ) : null}

      <ActionForm.Root
        action={updatePlatformStorageSettingsAction}
        className="grid gap-5 sm:max-w-3xl"
      >
        <input name="revision" type="hidden" value={settings.revision} />

        {/* A save refreshes the settings; the new revision remounts the fields
            instead of changing a mounted field's default. */}
        <Fragment key={settings.revision}>
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.storage.form.bucket" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                autoComplete="off"
                defaultValue={settings.bucket}
                disabled={Boolean(loadErrorMessage)}
                name="bucket"
                placeholder="publira-media"
                required
                spellCheck={false}
                type="text"
              />
            </Field.Content>
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
                <Message message="platform.storage.form.bucket_help" />
              </Suspense>
            </Field.Description>
          </Field.Root>

          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.storage.form.region" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                autoComplete="off"
                defaultValue={settings.region}
                disabled={Boolean(loadErrorMessage)}
                name="region"
                placeholder="us-east-1"
                required
                spellCheck={false}
                type="text"
              />
            </Field.Content>
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
                <Message message="platform.storage.form.region_help" />
              </Suspense>
            </Field.Description>
          </Field.Root>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.storage.form.public_base_url" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                autoComplete="off"
                defaultValue={settings.publicBaseUrl}
                disabled={Boolean(loadErrorMessage)}
                name="public_base_url"
                placeholder="https://media.example.com"
                spellCheck={false}
                type="url"
              />
            </Field.Content>
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
                <Message message="platform.storage.form.public_base_url_help" />
              </Suspense>
            </Field.Description>
          </Field.Root>

          <fieldset className="grid gap-4">
            <legend className="mb-1 text-sm font-medium text-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="platform.storage.form.advanced_legend" />
              </Suspense>
            </legend>
            <p className="text-xs text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-3 w-72" />}>
                <Message message="platform.storage.form.advanced_help" />
              </Suspense>
            </p>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="platform.storage.form.endpoint" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Input
                  autoComplete="off"
                  defaultValue={settings.endpoint}
                  disabled={Boolean(loadErrorMessage)}
                  name="endpoint"
                  placeholder="https://s3.example.com"
                  spellCheck={false}
                  type="url"
                />
              </Field.Content>
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
                  <Message message="platform.storage.form.endpoint_help" />
                </Suspense>
              </Field.Description>
            </Field.Root>

            <Field.Root>
              <div className="flex items-center gap-2">
                <Checkbox
                  defaultChecked={settings.forcePathStyle}
                  disabled={Boolean(loadErrorMessage)}
                  name="force_path_style"
                />
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="platform.storage.form.force_path_style" />
                  </Suspense>
                </Field.Label>
              </div>
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
                  <Message message="platform.storage.form.force_path_style_help" />
                </Suspense>
              </Field.Description>
            </Field.Root>
          </fieldset>

          <StorageCredentialFields settings={settings} />
        </Fragment>

        <StorageConnectionTest action={testPlatformStorageConnectionAction} />

        <div className="flex justify-end">
          <ActionForm.Submit disabled={Boolean(loadErrorMessage)}>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="platform.storage.save" />
            </Suspense>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </ConsoleSection.Root>
  );
};
