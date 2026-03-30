import { apiClient, buildSessionHeaders, resolveSessionId } from "./api-client";

export const requestPublicEmailChange = async (
  tenantPublicId: string,
  currentEmail: string,
  newEmail: string,
  currentPassword: string,
  sessionId?: string
): Promise<boolean> => {
  const sid = await resolveSessionId(sessionId);
  if (!sid) {
    return false;
  }

  try {
    const response = await apiClient.auth.requestEmailChange(
      {
        currentEmail,
        currentPassword,
        newEmail,
        sessionId: sid,
        tenant: {
          tenantPublicId,
        },
      },
      buildSessionHeaders(sid)
    );

    return Boolean(response.requested);
  } catch {
    return false;
  }
};
