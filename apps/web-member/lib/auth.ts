import { apiClient, buildSessionHeaders, resolveSessionId } from "./api-client";

export interface MeInfo {
  publicId: string;
  name: string;
  role: string;
}

export interface NotificationSettings {
  emailNotificationsEnabled: boolean;
}

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

export const getMe = async (
  tenantPublicId: string,
  sessionId?: string
): Promise<MeInfo | null> => {
  const sid = await resolveSessionId(sessionId);
  if (!sid) {
    return null;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await apiClient.auth.getMe(
        {
          sessionId: sid,
          tenant: { tenantPublicId },
        },
        buildSessionHeaders(sid)
      );

      if (!response.user) {
        return null;
      }

      return {
        name: response.user.name,
        publicId: response.user.publicId,
        role: response.user.role,
      };
    } catch {
      if (attempt === 1) {
        return null;
      }
    }
  }

  return null;
};

export const updateMe = async (
  tenantPublicId: string,
  name: string,
  sessionId?: string
): Promise<MeInfo | null> => {
  const sid = await resolveSessionId(sessionId);
  if (!sid) {
    return null;
  }

  try {
    const response = await apiClient.auth.updateMe(
      {
        name,
        sessionId: sid,
        tenant: { tenantPublicId },
      },
      buildSessionHeaders(sid)
    );

    if (!response.user) {
      return null;
    }

    return {
      name: response.user.name,
      publicId: response.user.publicId,
      role: response.user.role,
    };
  } catch {
    return null;
  }
};

export const deleteMe = async (
  tenantPublicId: string,
  password: string,
  sessionId?: string
): Promise<boolean> => {
  const sid = await resolveSessionId(sessionId);
  if (!sid) {
    return false;
  }

  try {
    await apiClient.auth.deleteMe(
      {
        password,
        sessionId: sid,
        tenant: { tenantPublicId },
      },
      buildSessionHeaders(sid)
    );

    return true;
  } catch {
    return false;
  }
};

export const getNotificationSettings = async (
  tenantPublicId: string,
  sessionId?: string
): Promise<NotificationSettings | null> => {
  const sid = await resolveSessionId(sessionId);
  if (!sid) {
    return null;
  }

  try {
    const response = await apiClient.auth.getNotificationSettings(
      {
        sessionId: sid,
        tenant: { tenantPublicId },
      },
      buildSessionHeaders(sid)
    );

    return {
      emailNotificationsEnabled: response.emailNotificationsEnabled,
    };
  } catch {
    return null;
  }
};

export const updateNotificationSettings = async (
  tenantPublicId: string,
  emailNotificationsEnabled: boolean,
  sessionId?: string
): Promise<NotificationSettings | null> => {
  const sid = await resolveSessionId(sessionId);
  if (!sid) {
    return null;
  }

  try {
    const response = await apiClient.auth.updateNotificationSettings(
      {
        emailNotificationsEnabled,
        sessionId: sid,
        tenant: { tenantPublicId },
      },
      buildSessionHeaders(sid)
    );

    return {
      emailNotificationsEnabled: response.emailNotificationsEnabled,
    };
  } catch {
    return null;
  }
};
