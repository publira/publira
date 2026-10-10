import {
  ActionForm,
  ActionFormFieldError,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { StatusChip } from "@publira/ui-components/badge";
import type { BadgeTone } from "@publira/ui-components/badge";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Identifier, IdentifierValue } from "@publira/ui-components/identifier";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
} from "#components/admin-page";
import {
  CredentialsEnabled,
  CredentialsEnabledCheckbox,
  CredentialsEnabledLabel,
  SecretKey,
  SecretKeyFile,
  SecretKeyModeButton,
  SecretKeyText,
  SecretKeyWhile,
} from "#components/credential-controls";
import { Message } from "#components/message";
import { storeStatus } from "#lib/store-payment-settings-shared";
import type { StoreStatus } from "#lib/store-payment-settings-shared";
import type { SignInProvider } from "#lib/storefront-url";
import type { TenantSignInSettings } from "#lib/tenant-sign-in-settings";

import { updateTenantSignInSettingsAction } from "../_lib/actions";
import { signInOffers } from "../_lib/offers";
import type { SignInOffer, SignInSurface } from "../_lib/offers";
import { CallbackUrlCopy } from "./callback-url-copy";
import { EmailSenderCopy } from "./email-sender-copy";

const statusTone: Record<StoreStatus, BadgeTone> = {
  disabled: "muted",
  incomplete: "warning",
  ready: "success",
  unset: "muted",
};

const ProviderStatusLabel = ({ status }: { status: StoreStatus }) => {
  switch (status) {
    case "disabled": {
      return <Message message="admin.settings.sign_in.status.disabled" />;
    }
    case "incomplete": {
      return <Message message="admin.settings.sign_in.status.incomplete" />;
    }
    case "ready": {
      return <Message message="admin.settings.sign_in.status.ready" />;
    }
    default: {
      return <Message message="admin.settings.sign_in.status.unset" />;
    }
  }
};

const ProviderStatusDescription = ({ status }: { status: StoreStatus }) => {
  switch (status) {
    case "disabled": {
      return (
        <Message message="admin.settings.sign_in.status.disabled_description" />
      );
    }
    case "incomplete": {
      return (
        <Message message="admin.settings.sign_in.status.incomplete_description" />
      );
    }
    case "ready": {
      return (
        <Message message="admin.settings.sign_in.status.ready_description" />
      );
    }
    default: {
      return (
        <Message message="admin.settings.sign_in.status.unset_description" />
      );
    }
  }
};

const ProviderStatusLine = ({ status }: { status: StoreStatus }) => (
  <div className="flex flex-wrap items-center gap-3">
    <StatusChip status={statusTone[status]}>
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <ProviderStatusLabel status={status} />
      </Suspense>
    </StatusChip>
    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
        <ProviderStatusDescription status={status} />
      </Suspense>
    </p>
  </div>
);

const SurfaceLabel = ({ surface }: { surface: SignInSurface }) => {
  switch (surface) {
    case "android": {
      return <Message message="admin.settings.sign_in.offers.android" />;
    }
    case "ios": {
      return <Message message="admin.settings.sign_in.offers.ios" />;
    }
    default: {
      return <Message message="admin.settings.sign_in.offers.site" />;
    }
  }
};

/** What a surface still needs before it shows the Apple button. */
const AppleNotOffered = ({ surface }: { surface: SignInSurface }) => {
  switch (surface) {
    case "android": {
      return (
        <Message message="admin.settings.sign_in.apple.not_offered.android" />
      );
    }
    case "ios": {
      return <Message message="admin.settings.sign_in.apple.not_offered.ios" />;
    }
    default: {
      return (
        <Message message="admin.settings.sign_in.apple.not_offered.site" />
      );
    }
  }
};

/** What a surface still needs before it shows the Google button. */
const GoogleNotOffered = ({ surface }: { surface: SignInSurface }) => {
  switch (surface) {
    case "android": {
      return (
        <Message message="admin.settings.sign_in.google.not_offered.android" />
      );
    }
    case "ios": {
      return (
        <Message message="admin.settings.sign_in.google.not_offered.ios" />
      );
    }
    default: {
      return (
        <Message message="admin.settings.sign_in.google.not_offered.site" />
      );
    }
  }
};

