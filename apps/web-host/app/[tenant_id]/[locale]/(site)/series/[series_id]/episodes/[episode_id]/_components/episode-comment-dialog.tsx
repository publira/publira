"use client";

import type { FormActionState } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "@publira/ui-components/dialog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Textarea } from "@publira/ui-components/textarea";
import { useActionState, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { LocaleField } from "#components/locale-field";

import { postEpisodeCommentAction } from "../_lib/comment-actions";

const subscribeToFullscreen = (onStoreChange: () => void) => {
  document.addEventListener("fullscreenchange", onStoreChange);

  return () => {
    document.removeEventListener("fullscreenchange", onStoreChange);
  };
};

const getFullscreenContainer = (): HTMLElement | null =>
  document.fullscreenElement instanceof HTMLElement
    ? document.fullscreenElement
    : null;

/** Nothing is full screen while rendering on the server. */
const getNullOnServer = () => null;

/**
 * The episode's comments, opened from the page the reader turns to after the
 * last page of the episode.
 *
 * A dialog rather than a section laid out on that page: the page is one screen
 * of the reader and no taller, and the list is as long as the episode is
 * talked about. The box to write in is fixed above the list rather than under
 * it, so it is in the same place however far the reader has scrolled.
 *
 * `children` are the comments themselves, rendered on the server: the list, the
 * pager, and whatever a failed read has to say.
 *
 * The portal follows the element the reader made full screen, because a popup
 * appended to `<body>` is not painted while another element owns the screen.
 */
export const EpisodeCommentDialog = ({
  children,
  episodePublicId,
  /**
   * Whether the URL asks for the comments — a page of them followed from the
   * pager, which navigates rather than fetching.
   */
  initialOpen = false,
  prompt,
  returnTo,
  tenantId,
}: {
  children: ReactNode;
  episodePublicId: string;
  initialOpen?: boolean;
  /** Shown in place of the box where the reader has no session. */
  prompt?: ReactNode;
  /** Where a rejected session sends the reader back to. */
  returnTo: string;
  tenantId: string;
}) => {
  const t = useClientMessages();
  const [open, setOpen] = useState(initialOpen);
  const [body, setBody] = useState("");
  const fullscreenContainer = useSyncExternalStore(
    subscribeToFullscreen,
    getFullscreenContainer,
    getNullOnServer
  );
  const [state, formAction, isPending] = useActionState(
    async (
      previousState: FormActionState,
      formData: FormData
    ): Promise<FormActionState> => {
      const nextState = await postEpisodeCommentAction(previousState, formData);
      if (nextState?.ok) {
        // Only a posted comment empties the box. React resets an uncontrolled
        // field the moment the Action settles, which would take a rejected
        // comment away from the reader who has to correct it.
        setBody("");
      }
      return nextState;
    },
    null
  );

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        <ClientMessage message="host.episode.comments.title" />
      </DialogTrigger>
      {/* `undefined` rather than `null`, which the portal reads as a container
          it is still waiting for and renders nothing into. */}
      <DialogPortal container={fullscreenContainer ?? undefined}>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopup className="flex max-h-[min(85svh,48rem)] flex-col gap-4 text-left">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">
                <ClientMessage message="host.episode.comments.title" />
              </DialogTitle>
            </DialogHeader>

            {prompt ?? (
              <form action={formAction} className="grid gap-3">
                <LocaleField />
                <input
                  name="episodePublicId"
                  type="hidden"
                  value={episodePublicId}
                />
                <input name="returnTo" type="hidden" value={returnTo} />
                <input name="tenantId" type="hidden" value={tenantId} />
                <Field>
                  <FieldLabel>
                    <ClientMessage message="host.episode.comments.body_label" />
                  </FieldLabel>
                  <FieldContent>
                    {/* No `maxLength`: it counts UTF-16 code units, while the
                        API counts Unicode code points, so it would cut an
                        emoji-heavy comment off at half the length the server
                        allows. The Action checks the real limit and says so
                        next to the box. */}
                    <Textarea
                      name="body"
                      onChange={(event) => {
                        setBody(event.target.value);
                      }}
                      placeholder={t("host.episode.comments.body_placeholder")}
                      rows={3}
                      value={body}
                    />
                  </FieldContent>
                </Field>
                <div className="flex items-center justify-between gap-3">
                  <Button
                    aria-busy={isPending}
                    disabled={isPending}
                    type="submit"
                  >
                    {isPending ? (
                      <ClientMessage message="host.episode.comments.posting" />
                    ) : (
                      <ClientMessage message="host.episode.comments.submit" />
                    )}
                  </Button>
                  {state ? (
                    <FormMessage variant={state.ok ? "success" : "destructive"}>
                      {state.message}
                    </FormMessage>
                  ) : null}
                </div>
              </form>
            )}

            {/* The one part that grows with the episode, so it is the one part
                that scrolls. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border pt-4">
              {children}
            </div>

            <DialogClose
              className="justify-self-end"
              render={<Button type="button" variant="outline" />}
            >
              <ClientMessage message="host.common.close" />
            </DialogClose>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  );
};
