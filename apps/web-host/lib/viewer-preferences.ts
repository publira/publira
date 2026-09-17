import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";

/** How the reader wants the episode viewer laid out. */
export interface ViewerPreferences {
  /** The viewer fills the window and the site header gives way to it. */
  wideViewerEnabled: boolean;
}

/** What a reader who has saved nothing reads, which is also what a guest reads. */
export const DEFAULT_VIEWER_PREFERENCES: ViewerPreferences = {
  wideViewerEnabled: false,
};

/**
 * The signed-in member's viewer preferences, or the defaults for a guest.
 * Uncached, because the viewer it lays out writes the next answer, and a
 * classified failure falls back to the defaults rather than hiding the episode.
 */
export const getMyViewerPreferences = async ({
  accessToken,
  tenantId,
}: {
  accessToken: string;
  tenantId: string;
}): Promise<ViewerPreferences> => {
  const sessionId = accessToken.trim();
  if (!sessionId) {
    return DEFAULT_VIEWER_PREFERENCES;
  }

  try {
    const response = await apiClient.auth.getViewerPreferences(
      { tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    );
    return {
      wideViewerEnabled: response.preferences?.wideViewerEnabled ?? false,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return DEFAULT_VIEWER_PREFERENCES;
  }
};

/**
 * Store the wide viewer choice against the signed-in member. The browser has
 * already applied it, so a classified failure has nothing to report.
 */
export const saveWideViewerPreference = async ({
  tenantId,
  wideViewerEnabled,
}: {
  tenantId: string;
  wideViewerEnabled: boolean;
}): Promise<void> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return;
  }

  try {
    await apiClient.auth.updateViewerPreferences(
      { tenant: { tenantId }, wideViewerEnabled },
      buildSessionHeaders(sessionId)
    );
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
  }
};
