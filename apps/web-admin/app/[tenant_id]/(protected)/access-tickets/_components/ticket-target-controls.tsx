"use client";

import { Button } from "@publira/ui-components/button";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import { Combobox, ComboboxInput } from "@publira/ui-components/combobox";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  createContext,
  use,
  useCallback,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { ReactNode } from "react";

import { useAdminLocale } from "#components/admin-locale-context";
import { useClientMessages } from "#components/client-message";
import { ReaderPicker } from "#components/reader-picker";
import { useSetSubmittable } from "#components/submit-gate";

import { listEpisodeOptionsAction } from "../_lib/actions";
import type { TicketEpisodeOption } from "../ticket-types";

interface TicketTargetContextValue {
  episodeId: string;
  episodeItems: ComboboxItem[];
  episodesErrorMessage?: string;
  isEpisodePending: boolean;
  onEpisodeChange: (nextEpisodeId: string) => void;
  onReaderChange: (nextReaderId: string) => void;
  onRetryEpisodes: () => void;
  onSeriesChange: (nextSeriesId: string) => void;
  seriesId: string;
  seriesItems: ComboboxItem[];
}

const TicketTargetContext = createContext<TicketTargetContextValue | null>(
  null
);

const useTicketTarget = () => {
  const context = use(TicketTargetContext);
  if (!context) {
    throw new Error("TicketTarget slots must be rendered inside TicketTarget.");
  }
  return context;
};

/**
 * Who the ticket is for and which episode it grants. The episode choices are
 * loaded for the series picked, and the form can be submitted once a reader
 * and an episode are chosen.
 */
export const TicketTarget = ({
  children,
  seriesItems,
  tenantId,
}: {
  children: ReactNode;
  seriesItems: ComboboxItem[];
  tenantId: string;
}) => {
  const locale = useAdminLocale();
  const t = useClientMessages();
  const setSubmittable = useSetSubmittable();
  const [isEpisodePending, startEpisodeTransition] = useTransition();
  const [readerId, setReaderId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [episodes, setEpisodes] = useState<TicketEpisodeOption[]>([]);
  const [episodesErrorMessage, setEpisodesErrorMessage] = useState<string>();
  const episodeRequestIdRef = useRef(0);

  const episodeItems = useMemo<ComboboxItem[]>(
    () =>
      episodes.map((item) => ({
        label: t("admin.access_tickets.form.option", {
          id: item.publicId,
          title: item.title,
        }),
        value: item.id,
      })),
    [episodes, t]
  );

  const loadEpisodesForSeries = useCallback(
    (nextSeriesId: string) => {
      const requestId = episodeRequestIdRef.current + 1;
      episodeRequestIdRef.current = requestId;

      startEpisodeTransition(async () => {
        const result = await listEpisodeOptionsAction(
          tenantId,
          nextSeriesId,
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

  const value = useMemo<TicketTargetContextValue>(
    () => ({
      episodeId,
      episodeItems,
      episodesErrorMessage,
      isEpisodePending,
      onEpisodeChange: (nextEpisodeId) => {
        setEpisodeId(nextEpisodeId);
        setSubmittable(readerId !== "" && nextEpisodeId !== "");
      },
      onReaderChange: (nextReaderId) => {
        setReaderId(nextReaderId);
        setSubmittable(nextReaderId !== "" && episodeId !== "");
      },
      onRetryEpisodes: () => {
        if (seriesId === "") {
          return;
        }
        setEpisodesErrorMessage(undefined);
        loadEpisodesForSeries(seriesId);
      },
      // Another series empties the episode, so the choices are loaded afresh
      // and nothing can be issued until one of them is picked.
      onSeriesChange: (nextSeriesId) => {
        setSeriesId(nextSeriesId);
        setEpisodeId("");
        setEpisodes([]);
        setEpisodesErrorMessage(undefined);
        setSubmittable(false);

        if (nextSeriesId === "") {
          return;
        }

        loadEpisodesForSeries(nextSeriesId);
      },
      seriesId,
      seriesItems,
    }),
    [
      episodeId,
      episodeItems,
      episodesErrorMessage,
      isEpisodePending,
      loadEpisodesForSeries,
      readerId,
      seriesId,
      seriesItems,
      setSubmittable,
    ]
  );

  return <TicketTargetContext value={value}>{children}</TicketTargetContext>;
};

/** The reader the ticket is for, posted as `user_id`. */
export const TicketReaderPicker = () => {
  const { onReaderChange } = useTicketTarget();

  return <ReaderPicker name="user_id" onValueChange={onReaderChange} />;
};

/** The series whose episodes are offered; `children` are the picker's parts. */
export const TicketSeriesCombobox = ({ children }: { children: ReactNode }) => {
  const { onSeriesChange, seriesId, seriesItems } = useTicketTarget();

  return (
    <Combobox
      items={seriesItems}
      onValueChange={onSeriesChange}
      value={seriesId}
    >
      {children}
    </Combobox>
  );
};

/**
 * The episode the ticket grants, posted as `episode_id`; `children` are the
 * picker's parts. It opens once a series is picked and its episodes are in.
 */
export const TicketEpisodeCombobox = ({
  children,
}: {
  children: ReactNode;
}) => {
  const {
    episodeId,
    episodeItems,
    isEpisodePending,
    onEpisodeChange,
    seriesId,
  } = useTicketTarget();

  return (
    <>
      <Combobox
        disabled={isEpisodePending || seriesId === ""}
        items={episodeItems}
        onValueChange={onEpisodeChange}
        value={episodeId}
      >
        {children}
      </Combobox>
      <input name="episode_id" type="hidden" value={episodeId} />
    </>
  );
};

/** The episode picker's text box, which says so while the choices load. */
export const TicketEpisodeInput = () => {
  const t = useClientMessages();
  const { isEpisodePending } = useTicketTarget();

  return (
    <ComboboxInput
      placeholder={
        isEpisodePending
          ? t("admin.access_tickets.form.episode_loading")
          : t("admin.access_tickets.form.episode_placeholder")
      }
    />
  );
};

/** Why the episodes could not be loaded, and the retry; `children` are its wording. */
export const TicketEpisodeLoadError = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { episodesErrorMessage, onRetryEpisodes } = useTicketTarget();

  return episodesErrorMessage ? (
    <>
      <FormMessage variant="destructive">{episodesErrorMessage}</FormMessage>
      <Button onClick={onRetryEpisodes} type="button" variant="outline">
        {children}
      </Button>
    </>
  ) : null;
};

/** Renders its children while a series is picked, or while none is when `chosen` is false. */
export const TicketSeriesWhile = ({
  children,
  chosen,
}: {
  children: ReactNode;
  chosen: boolean;
}) => ((useTicketTarget().seriesId !== "") === chosen ? children : null);
