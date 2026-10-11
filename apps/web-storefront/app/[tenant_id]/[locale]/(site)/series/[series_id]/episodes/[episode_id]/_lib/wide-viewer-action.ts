"use server";

import { z } from "zod";

import { tenantIdSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { saveWideViewerPreference } from "#lib/viewer-preferences";

const saveWideViewerInputSchema = z.object({
  tenantId: tenantIdSchema,
  wideViewerEnabled: z.boolean(),
});

/**
 * Store the wide viewer choice the reader just made. The viewer never waits on
 * the answer, so a malformed call simply ends here.
 */
export const saveWideViewerAction = async (
  tenantId: unknown,
  wideViewerEnabled: unknown
): Promise<void> => {
  await assertSameOrigin();
  const parsed = saveWideViewerInputSchema.safeParse({
    tenantId,
    wideViewerEnabled,
  });
  if (!parsed.success) {
    return;
  }

  await saveWideViewerPreference(parsed.data);
};
