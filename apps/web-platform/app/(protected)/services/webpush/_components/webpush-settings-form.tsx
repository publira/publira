import {
  ActionForm,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSectionTitle,
} from "#components/platform-page";
import type { PlatformWebPushSettings } from "#lib/webpush-settings";

import { updatePlatformWebPushSubjectAction } from "../_lib/actions";

interface WebPushSettingsFormProps {
  loadErrorMessage?: string;
  settings: PlatformWebPushSettings;
}

export const WebPushSettingsForm = ({
  loadErrorMessage,
  settings,
}: WebPushSettingsFormProps) => (
  <PlatformSection>
    <PlatformSectionHeader>
      <PlatformSectionHeading>
        <PlatformSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="platform.webpush.title" />
          </Suspense>
        </PlatformSectionTitle>
        <PlatformSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.webpush.description" />
          </Suspense>
        </PlatformSectionDescription>
      </PlatformSectionHeading>
    </PlatformSectionHeader>

    {loadErrorMessage ? (
      <FormMessage className="sm:max-w-3xl" variant="destructive">
        {loadErrorMessage}
      </FormMessage>
    ) : null}
    {!loadErrorMessage && settings.configured ? (
      <FormMessage className="sm:max-w-3xl" variant="success">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="platform.webpush.configured" />
        </Suspense>
      </FormMessage>
    ) : null}
    {loadErrorMessage || settings.configured ? null : (
      <FormMessage className="sm:max-w-3xl" variant="warning">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="platform.webpush.unconfigured" />
        </Suspense>
      </FormMessage>
    )}

    <ActionForm
      action={updatePlatformWebPushSubjectAction}
      className="grid gap-5 sm:max-w-3xl"
    >
      <input name="revision" type="hidden" value={settings.revision} />

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.webpush.form.subject" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="off"
            defaultValue={settings.subject}
            disabled={Boolean(loadErrorMessage)}
            name="subject"
            placeholder="mailto:push@example.com"
            required
            spellCheck={false}
            type="text"
          />
        </FieldContent>
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
            <Message message="platform.webpush.form.subject_help" />
          </Suspense>
        </FieldDescription>
      </Field>

      <div className="flex justify-end">
        <ActionFormSubmit disabled={Boolean(loadErrorMessage)}>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="platform.webpush.save" />
          </Suspense>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </PlatformSection>
);
