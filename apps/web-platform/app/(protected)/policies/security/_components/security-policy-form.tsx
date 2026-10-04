import {
  ActionForm,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Fragment, Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSectionTitle,
} from "#components/platform-page";
import type { PlatformSecurityPolicy } from "#lib/platform-policy";

import { PolicyLimitField } from "../../_components/policy-limit-field";
import { updatePlatformSecurityPolicyAction } from "../../_lib/actions";

export const SecurityPolicyForm = ({
  values,
  revision,
  loadErrorMessage,
}: {
  values: PlatformSecurityPolicy;
  revision: string;
  loadErrorMessage?: string;
}) => (
  <PlatformSection>
    <PlatformSectionHeader>
      <PlatformSectionHeading>
        <PlatformSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="platform.policy.security.title" />
          </Suspense>
        </PlatformSectionTitle>
        <PlatformSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.policy.security.description" />
          </Suspense>
        </PlatformSectionDescription>
      </PlatformSectionHeading>
    </PlatformSectionHeader>
    <ActionForm
      action={updatePlatformSecurityPolicyAction}
      className="grid gap-4 sm:max-w-3xl"
    >
      <input name="revision" type="hidden" value={revision} />
      {/* A save refreshes the policy; the new revision remounts the fields
          instead of changing a mounted field's default. */}
      <Fragment key={revision}>
        <div className="grid gap-4 sm:grid-cols-2">
          <PolicyLimitField
            defaultValue={values.passwordVerification.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="password_verification_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.password_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.passwordVerification.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="password_verification_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.password_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.mailRequestsPerAddress.perHour}
            disabled={Boolean(loadErrorMessage)}
            name="mail_requests_per_address_per_hour"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.mail_address_per_hour" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.mailRequestsPerAddress.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="mail_requests_per_address_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.mail_address_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.mailRequestsPerSource.perHour}
            disabled={Boolean(loadErrorMessage)}
            name="mail_requests_per_source_per_hour"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.mail_source_per_hour" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.mailRequestsPerSource.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="mail_requests_per_source_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.mail_source_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.storePurchaseConfirmation.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="store_purchase_confirmation_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.store_purchase_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.storePurchaseConfirmation.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="store_purchase_confirmation_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.store_purchase_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.waitFreeTicketUse.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="wait_free_ticket_use_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.wait_free_ticket_use_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.waitFreeTicketUse.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="wait_free_ticket_use_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.wait_free_ticket_use_per_day" />
            </Suspense>
          </PolicyLimitField>
        </div>
        <Field className="flex items-center gap-2">
          <Checkbox
            defaultChecked={values.mfaRequiredForTenantAdmin}
            disabled={Boolean(loadErrorMessage)}
            name="mfa_required_for_tenant_admin"
          />
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="platform.policy.security.mfa_required" />
            </Suspense>
          </FieldLabel>
        </Field>
        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
              <Message message="platform.policy.security.disposable_email_domains_url" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="off"
              defaultValue={values.disposableEmailDomainsUrl}
              disabled={Boolean(loadErrorMessage)}
              name="disposable_email_domains_url"
              placeholder="https://example.com/disposable_email_blocklist.conf"
              spellCheck={false}
              type="url"
            />
          </FieldContent>
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-3 w-80" />}>
              <Message message="platform.policy.security.disposable_email_domains_url_help" />
            </Suspense>
          </FieldDescription>
        </Field>
      </Fragment>
      {loadErrorMessage ? (
        <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
      ) : null}
      <div className="mt-2 flex justify-end">
        <ActionFormSubmit disabled={Boolean(loadErrorMessage)}>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="platform.policy.security.save" />
          </Suspense>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </PlatformSection>
);