const Shown = ({
  provider,
  surface,
}: {
  provider: SignInProvider;
  surface: SignInSurface;
}) =>
  // The iOS app also has to be built with the iOS client ID, which the console
  // cannot see, so that row says so instead of claiming the button.
  provider === "google" && surface === "ios" ? (
    <Message message="admin.settings.sign_in.google.shown_ios" />
  ) : (
    <Message message="admin.settings.sign_in.offers.shown" />
  );

const NotOffered = ({
  provider,
  surface,
}: {
  provider: SignInProvider;
  surface: SignInSurface;
}) =>
  provider === "apple" ? (
    <AppleNotOffered surface={surface} />
  ) : (
    <GoogleNotOffered surface={surface} />
  );

/**
 * Where an offered provider's button appears. A provider that is offered can
 * still be missing from the site, which its state alone does not say.
 */
const ProviderOffers = ({
  appLinksErrorMessage,
  offers,
  provider,
}: {
  /**
   * Why the Android app named under App links could not be read, which leaves
   * the Android app's row without an answer.
   */
  appLinksErrorMessage?: string;
  offers: SignInOffer[];
  provider: SignInProvider;
}) => (
  <div className="grid gap-2">
    <p className="text-sm font-medium text-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
        <Message message="admin.settings.sign_in.offers.title" />
      </Suspense>
    </p>
    <dl className="grid gap-2 text-sm">
      {offers.map(({ offered, surface }) => (
        <div className="grid gap-1 sm:grid-cols-[8rem_1fr]" key={surface}>
          <dt className="text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <SurfaceLabel surface={surface} />
            </Suspense>
          </dt>
          <dd className={offered ? "text-foreground" : "text-muted-foreground"}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              {offered ? (
                <Shown provider={provider} surface={surface} />
              ) : (
                <NotOffered provider={provider} surface={surface} />
              )}
            </Suspense>
          </dd>
        </div>
      ))}
      {appLinksErrorMessage ? (
        <div className="grid gap-1 sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <SurfaceLabel surface="android" />
            </Suspense>
          </dt>
          <dd>
            <FormMessage variant="destructive">
              {appLinksErrorMessage}
            </FormMessage>
          </dd>
        </div>
      ) : null}
    </dl>
  </div>
);

const EmailSenderValue = ({
  errorMessage,
  fromAddress,
}: {
  errorMessage?: string;
  fromAddress?: string;
}) => {
  if (errorMessage) {
    return <FormMessage variant="destructive">{errorMessage}</FormMessage>;
  }
  if (!fromAddress) {
    return (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="admin.settings.sign_in.apple.email_sender_unset" />
        </Suspense>
      </p>
    );
  }
  return (
    <Identifier>
      <IdentifierValue>{fromAddress}</IdentifierValue>
      <EmailSenderCopy value={fromAddress} />
    </Identifier>
  );
};

/**
 * The sender Apple's private email relay has to know, or why it could not be
 * read. A Hide My Email address only receives mail from a registered sender.
 */
const AppleEmailSender = ({
  errorMessage,
  fromAddress,
}: {
  errorMessage?: string;
  fromAddress?: string;
}) =>
  fromAddress === undefined && !errorMessage ? null : (
    <Field>
      <FieldLabel>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="admin.settings.sign_in.apple.email_sender" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <EmailSenderValue
          errorMessage={errorMessage}
          fromAddress={fromAddress}
        />
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.settings.sign_in.apple.email_sender_description" />
          </Suspense>
        </FieldDescription>
      </FieldContent>
    </Field>
  );

/**
 * Each provider's callback URL on the storefront, and the one Apple answers
 * the Android app's sign-in at.
 */
type SignInCallbackUrls = Partial<
  Record<SignInProvider | "appleAndroid", string>
>;

