import { createAdminApiClient } from "@publira/api-client/admin/client";

import {
  ADMIN_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./admin-auth-shared";

const adminApiBaseUrl =
  process.env.PUBLIRA_ADMIN_API_BASE_URL ?? "http://localhost:8001";

const adminApiClient = createAdminApiClient({
  baseUrl: adminApiBaseUrl,
});

export type AdminLoginResult =
  | {
      ok: true;
      sessionId: string;
      expiresAt: Date;
    }
  | {
      ok: false;
      message: string;
    };

export interface AdminCurrentUser {
  name: string;
  publicId: string;
  role: string;
}

const loginFailedMessage = "メールアドレスまたはパスワードが正しくありません。";
const genericErrorMessage =
  "ログイン処理に失敗しました。時間をおいて再試行してください。";

const toErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return genericErrorMessage;
  }

  const message = error.message.toLowerCase();
  if (
    message.includes("invalid credentials") ||
    message.includes("unauthenticated")
  ) {
    return loginFailedMessage;
  }

  return genericErrorMessage;
};

export const loginAdmin = async (
  email: string,
  password: string,
  tenantPublicId: string
): Promise<AdminLoginResult> => {
  try {
    const response = await adminApiClient.auth.createSession({
      email,
      password,
      tenant: { tenantPublicId },
    });

    const sessionId = response.session?.sessionId?.trim() ?? "";
    const expiresAtRaw = response.session?.expiresAt ?? "";
    const expiresAt = new Date(expiresAtRaw);

    if (!sessionId || Number.isNaN(expiresAt.getTime())) {
      return {
        message: genericErrorMessage,
        ok: false,
      };
    }

    return {
      expiresAt,
      ok: true,
      sessionId,
    };
  } catch (error) {
    return {
      message: toErrorMessage(error),
      ok: false,
    };
  }
};

export const logoutAdmin = async (
  sessionId: string,
  tenantPublicId: string
): Promise<void> => {
  if (!sessionId) {
    return;
  }

  await adminApiClient.auth.deleteSession({
    sessionId,
    tenant: { tenantPublicId },
  });
};

export const getAdminCurrentUser = async (
  sessionId: string,
  tenantPublicId: string
): Promise<AdminCurrentUser | null> => {
  const token = sessionId.trim();
  if (!token) {
    return null;
  }

  try {
    const response = await adminApiClient.auth.getMe({
      sessionId: token,
      tenant: { tenantPublicId },
    });

    const publicId = response.user?.publicId?.trim() ?? "";
    if (!publicId) {
      return null;
    }

    return {
      name: response.user?.name?.trim() ?? "",
      publicId,
      role: response.user?.role?.trim() ?? "",
    };
  } catch {
    return null;
  }
};

export const isAdminSessionValid = async (
  sessionId: string,
  tenantPublicId: string
): Promise<boolean> => {
  const user = await getAdminCurrentUser(sessionId, tenantPublicId);
  return user !== null;
};

export const sessionCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export { ADMIN_SESSION_COOKIE_NAME, sanitizeRedirectPath };
