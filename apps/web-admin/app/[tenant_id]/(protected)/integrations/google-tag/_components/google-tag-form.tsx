import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import * as Identifier from "@publira/ui-components/identifier";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { gatewayTagId } from "#lib/tenant-analytics-settings-shared";
import type { TenantAnalyticsSettings } from "#lib/tenant-analytics-settings-shared";

import { updateGoogleTagAction } from "../_lib/actions";
import { GatewayPathCopy } from "./gateway-path-copy";
import * as GoogleTagMode from "./google-tag-controls";

const FORM_ID = "google-tag-form";

/** The path the gateway answers on, or what has to happen for it to exist. */
const GatewayPath = ({ gatewayPath }: { gatewayPath: string }) => {
  if (!gatewayPath) {
    return (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="admin.settings.google_tag.gateway_path_unset" />
        </Suspense>
      </p>
    );
  }

  const path = `/${gatewayPath}`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Identifier.Root>
        <Identifier.Value>{path}</Identifier.Value>
        <GatewayPathCopy value={path} />
      </Identifier.Root>
      <ActionForm.Fieldset>
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            render={<Button size="sm" type="button" variant="outline" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.settings.google_tag.gateway_path_regenerate" />
            </Suspense>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="admin.settings.google_tag.gateway_path_regenerate_title" />
                </Suspense>
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="admin.settings.google_tag.gateway_path_regenerate_description" />
                </Suspense>
              </ConfirmDialog.Description>
            </ConfirmDialog.Header>
            <ConfirmDialog.Footer>
              <ConfirmDialog.Cancel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.common.cancel" />
                </Suspense>
              </ConfirmDialog.Cancel>
              <ConfirmDialog.Action
                form={FORM_ID}
                name="regenerate_gateway_path"
                value="on"
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.settings.google_tag.gateway_path_regenerate_action" />
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </div>
  );
};

interface GoogleTagFormProps {
  /** The saved settings, absent when the read failed. */
  initialSettings?: TenantAnalyticsSettings;
  loadErrorMessage?: string;
  /**
   * Whether the tenant names no published privacy policy page for the consent
   * banner to link to. False when that could not be read, so a failed read
   * raises no warning.
   */
  privacyPageMissing?: boolean;
  tenantId: string;
}