interface TenantSignInSettingsFormProps {
  /**
   * The Android app named under App links, empty where none is named, and
   * absent where that read failed.
   */
  androidApplicationId?: string;
  /** Why App links could not be read, absent when they were. */
  appLinksErrorMessage?: string;
  /** The callback URLs to register, absent while the tenant has no domain. */
  callbackUrls?: SignInCallbackUrls;
  canEdit: boolean;
  /**
   * The address the tenant's mail is sent from, empty where the settings in
   * force name none, and absent where that read failed.
   */
  emailSender?: string;
  /** Why the email sender could not be read, absent when it was. */
  emailSenderErrorMessage?: string;
  /** The saved settings, absent when the read failed. */
  initialSettings?: TenantSignInSettings;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantSignInSettingsForm = ({
  androidApplicationId,
  appLinksErrorMessage,
  callbackUrls,
  canEdit,
  emailSender,
  emailSenderErrorMessage,
  initialSettings: settings,
  loadErrorMessage,
  tenantId,
}: TenantSignInSettingsFormProps) => {
  // A failed read leaves nothing to seed the fields with, and a save from that
  // state would write over what is stored.
  const fieldsDisabled = !canEdit || settings === undefined;
  const offers =
    settings === undefined
      ? undefined
      : signInOffers(settings, androidApplicationId);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.sign_in.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantSignInSettingsAction}
        className="grid gap-8 sm:max-w-3xl"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        {settings === undefined ? null : (
          // A save refreshes the settings; keying on them remounts the fields
          // on what the API stored instead of changing a mounted default.
          <div className="grid gap-8" key={JSON.stringify(settings)}>
            <CredentialsEnabled initialEnabled={settings.apple.enabled}>
              <fieldset className="grid gap-5">
                <legend className="mb-3 text-base font-semibold text-foreground">
                  <Suspense fallback={<SkeletonLine className="h-5 w-16" />}>
                    <Message message="admin.settings.sign_in.apple.title" />
                  </Suspense>
                </legend>
                <ProviderStatusLine
                  status={storeStatus({
                    enabled: settings.apple.enabled,
                    keyConfigured: settings.apple.privateKeyConfigured,
                    ready: settings.apple.ready,
                  })}
                />
                {settings.apple.ready && offers ? (
                  <ProviderOffers
                    appLinksErrorMessage={appLinksErrorMessage}
                    offers={offers.apple}
                    provider="apple"
                  />
                ) : null}
                {/* Registered with the provider rather than saved here, so it
                    sits outside the fieldset an operator without edit access
                    sees disabled: whoever holds the provider account can still
                    copy it. */}
                {callbackUrls?.apple ? (
                  <Field>
                    <FieldLabel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="admin.settings.sign_in.callback_url" />
                      </Suspense>
                    </FieldLabel>
                    <FieldContent>
                      <Identifier>
                        <IdentifierValue>{callbackUrls.apple}</IdentifierValue>
                        <CallbackUrlCopy value={callbackUrls.apple} />
                      </Identifier>
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.sign_in.apple.callback_url_description" />
                        </Suspense>
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                ) : null}
                {callbackUrls?.appleAndroid ? (
                  <Field>
                    <FieldLabel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.settings.sign_in.apple.android_callback_url" />
                      </Suspense>
                    </FieldLabel>
                    <FieldContent>
                      <Identifier>
                        <IdentifierValue>
                          {callbackUrls.appleAndroid}
                        </IdentifierValue>
                        <CallbackUrlCopy value={callbackUrls.appleAndroid} />
                      </Identifier>
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.sign_in.apple.android_callback_url_description" />
                        </Suspense>
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                ) : null}
                <AppleEmailSender
                  errorMessage={emailSenderErrorMessage}
                  fromAddress={emailSender}
                />
                <ActionFormFieldset
                  className="grid gap-5"
                  disabled={fieldsDisabled}
                >
                  <CredentialsEnabledCheckbox name="apple_enabled">
                    <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                      <Message message="admin.settings.sign_in.apple.enabled" />
                    </Suspense>
                  </CredentialsEnabledCheckbox>
                  <Field>
                    <FieldLabel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="admin.settings.sign_in.apple.services_id" />
                      </Suspense>
                    </FieldLabel>
                    <FieldContent>
                      <Input
                        autoCapitalize="off"
                        autoComplete="off"
                        defaultValue={settings.apple.servicesId}
                        name="apple_services_id"
                        placeholder="com.example.web"
                        spellCheck={false}
                        type="text"
                      />
                      <ActionFormFieldError name="servicesId" />
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.sign_in.apple.services_id_description" />
                        </Suspense>
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                  <Field>
                    <CredentialsEnabledLabel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-20" />}
                      >
                        <Message message="admin.settings.sign_in.apple.team_id" />
                      </Suspense>
                    </CredentialsEnabledLabel>
                    <FieldContent>
                      <Input
                        autoCapitalize="characters"
                        autoComplete="off"
                        defaultValue={settings.apple.teamId}
                        maxLength={10}
                        name="apple_team_id"
                        placeholder="ABCDE12345"
                        spellCheck={false}
                        type="text"
                      />
                      <ActionFormFieldError name="teamId" />
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.sign_in.apple.team_id_description" />
                        </Suspense>
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                  <Field>
                    <CredentialsEnabledLabel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="admin.settings.sign_in.apple.key_id" />
                      </Suspense>
                    </CredentialsEnabledLabel>
                    <FieldContent>
                      <Input
                        autoCapitalize="characters"
                        autoComplete="off"
                        defaultValue={settings.apple.keyId}
                        maxLength={10}
                        name="apple_key_id"
                        placeholder="2X9R4HXF34"
                        spellCheck={false}
                        type="text"
                      />
                      <ActionFormFieldError name="keyId" />
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.sign_in.apple.key_id_description" />
                        </Suspense>
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                  <SecretKey
                    accept=".p8"
                    configured={settings.apple.privateKeyConfigured}
                    name="apple_private_key"
                  >
                    <SecretKeyWhile mode="keep">
                      <Field>
                        <FieldLabel>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-28" />}
                          >
                            <Message message="admin.settings.sign_in.apple.private_key" />
                          </Suspense>
                        </FieldLabel>
                        <FieldContent>
                          <div className="flex flex-wrap items-center gap-3">
                            <Input
                              disabled
                              readOnly
                              type="text"
                              value={settings.apple.privateKeyHint}
                            />
                            <SecretKeyModeButton mode="replace">
                              <Suspense
                                fallback={<SkeletonLine className="h-4 w-16" />}
                              >
                                <Message message="admin.settings.sign_in.key_change" />
                              </Suspense>
                            </SecretKeyModeButton>
                            <SecretKeyModeButton mode="clear">
                              <Suspense
                                fallback={<SkeletonLine className="h-4 w-16" />}
                              >
                                <Message message="admin.settings.sign_in.key_clear" />
                              </Suspense>
                            </SecretKeyModeButton>
                          </div>
                          <ActionFormFieldError name="privateKey" />
                          <FieldDescription>
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-3/4" />}
                            >
                              <Message message="admin.settings.sign_in.apple.private_key_description" />
                            </Suspense>
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    </SecretKeyWhile>
                    <SecretKeyWhile mode="replace">
                      <Field>
                        <CredentialsEnabledLabel>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-28" />}
                          >
                            <Message message="admin.settings.sign_in.apple.private_key" />
                          </Suspense>
                        </CredentialsEnabledLabel>
                        <FieldContent>
                          <SecretKeyFile />
                          <FieldDescription>
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-3/4" />}
                            >
                              <Message message="admin.settings.sign_in.apple.private_key_description" />
                            </Suspense>
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                      <Field>
                        <FieldLabel>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-32" />}
                          >
                            <Message message="admin.settings.sign_in.key_text" />
                          </Suspense>
                        </FieldLabel>
                        <FieldContent>
                          <SecretKeyText />
                          <ActionFormFieldError name="privateKey" />
                          {settings.apple.privateKeyConfigured ? (
                            <div>
                              <SecretKeyModeButton mode="keep">
                                <Suspense
                                  fallback={
                                    <SkeletonLine className="h-4 w-24" />
                                  }
                                >
                                  <Message message="admin.settings.sign_in.key_change_cancel" />
                                </Suspense>
                              </SecretKeyModeButton>
                            </div>
                          ) : null}
                        </FieldContent>
                      </Field>
                    </SecretKeyWhile>
                    <SecretKeyWhile mode="clear">
                      <Field>
                        <FieldLabel>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-28" />}
                          >
                            <Message message="admin.settings.sign_in.apple.private_key" />
                          </Suspense>
                        </FieldLabel>
                        <FieldContent>
                          <div className="flex flex-wrap items-center gap-3">
                            <p className="text-sm text-foreground">
                              <Suspense
                                fallback={<SkeletonLine className="h-4 w-48" />}
                              >
                                <Message message="admin.settings.sign_in.key_cleared" />
                              </Suspense>
                            </p>
                            <SecretKeyModeButton mode="keep">
                              <Suspense
                                fallback={<SkeletonLine className="h-4 w-24" />}
                              >
                                <Message message="admin.settings.sign_in.key_clear_cancel" />
                              </Suspense>
                            </SecretKeyModeButton>
                          </div>
                          <ActionFormFieldError name="privateKey" />
                        </FieldContent>
                      </Field>
                    </SecretKeyWhile>
                  </SecretKey>
                  <Field>
                    <FieldLabel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="admin.settings.sign_in.apple.bundle_identifier" />
                      </Suspense>
                    </FieldLabel>
                    <FieldContent>
                      {settings.apple.bundleIdentifier ? (
                        <Input
                          disabled
                          readOnly
                          type="text"
                          value={settings.apple.bundleIdentifier}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-48" />}
                          >
                            <Message message="admin.settings.sign_in.not_set" />
                          </Suspense>
                        </p>
                      )}
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.sign_in.apple.bundle_identifier_description" />
                        </Suspense>
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </ActionFormFieldset>
              </fieldset>
            </CredentialsEnabled>

            <CredentialsEnabled initialEnabled={settings.google.enabled}>
              <fieldset className="grid gap-5">
                <legend className="mb-3 text-base font-semibold text-foreground">
                  <Suspense fallback={<SkeletonLine className="h-5 w-16" />}>
                    <Message message="admin.settings.sign_in.google.title" />
                  </Suspense>
                </legend>
                <ProviderStatusLine
                  status={storeStatus({
                    enabled: settings.google.enabled,
                    keyConfigured: Boolean(
                      settings.google.webClientId || settings.google.iosClientId
                    ),
                    ready: settings.google.ready,
                  })}
                />
                {settings.google.ready && offers ? (
                  <ProviderOffers offers={offers.google} provider="google" />
                ) : null}
                {callbackUrls?.google ? (
                  <Field>
                    <FieldLabel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="admin.settings.sign_in.callback_url" />
                      </Suspense>
                    </FieldLabel>
                    <FieldContent>
                      <Identifier>
                        <IdentifierValue>{callbackUrls.google}</IdentifierValue>
                        <CallbackUrlCopy value={callbackUrls.google} />
                      </Identifier>
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.sign_in.google.callback_url_description" />
                        </Suspense>
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                ) : null}
                <ActionFormFieldset
                  className="grid gap-5"
                  disabled={fieldsDisabled}
                >
                  <CredentialsEnabledCheckbox name="google_enabled">
                    <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                      <Message message="admin.settings.sign_in.google.enabled" />
                    </Suspense>
                  </CredentialsEnabledCheckbox>
                  <Field>
                    <FieldLabel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-28" />}
                      >
                        <Message message="admin.settings.sign_in.google.web_client_id" />
                      </Suspense>
                    </FieldLabel>
                    <FieldContent>
                      <Input
                        autoCapitalize="off"
                        autoComplete="off"
                        defaultValue={settings.google.webClientId}
                        name="google_web_client_id"
                        placeholder="123456789012-abc123.apps.googleusercontent.com"
                        spellCheck={false}
                        type="text"
                      />
                      <ActionFormFieldError name="webClientId" />
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.sign_in.google.web_client_id_description" />
                        </Suspense>
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-28" />}
                      >
                        <Message message="admin.settings.sign_in.google.ios_client_id" />
                      </Suspense>
                    </FieldLabel>
                    <FieldContent>
                      <Input
                        autoCapitalize="off"
                        autoComplete="off"
                        defaultValue={settings.google.iosClientId}
                        name="google_ios_client_id"
                        placeholder="123456789012-def456.apps.googleusercontent.com"
                        spellCheck={false}
                        type="text"
                      />
                      <ActionFormFieldError name="iosClientId" />
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.sign_in.google.ios_client_id_description" />
                        </Suspense>
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </ActionFormFieldset>
              </fieldset>
            </CredentialsEnabled>
          </div>
        )}

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.admin_only" />
            </Suspense>
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <ActionFormSubmit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <ActionFormIdle>
                <Message message="admin.settings.sign_in.submit" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.settings.saving" />
              </ActionFormPending>
            </Suspense>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </AdminSection>
  );
};
