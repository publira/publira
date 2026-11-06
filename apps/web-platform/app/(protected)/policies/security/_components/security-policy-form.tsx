import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Fragment, Suspense } from "react";

import { Message } from "#components/message";
import type { PlatformSecurityPolicy } from "#lib/platform-policy";

import { PolicyLimitField } from "../../_components/policy-limit-field";
import { updatePlatformSecurityPolicyAction } from "../../_lib/actions";
import { MIN_ANONYMOUS_READS } from "../../_lib/form-schemas";

export const SecurityPolicyForm = ({
  values,
  revision,
  loadErrorMessage,
}: {
  values: PlatformSecurityPolicy;
  revision: string;
  loadErrorMessage?: string;
}) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="platform.policy.security.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.policy.security.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>
    <ActionForm.Root
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
          <PolicyLimitField
            defaultValue={values.legalPageAgreement.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="legal_page_agreement_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.legal_page_agreement_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.legalPageAgreement.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="legal_page_agreement_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.legal_page_agreement_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.identityLink.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="identity_link_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.identity_link_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.identityLink.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="identity_link_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.identity_link_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.iconChange.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="icon_change_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.icon_change_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.iconChange.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="icon_change_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.icon_change_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.passkey.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="passkey_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.passkey_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.passkey.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="passkey_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.passkey_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.seriesRemainderCheckout.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="series_remainder_checkout_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.series_remainder_checkout_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.seriesRemainderCheckout.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="series_remainder_checkout_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.series_remainder_checkout_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.subscriptionCheckout.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="subscription_checkout_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.subscription_checkout_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.subscriptionCheckout.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="subscription_checkout_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.subscription_checkout_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.coinPayment.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="coin_payment_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.coin_payment_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.coinPayment.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="coin_payment_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.coin_payment_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.purchaseCheckout.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="purchase_checkout_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.purchase_checkout_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.purchaseCheckout.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="purchase_checkout_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.purchase_checkout_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.promotionCodeAttempt.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="promotion_code_attempt_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.promotion_code_attempt_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.promotionCodeAttempt.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="promotion_code_attempt_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.promotion_code_attempt_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.dataExport.perHour}
            disabled={Boolean(loadErrorMessage)}
            name="data_export_per_hour"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.data_export_per_hour" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.dataExport.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="data_export_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.data_export_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.apiKeyRequest.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="api_key_request_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.api_key_request_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.apiKeyRequest.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="api_key_request_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.api_key_request_per_day" />
            </Suspense>
          </PolicyLimitField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <PolicyLimitField
            defaultValue={values.loginAttemptsPerAccount.perMinute}
            disabled={Boolean(loadErrorMessage)}
            name="login_attempts_per_account_per_minute"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.login_attempts_per_account_per_minute" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.loginAttemptsPerAccount.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="login_attempts_per_account_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.login_attempts_per_account_per_day" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.loginAttemptsPerSource.perHour}
            disabled={Boolean(loadErrorMessage)}
            name="login_attempts_per_source_per_hour"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.login_attempts_per_source_per_hour" />
            </Suspense>
          </PolicyLimitField>
          <PolicyLimitField
            defaultValue={values.loginAttemptsPerSource.perDay}
            disabled={Boolean(loadErrorMessage)}
            name="login_attempts_per_source_per_day"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.policy.security.login_attempts_per_source_per_day" />
            </Suspense>
          </PolicyLimitField>
        </div>
        <fieldset className="grid gap-4">
          <legend className="mb-2 text-sm font-medium text-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.policy.security.anonymous_read_legend" />
            </Suspense>
          </legend>
          <p className="text-xs text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-3 w-80" />}>
              <Message message="platform.policy.security.anonymous_read_help" />
            </Suspense>
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <PolicyLimitField
              defaultValue={values.anonymousReadLimits.publicApi}
              disabled={Boolean(loadErrorMessage)}
              min={MIN_ANONYMOUS_READS.publicApi}
              name="anonymous_read_public_api_per_10_seconds"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="platform.policy.security.anonymous_read_public_api" />
              </Suspense>
            </PolicyLimitField>
            <PolicyLimitField
              defaultValue={values.anonymousReadLimits.search}
              disabled={Boolean(loadErrorMessage)}
              min={MIN_ANONYMOUS_READS.search}
              name="anonymous_read_search_per_10_seconds"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="platform.policy.security.anonymous_read_search" />
              </Suspense>
            </PolicyLimitField>
            <PolicyLimitField
              defaultValue={values.anonymousReadLimits.images}
              disabled={Boolean(loadErrorMessage)}
              min={MIN_ANONYMOUS_READS.images}
              name="anonymous_read_images_per_10_seconds"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="platform.policy.security.anonymous_read_images" />
              </Suspense>
            </PolicyLimitField>
          </div>
        </fieldset>
        <Field.Root>
          <div className="flex items-center gap-2">
            <Checkbox
              defaultChecked={values.tenantCoinsAllowed}
              disabled={Boolean(loadErrorMessage)}
              name="tenant_coins_allowed"
            />
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="platform.policy.security.tenant_coins_allowed" />
              </Suspense>
            </Field.Label>
          </div>
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-3 w-80" />}>
              <Message message="platform.policy.security.tenant_coins_allowed_help" />
            </Suspense>
          </Field.Description>
        </Field.Root>
        <Field.Root className="flex items-center gap-2">
          <Checkbox
            defaultChecked={values.mfaRequiredForPlatformOperator}
            disabled={Boolean(loadErrorMessage)}
            name="mfa_required_for_platform_operator"
          />
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="platform.policy.security.mfa_required_for_platform_operator" />
            </Suspense>
          </Field.Label>
        </Field.Root>
        <Field.Root className="flex items-center gap-2">
          <Checkbox
            defaultChecked={values.mfaRequiredForTenantAdmin}
            disabled={Boolean(loadErrorMessage)}
            name="mfa_required_for_tenant_admin"
          />
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="platform.policy.security.mfa_required" />
            </Suspense>
          </Field.Label>
        </Field.Root>
        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
              <Message message="platform.policy.security.disposable_email_domains_url" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              autoComplete="off"
              defaultValue={values.disposableEmailDomainsUrl}
              disabled={Boolean(loadErrorMessage)}
              name="disposable_email_domains_url"
              placeholder="https://example.com/disposable_email_blocklist.conf"
              spellCheck={false}
              type="url"
            />
          </Field.Content>
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-3 w-80" />}>
              <Message message="platform.policy.security.disposable_email_domains_url_help" />
            </Suspense>
          </Field.Description>
        </Field.Root>
      </Fragment>
      {loadErrorMessage ? (
        <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
      ) : null}
      <div className="mt-2 flex justify-end">
        <ActionForm.Submit disabled={Boolean(loadErrorMessage)}>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="platform.policy.security.save" />
          </Suspense>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  </ConsoleSection.Root>
);
