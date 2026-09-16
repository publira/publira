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
import type { ListEpisodeCreditRangeCatalogResult } from "../episode-types";
import { EpisodeCreditsRangeForm } from "./episode-credits-range-form";

interface EpisodeCreditsRangeDialogProps {
  seriesPublicId: string;
}

const emptyCatalog: ListEpisodeCreditRangeCatalogResult = {
  creatorRoles: [],
  creators: [],
  episodes: [],
};

/**
 * The Credits action on the series episode list. The list itself is cursor
 * paged, so the checklist walks `ListEpisodes` when the dialog opens rather
 * than depending on the page that happens to be on screen. Authors and roles
 * are loaded then too, so opening the list does not wait on the catalogs the
 * dialog needs.
 *
 * Checks on the list and checks in this dialog are the same set: the list
 * seeds a sparse selection, and the dialog is where episodes from other
 * pages can be added. Series-form credits stay the template for new
 * episodes; this writes on the ones that already exist.
 */
export const EpisodeCreditsRangeDialog = ({
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
  const [catalog, setCatalog] =
    useState<ListEpisodeCreditRangeCatalogResult>(emptyCatalog);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isCatalogPending, startCatalogTransition] = useTransition();
  const catalogRequestIdRef = useRef(0);

  const loadCatalog = useCallback(() => {
    const requestId = catalogRequestIdRef.current + 1;
    catalogRequestIdRef.current = requestId;

    startCatalogTransition(async () => {
      const result = await listEpisodeCreditRangeOptionsAction(
        tenantId,
        seriesPublicId,
        locale
      );
      if (requestId !== catalogRequestIdRef.current) {
        return;
      }
      setCatalog(result);
      setHasLoaded(true);
    });
  }, [locale, seriesPublicId, tenantId]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        return;
      }
      // Remount the form so a previous result or half-filled credit does not
      // survive from the last time the dialog was open. The checked episodes
      // live on the list provider and are left as they are.
      setSessionKey((current) => current + 1);
      setCatalog(emptyCatalog);
      setHasLoaded(false);
      loadCatalog();
    },
    [loadCatalog]
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
          <DialogPopup className="flex max-h-[min(90vh,44rem)] min-h-0 w-[min(92vw,40rem)] scroll-pb-16 flex-col overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">
                {t("admin.series.episodes.credits.dialog_title")}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {t("admin.series.episodes.credits.dialog_description")}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              {hasLoaded ? (
                <EpisodeCreditsRangeForm
                  action={bulkEditEpisodeCreditsAction}
                  creatorRoles={catalog.creatorRoles}
                  creatorRolesErrorMessage={catalog.creatorRolesErrorMessage}
                  creators={catalog.creators}
                  creatorsErrorMessage={catalog.creatorsErrorMessage}
                  episodes={catalog.episodes}
                  episodesErrorMessage={catalog.episodesErrorMessage}
                  isEpisodePending={isCatalogPending}
                  key={sessionKey}
                  onRetryEpisodes={loadCatalog}
                  seriesPublicId={seriesPublicId}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("admin.series.episodes.credits.episodes_loading")}
                </p>
              )}
            </div>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  );
};
