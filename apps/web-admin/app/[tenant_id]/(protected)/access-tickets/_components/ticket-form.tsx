import * as ActionForm from "@publira/ui-components/action-form";
import * as Combobox from "@publira/ui-components/combobox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";
import { SubmitGate, SubmitGateSubmit } from "#components/submit-gate";
import { getMessages } from "#lib/get-messages";

import type {
  IssueAccessTicketActionState,
  TicketSeriesOption,
} from "../ticket-types";
import {
  TicketEpisodeCombobox,
  TicketEpisodeInput,
  TicketEpisodeLoadError,
  TicketReaderPicker,
  TicketSeriesCombobox,
  TicketSeriesWhile,
  TicketTarget,
} from "./ticket-target-controls";

interface TicketFormProps {
  action: (
    prevState: IssueAccessTicketActionState,
    formData: FormData
  ) => Promise<IssueAccessTicketActionState>;
  series: TicketSeriesOption[];
  seriesErrorMessage?: string;
  tenantId: string;
  timeZone: string;
}

/**
 * Awaits the catalog for its placeholders and the series choices, which are
 * attributes and option labels rather than nodes. An issued ticket redirects
 * from the Action to the list.
 */
export const TicketForm = async ({
  action,
  series,
  seriesErrorMessage,
  tenantId,
  timeZone,
}: TicketFormProps) => {
  const t = await getMessages();
  const seriesItems = series.map((item) => ({
    label: t("admin.access_tickets.form.option", {
      id: item.publicId,
      title: item.title,
    }),
    value: item.id,
  }));

  return (
    <ActionForm.Root action={action} className="grid gap-5" showSuccess={false}>
      <input name="tenant_id" type="hidden" value={tenantId} />

      <SubmitGate initialSubmittable={false}>
        <ActionForm.Fieldset className="grid gap-5">
          <TicketTarget seriesItems={seriesItems} tenantId={tenantId}>
            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.access_tickets.form.user" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <TicketReaderPicker />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.access_tickets.form.user_description" />
                  </Suspense>
                </Field.Description>
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.access_tickets.form.series" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                {seriesErrorMessage ? (
                  <FormMessage variant="destructive">
                    {seriesErrorMessage}
                  </FormMessage>
                ) : null}
                <TicketSeriesCombobox>
                  <Combobox.Input
                    placeholder={t(
                      "admin.access_tickets.form.series_placeholder"
                    )}
                  />
                  <Combobox.Popup>
                    <Combobox.Empty>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.access_tickets.form.series_empty" />
                      </Suspense>
                    </Combobox.Empty>
                    <Combobox.Items />
                  </Combobox.Popup>
                </TicketSeriesCombobox>
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    {series.length === 0 && !seriesErrorMessage ? (
                      <Message message="admin.access_tickets.form.episode_no_series" />
                    ) : (
                      <Message message="admin.access_tickets.form.series_description" />
                    )}
                  </Suspense>
                </Field.Description>
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.access_tickets.form.episode" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <TicketEpisodeCombobox>
                  <TicketEpisodeInput />
                  <Combobox.Popup>
                    <Combobox.Empty>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.access_tickets.form.episode_empty" />
                      </Suspense>
                    </Combobox.Empty>
                    <Combobox.Items />
                  </Combobox.Popup>
                </TicketEpisodeCombobox>
                <TicketEpisodeLoadError>
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.common.retry" />
                  </Suspense>
                </TicketEpisodeLoadError>
                <Field.Description>
                  <TicketSeriesWhile chosen={false}>
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.access_tickets.form.episode_needs_series" />
                    </Suspense>
                  </TicketSeriesWhile>
                  <TicketSeriesWhile chosen>
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.access_tickets.form.episode_description" />
                    </Suspense>
                  </TicketSeriesWhile>
                </Field.Description>
              </Field.Content>
            </Field.Root>
          </TicketTarget>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.access_tickets.form.expires_at" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <InstantInput name="expires_at" timeZone={timeZone} />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message
                    message="admin.access_tickets.form.expires_at_description"
                    values={{ time_zone: timeZone }}
                  />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.access_tickets.form.note" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Textarea
                maxLength={1000}
                name="note"
                placeholder={t("admin.access_tickets.form.note_placeholder")}
                rows={3}
              />
            </Field.Content>
          </Field.Root>
        </ActionForm.Fieldset>

        <div className="flex justify-end">
          <SubmitGateSubmit>
            <ActionForm.Idle>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="admin.access_tickets.form.submit" />
              </Suspense>
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.access_tickets.form.submitting" />
              </Suspense>
            </ActionForm.Pending>
          </SubmitGateSubmit>
        </div>
      </SubmitGate>
    </ActionForm.Root>
  );
};
