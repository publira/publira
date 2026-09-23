import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "#components/action-form";
import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import { TenantIdField } from "#components/tenant-id-field";
import { getMe } from "#lib/auth";
import { getMessages } from "#lib/get-messages";
import { getPageAlternates } from "#lib/page-alternates";
import { getTenantId } from "#lib/tenant-id";

import { RetainedInput, RetainedTextarea } from "./_components/retained-fields";
import { submitContactMessageAction } from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const [t, alternates] = await Promise.all([
    getMessages(),
    getPageAlternates("/contact"),
  ]);

  return { alternates, title: t("host.contact.title") };
};

/**
 * The reply-to address, filled in with the signed-in reader's own. It is still
 * the reader's to change, because the address they can be reached at is not
 * always the one they signed up with; a guest starts from an empty field.
 *
 * The whole field waits on the read rather than the input alone: Base UI
 * registers the label and description ids from the field's own Effects, so a
 * control that hydrates after them would not match the server's HTML.
 */
const ReplyToEmailField = async () => {
  const tenantId = await getTenantId();
  const me = await getMe(tenantId);

  return (
    <Field>
      <FieldLabel htmlFor="replyToEmail" required>
        <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
          <Message message="host.contact.email_label" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <RetainedInput
          autoComplete="email"
          defaultValue={me?.email ?? ""}
          id="replyToEmail"
          name="replyToEmail"
          placeholder="your@email.com"
          required
          type="email"
        />
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message message="host.contact.email_help" />
          </Suspense>
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};

/** The same three rows the field draws, at the heights they render at. */
const ReplyToEmailFieldSkeleton = () => (
  <div aria-hidden="true" className="grid gap-2">
    <SkeletonLine className="h-4 w-36" />
    <Skeleton className="h-10 w-full" />
    <SkeletonLine className="h-4 w-64" />
  </div>
);

const ContactPage = () => (
  <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
    <header className="space-y-2 border-b border-border/50 pb-6">
      <h1 className="text-2xl font-semibold">
        <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
          <Message message="host.contact.heading" />
        </Suspense>
      </h1>
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="host.contact.description" />
        </Suspense>
      </p>
    </header>

    <ActionForm action={submitContactMessageAction} className="grid gap-4">
      <LocaleField />
      <TenantIdField />

      <Suspense fallback={<ReplyToEmailFieldSkeleton />}>
        <ReplyToEmailField />
      </Suspense>

      <Field>
        <FieldLabel htmlFor="subject">
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="host.contact.subject_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <RetainedInput id="subject" name="subject" type="text" />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="body" required>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="host.contact.body_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          {/* No `maxLength`: it counts UTF-16 code units, while the API counts
              Unicode code points. The Action checks the real limit. */}
          <RetainedTextarea id="body" name="body" required rows={8} />
        </FieldContent>
      </Field>

      <ActionFormSubmit className="justify-self-start">
        <ActionFormIdle>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="host.contact.submit" />
          </Suspense>
        </ActionFormIdle>
        <ActionFormPending>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.contact.submitting" />
          </Suspense>
        </ActionFormPending>
      </ActionFormSubmit>
    </ActionForm>
  </div>
);

export default ContactPage;