export const GoogleTagForm = ({
  initialSettings: settings,
  loadErrorMessage,
  privacyPageMissing = false,
  tenantId,
}: GoogleTagFormProps) => {
  const tagId = settings === undefined ? "" : gatewayTagId(settings);

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.google_tag.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,48rem)_minmax(0,1fr)] xl:items-start">
        <ActionForm.Root
          action={updateGoogleTagAction}
          className="grid gap-6"
          id={FORM_ID}
        >
          <input name="tenant_id" type="hidden" value={tenantId} />

          {settings === undefined ? null : (
            // A save refreshes the settings; keying on them remounts the
            // fields on what the API stored instead of changing a mounted
            // default.
            <GoogleTagMode.Root
              initialConsentMode={settings.consentMode}
              initialGtmContainerId={settings.gtmContainerId}
              initialServerContainerUrl={settings.serverContainerUrl}
              initialServingMode={settings.servingMode}
              key={JSON.stringify(settings)}
            >
              <ActionForm.Fieldset className="grid gap-6">
                <Field.Root>
                  <Field.Label>
                    <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                      <Message message="admin.settings.google_tag.measurement_id" />
                    </Suspense>
                  </Field.Label>
                  <Field.Content>
                    <Input
                      autoCapitalize="characters"
                      autoComplete="off"
                      defaultValue={settings.ga4MeasurementId}
                      name="ga4_measurement_id"
                      placeholder="G-XXXXXXXXXX"
                      spellCheck={false}
                      type="text"
                    />
                    <ActionForm.FieldError name="ga4MeasurementId" />
                    <Field.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.google_tag.measurement_id_description" />
                      </Suspense>
                    </Field.Description>
                  </Field.Content>
                </Field.Root>
                <Field.Root>
                  <Field.Label>
                    <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                      <Message message="admin.settings.google_tag.container_id" />
                    </Suspense>
                  </Field.Label>
                  <Field.Content>
                    <GoogleTagMode.ContainerIdInput />
                    <ActionForm.FieldError name="gtmContainerId" />
                    <Field.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.google_tag.container_id_description" />
                      </Suspense>
                    </Field.Description>
                  </Field.Content>
                </Field.Root>
                <Field.Root>
                  <Field.Label>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.settings.google_tag.serving_mode" />
                    </Suspense>
                  </Field.Label>
                  <Field.Content>
                    <GoogleTagMode.RadioGroup
                      items={[
                        {
                          description: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-64" />}
                            >
                              <Message message="admin.settings.google_tag.serving_modes.google.description" />
                            </Suspense>
                          ),
                          label: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-32" />}
                            >
                              <Message message="admin.settings.google_tag.serving_modes.google.label" />
                            </Suspense>
                          ),
                          value: "google",
                        },
                        {
                          description: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-64" />}
                            >
                              <Message message="admin.settings.google_tag.serving_modes.server_container.description" />
                            </Suspense>
                          ),
                          label: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-32" />}
                            >
                              <Message message="admin.settings.google_tag.serving_modes.server_container.label" />
                            </Suspense>
                          ),
                          value: "server_container",
                        },
                        {
                          description: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-64" />}
                            >
                              <Message message="admin.settings.google_tag.serving_modes.gateway.description" />
                            </Suspense>
                          ),
                          label: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-32" />}
                            >
                              <Message message="admin.settings.google_tag.serving_modes.gateway.label" />
                            </Suspense>
                          ),
                          value: "gateway",
                        },
                      ]}
                    />
                    <ActionForm.FieldError name="servingMode" />
                  </Field.Content>
                </Field.Root>

                <GoogleTagMode.While mode="server_container">
                  <Field.Root>
                    <Field.Label required>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.settings.google_tag.server_container_url" />
                      </Suspense>
                    </Field.Label>
                    <Field.Content>
                      <GoogleTagMode.ServerContainerUrlInput />
                      <ActionForm.FieldError name="serverContainerUrl" />
                      <Field.Description>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.google_tag.server_container_url_description" />
                        </Suspense>
                      </Field.Description>
                    </Field.Content>
                  </Field.Root>
                </GoogleTagMode.While>
              </ActionForm.Fieldset>

              <GoogleTagMode.While mode="gateway">
                <div className="grid gap-6">
                  {/* Registered in Google Tag Manager rather than typed here,
                      so they sit outside the fields a save submits. */}
                  <Field.Root>
                    <Field.Label>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-28" />}
                      >
                        <Message message="admin.settings.google_tag.gateway_path" />
                      </Suspense>
                    </Field.Label>
                    <Field.Content>
                      <GatewayPath gatewayPath={settings.gatewayPath} />
                      <Field.Description>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.google_tag.gateway_path_description" />
                        </Suspense>
                      </Field.Description>
                    </Field.Content>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="admin.settings.google_tag.gateway_tag_id" />
                      </Suspense>
                    </Field.Label>
                    <Field.Content>
                      {tagId ? (
                        <Identifier.Value>{tagId}</Identifier.Value>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-64" />}
                          >
                            <Message message="admin.settings.google_tag.gateway_tag_id_unset" />
                          </Suspense>
                        </p>
                      )}
                      <Field.Description>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.google_tag.gateway_tag_id_description" />
                        </Suspense>
                      </Field.Description>
                    </Field.Content>
                  </Field.Root>
                  <ActionForm.Fieldset>
                    <Field.Root>
                      <Field.Label>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-40" />}
                        >
                          <Message message="admin.settings.google_tag.server_container_url" />
                        </Suspense>
                      </Field.Label>
                      <Field.Content>
                        <GoogleTagMode.ServerContainerUrlInput />
                        <ActionForm.FieldError name="serverContainerUrl" />
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.google_tag.gateway_server_container_url_description" />
                          </Suspense>
                        </Field.Description>
                      </Field.Content>
                    </Field.Root>
                  </ActionForm.Fieldset>
                </div>
              </GoogleTagMode.While>

              <ActionForm.Fieldset>
                <Field.Root>
                  <Field.Label>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.settings.google_tag.consent_mode" />
                    </Suspense>
                  </Field.Label>
                  <Field.Content>
                    <GoogleTagMode.ConsentRadioGroup
                      externalWithoutContainer={
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-64" />}
                        >
                          <Message message="admin.settings.google_tag.consent_modes.external.unavailable" />
                        </Suspense>
                      }
                      items={[
                        {
                          description: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-64" />}
                            >
                              <Message message="admin.settings.google_tag.consent_modes.not_required.description" />
                            </Suspense>
                          ),
                          label: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-32" />}
                            >
                              <Message message="admin.settings.google_tag.consent_modes.not_required.label" />
                            </Suspense>
                          ),
                          value: "not_required",
                        },
                        {
                          description: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-64" />}
                            >
                              <Message message="admin.settings.google_tag.consent_modes.opt_in.description" />
                            </Suspense>
                          ),
                          label: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-32" />}
                            >
                              <Message message="admin.settings.google_tag.consent_modes.opt_in.label" />
                            </Suspense>
                          ),
                          value: "opt_in",
                        },
                        {
                          description: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-64" />}
                            >
                              <Message message="admin.settings.google_tag.consent_modes.external.description" />
                            </Suspense>
                          ),
                          label: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-64" />}
                            >
                              <Message message="admin.settings.google_tag.consent_modes.external.label" />
                            </Suspense>
                          ),
                          value: "external",
                        },
                      ]}
                    />
                    <ActionForm.FieldError name="consentMode" />
                    {privacyPageMissing ? (
                      <GoogleTagMode.WhileConsent mode="opt_in">
                        <FormMessage variant="warning">
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-64" />}
                          >
                            <Message message="admin.settings.google_tag.consent_privacy_page_missing" />
                          </Suspense>
                        </FormMessage>
                      </GoogleTagMode.WhileConsent>
                    ) : null}
                    <Field.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.google_tag.consent_guidance.readership" />
                      </Suspense>
                    </Field.Description>
                    <Field.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.google_tag.consent_guidance.privacy_page" />
                      </Suspense>
                    </Field.Description>
                    <Field.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.google_tag.consent_guidance.view_counting" />
                      </Suspense>
                    </Field.Description>
                  </Field.Content>
                </Field.Root>
              </ActionForm.Fieldset>
            </GoogleTagMode.Root>
          )}

          {loadErrorMessage ? (
            <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <ActionForm.Submit disabled={settings === undefined}>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ActionForm.Idle>
                  <Message message="admin.settings.google_tag.submit" />
                </ActionForm.Idle>
                <ActionForm.Pending>
                  <Message message="admin.settings.saving" />
                </ActionForm.Pending>
              </Suspense>
            </ActionForm.Submit>
          </div>
        </ActionForm.Root>
        <aside className="grid gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.settings.google_tag.guidance.title" />
            </Suspense>
          </h2>
          <ul className="grid list-disc gap-2 pl-5 text-sm text-muted-foreground">
            <li>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="admin.settings.google_tag.guidance.other_tags" />
              </Suspense>
            </li>
            <li>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="admin.settings.google_tag.guidance.double_counting" />
              </Suspense>
            </li>
            <li>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="admin.settings.google_tag.guidance.privacy_page" />
              </Suspense>
            </li>
          </ul>
        </aside>
      </div>
    </ConsoleSection.Root>
  );
};
