"use server";

import { toFormDataInput } from "@publira/utils/form-data";
import { refresh } from "next/cache";
import { z } from "zod";

import { assertSameOrigin } from "./csrf";
import { setDismissedAnnouncementId } from "./dismissed-announcement-cookie";

const dismissAnnouncementFormSchema = z.object({
  announcementId: z.string().trim().pipe(z.uuid()),
});

/**
 * Close the banner for this browser.
 *
 * The id is written to a cookie the chrome reads on the next render, which is
 * what makes the band stay closed rather than reappear on the next page. It
 * changes nothing about the announcement itself: the row is still on
 * `/announcements`, unread if the reader never opened it.
 */
export const dismissAnnouncementBannerAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const parsed = dismissAnnouncementFormSchema.safeParse(
    toFormDataInput(formData, { announcementId: "value" })
  );
  if (!parsed.success) {
    return;
  }

  await setDismissedAnnouncementId(parsed.data.announcementId);
  // The band is in the chrome rather than in the page, and the cookie it reads
  // is the only thing that changed — there is no tag to drop, and dropping the
  // banner's would take the band down for every other reader too. `refresh()`
  // re-renders this reader's route instead, which is what makes the band go
  // away without a navigation.
  refresh();
};
