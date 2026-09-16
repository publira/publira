"use client";

import { Button } from "@publira/ui-components/button";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import {
  useActionState,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { ClientMessage, useClientMessages } from "#components/client-message";
import { fillInstantFromDateTimeLocal } from "#lib/datetime-local-form";
import { useTenantId } from "#lib/use-tenant-id";

import { listEpisodeOptionsAction } from "../_lib/actions";
import type {
  IssueAccessTicketActionState,
  TicketEpisodeOption,
  TicketSeriesOption,
} from "../ticket-types";

interface TicketFormProps {
  action: (
    prevState: IssueAccessTicketActionState,
    formData: FormData
  ) => Promise<IssueAccessTicketActionState>;
  series: TicketSeriesOption[];
  seriesErrorMessage?: string;
  timeZone: string;
}

export const TicketForm = ({
  action,
  series,
  seriesErrorMessage,
  timeZone,
}: TicketFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useClientMessages();
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [isEpisodePending, startEpisodeTransition] = useTransition();
  const [seriesPublicId, setSeriesPublicId] = useState("");
  const [episodePublicId, setEpisodePublicId] = useState("");
  const [episodes, setEpisodes] = useState<TicketEpisodeOption[]>([]);
  const [episodesErrorMessage, setEpisodesErrorMessage] = useState<string>();
  const episodeRequestIdRef = useRef(0);

  const seriesItems = useMemo<ComboboxItem[]>(
    () =>
      series.map((item) => ({
        label: t("admin.access_tickets.form.option", {
          id: item.publicId,
          title: item.title,
        }),
        value: item.publicId,
      })),
    [series, t]
  );
  const episodeItems = useMemo<ComboboxItem[]>(
    () =>
      episodes.map((item) => ({
        label: t("admin.access_tickets.form.option", {
          id: item.publicId,
          title: item.title,
        }),
        value: item.publicId,
      })),
    [episodes, t]
  );
  // Only the missing catalog falls back to a public_id field. An episode-list
  // failure must keep the pickers so the operator can retry without a reload.
  const useEpisodeFallbackInput =
    Boolean(seriesErrorMessage) || seriesItems.length === 0;
  const canSubmit =
    !isPending &&
    !isEpisodePending &&
    (useEpisodeFallbackInput || episodePublicId !== "");

  const loadEpisodesForSeries = useCallback(
    (nextSeriesPublicId: string) => {
      const requestId = episodeRequestIdRef.current + 1;
      episodeRequestIdRef.current = requestId;

      startEpisodeTransition(async () => {
        const result = await listEpisodeOptionsAction(
          tenantId,
          nextSeriesPublicId,
          locale
        );
        if (requestId !== episodeRequestIdRef.current) {
          return;
        }
        if (result.ok) {
          setEpisodes(result.episodes);
          setEpisodesErrorMessage(undefined);
          return;
        }
        setEpisodesErrorMessage(result.message);
      });
    },
    [locale, tenantId]
  );

  const handleSeriesChange = useCallback(
    (nextSeriesPublicId: string) => {
      setSeriesPublicId(nextSeriesPublicId);
      setEpisodePublicId("");
      setEpisodes([]);
      setEpisodesErrorMessage(undefined);

      if (nextSeriesPublicId === "") {
        return;
      }

      loadEpisodesForSeries(nextSeriesPublicId);
    },
    [loadEpisodesForSeries]
  );

  const handleRetryEpisodes = useCallback(() => {
    if (seriesPublicId === "") {
      return;
    }
    setEpisodesErrorMessage(undefined);
    loadEpisodesForSeries(seriesPublicId);
  }, [loadEpisodesForSeries, seriesPublicId]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      fillInstantFromDateTimeLocal(event.currentTarget, {
        isoName: "expires_at",
        localName: "expires_at_local",
        timeZone,
      });
    },
    [timeZone]
  );

  return (
    <form action={formAction} className="grid gap-5" onSubmit={handleSubmit}>
      <input name="tenant_id" type="hidden" value={tenantId} />

      <Field>
        <FieldLabel required>
          <ClientMessage message="admin.access_tickets.form.user" />
        </FieldLabel>
        <FieldContent>
          <Input
            name="user_public_id"
            placeholder={t("admin.access_tickets.form.user_placeholder")}
            required
            type="text"
          />
          <FieldDescription>
            <ClientMessage message="admin.access_tickets.form.user_description" />
          </FieldDescription>
        </FieldContent>
      </Field>

      {useEpisodeFallbackInput ? (
        <Field>
          <FieldLabel required>
            <ClientMessage message="admin.access_tickets.form.episode_id" />
          </FieldLabel>
          <FieldContent>
            {seriesErrorMessage ? (
              <FormMessage variant="destructive">
                {seriesErrorMessage}
              </FormMessage>
            ) : null}
            <Input
              name="episode_public_id"
              placeholder={t(
                "admin.access_tickets.form.episode_id_placeholder"
              )}
              required
              type="text"
            />
            <FieldDescription>
              {t(
                seriesItems.length === 0 && !seriesErrorMessage
                  ? "admin.access_tickets.form.episode_id_no_series"
                  : "admin.access_tickets.form.episode_id_description"
              )}
            </FieldDescription>
          </FieldContent>
        </Field>
      ) : (
        <>
          <Field>
            <FieldLabel required>
              <ClientMessage message="admin.access_tickets.form.series" />
            </FieldLabel>
            <FieldContent>
              <Combobox
                items={seriesItems}
                onValueChange={handleSeriesChange}
                value={seriesPublicId}
              >
                <ComboboxInput
                  placeholder={t(
                    "admin.access_tickets.form.series_placeholder"
                  )}
                />
                <ComboboxPopup>
                  <ComboboxEmpty>
                    <ClientMessage message="admin.access_tickets.form.series_empty" />
                  </ComboboxEmpty>
                  <ComboboxItems />
                </ComboboxPopup>
              </Combobox>
              <FieldDescription>
                <ClientMessage message="admin.access_tickets.form.series_description" />
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>
              <ClientMessage message="admin.access_tickets.form.episode" />
            </FieldLabel>
            <FieldContent>
              <Combobox
                disabled={isEpisodePending || seriesPublicId === ""}
                items={episodeItems}
                onValueChange={setEpisodePublicId}
                value={episodePublicId}
              >
                <ComboboxInput
                  placeholder={t(
                    isEpisodePending
                      ? "admin.access_tickets.form.episode_loading"
                      : "admin.access_tickets.form.episode_placeholder"
                  )}
                />
                <ComboboxPopup>
                  <ComboboxEmpty>
                    <ClientMessage message="admin.access_tickets.form.episode_empty" />
                  </ComboboxEmpty>
                  <ComboboxItems />
                </ComboboxPopup>
              </Combobox>
              <input
                name="episode_public_id"
                type="hidden"
                value={episodePublicId}
              />
              {episodesErrorMessage ? (
                <>
                  <FormMessage variant="destructive">
                    {episodesErrorMessage}
                  </FormMessage>
                  <Button
                    onClick={handleRetryEpisodes}
                    type="button"
                    variant="outline"
                  >
                    <ClientMessage message="admin.common.retry" />
                  </Button>
                </>
              ) : null}
              <FieldDescription>
                {t(
                  seriesPublicId === ""
                    ? "admin.access_tickets.form.episode_needs_series"
                    : "admin.access_tickets.form.episode_description"
                )}
              </FieldDescription>
            </FieldContent>
          </Field>
        </>
      )}

      <Field>
        <FieldLabel>
          <ClientMessage message="admin.access_tickets.form.expires_at" />
        </FieldLabel>
        <FieldContent>
          <Input name="expires_at_local" type="datetime-local" />
          <input defaultValue="" name="expires_at" type="hidden" />
          <FieldDescription>
            <ClientMessage
              message="admin.access_tickets.form.expires_at_description"
              values={{ time_zone: timeZone }}
            />
          </FieldDescription>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel>
          <ClientMessage message="admin.access_tickets.form.note" />
        </FieldLabel>
        <FieldContent>
          <Textarea
            maxLength={1000}
            name="note"
            placeholder={t("admin.access_tickets.form.note_placeholder")}
            rows={3}
          />
        </FieldContent>
      </Field>

      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}

      <div className="flex justify-end">
        <Button disabled={!canSubmit} type="submit">
          {isPending
            ? t("admin.access_tickets.form.submitting")
            : t("admin.access_tickets.form.submit")}
        </Button>
      </div>
    </form>
  );
};
