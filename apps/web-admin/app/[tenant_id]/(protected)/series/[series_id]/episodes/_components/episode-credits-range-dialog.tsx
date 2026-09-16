"use client";

import { Button } from "@publira/ui-components/button";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "@publira/ui-components/dialog";
import {
  useCallback,
  useContext,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  AdminLocaleContext,
  useAdminMessages,
} from "#components/admin-locale-context";
import { useTenantId } from "#lib/use-tenant-id";

import {
  bulkEditEpisodeCreditsAction,
  listEpisodeCreditRangeOptionsAction,
} from "../_lib/actions";
import type {
  CreditPickerOption,
  EpisodeCreditRangeOption,
} from "../episode-types";
import { EpisodeCreditsRangeForm } from "./episode-credits-range-form";

interface EpisodeCreditsRangeDialogProps {
  creatorRoles: CreditPickerOption[];
  creatorRolesErrorMessage?: string;
  creators: CreditPickerOption[];
  creatorsErrorMessage?: string;
  seriesPublicId: string;
}

/**
 * The Credits action on the series episode list. The list itself is cursor
 * paged, so the range picker walks `ListEpisodes` when the dialog opens
 * rather than depending on the page that happens to be on screen.
 */
export const EpisodeCreditsRangeDialog = ({
  creatorRoles,
  creatorRolesErrorMessage,
  creators,
  creatorsErrorMessage,
  seriesPublicId,
}: EpisodeCreditsRangeDialogProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useAdminMessages();
  const tenantId = useTenantId();
  const [open, setOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const [episodes, setEpisodes] = useState<EpisodeCreditRangeOption[]>([]);
  const [episodesErrorMessage, setEpisodesErrorMessage] = useState<string>();
  const [isEpisodePending, startEpisodeTransition] = useTransition();
  const episodeRequestIdRef = useRef(0);

  const loadEpisodes = useCallback(() => {
    const requestId = episodeRequestIdRef.current + 1;
    episodeRequestIdRef.current = requestId;

    startEpisodeTransition(async () => {
      const result = await listEpisodeCreditRangeOptionsAction(
        tenantId,
        seriesPublicId,
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
      setEpisodes([]);
      setEpisodesErrorMessage(result.message);
    });
  }, [locale, seriesPublicId, tenantId]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        return;
      }
      // Remount the form so a previous result or half-filled range does not
      // survive from the last time the dialog was open.
      setSessionKey((current) => current + 1);
      setEpisodes([]);
      setEpisodesErrorMessage(undefined);
      loadEpisodes();
    },
    [loadEpisodes]
  );

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline">
            {t("admin.series.episodes.credits_action")}
          </Button>
        }
      />
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopup className="flex max-h-[min(90vh,44rem)] min-h-0 w-[min(92vw,40rem)] flex-col overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">
                {t("admin.series.episodes.credits.dialog_title")}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {t("admin.series.episodes.credits.dialog_description")}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <EpisodeCreditsRangeForm
                action={bulkEditEpisodeCreditsAction}
                creatorRoles={creatorRoles}
                creatorRolesErrorMessage={creatorRolesErrorMessage}
                creators={creators}
                creatorsErrorMessage={creatorsErrorMessage}
                episodes={episodes}
                episodesErrorMessage={episodesErrorMessage}
                isEpisodePending={isEpisodePending}
                key={sessionKey}
                onRetryEpisodes={loadEpisodes}
                seriesPublicId={seriesPublicId}
              />
            </div>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  );
};
