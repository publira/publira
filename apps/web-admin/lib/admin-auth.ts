import {
  ADMIN_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./admin-auth-shared";
import { apiClient } from "./api";
import { getSessionId } from "./session";

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

export interface TenantAdminInvitationState {
  accountExists: boolean;
  email: string;
  expiresAt: string;
  status: string;
}

export type AcceptTenantAdminInvitationResult =
  | {
      ok: true;
      accountCreated: boolean;
      accepted: boolean;
    }
  | {
      ok: false;
      message: string;
    };

export const isTenantAdminRole = (role: string | null | undefined): boolean => {
  const normalizedRole = role?.trim().toLowerCase();
  return normalizedRole === "admin" || normalizedRole === "tenant_admin";
};

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
    const response = await apiClient.auth.createSession({
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

  await apiClient.auth.deleteSession({
    sessionId,
    tenant: { tenantPublicId },
  });
};

export const getAdminCurrentUser = async (
  tenantPublicId: string
): Promise<AdminCurrentUser | null> => {
  "use cache: private";

  const token = await getSessionId();
  if (!token) {
    return null;
  }

  try {
    const response = await apiClient.auth.getMe({
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
  tenantPublicId: string
): Promise<boolean> => {
  const user = await getAdminCurrentUser(tenantPublicId);
  return user !== null;
};

export const sessionCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export { ADMIN_SESSION_COOKIE_NAME, sanitizeRedirectPath };

export const getTenantAdminInvitationState = async (
  tenantPublicId: string,
  token: string
): Promise<TenantAdminInvitationState | null> => {
  const normalizedToken = token.trim();
  if (!tenantPublicId.trim() || !normalizedToken) {
    return null;
  }

  try {
    const response = await apiClient.auth.getTenantAdminInvitationState({
      tenant: { tenantPublicId },
      token: normalizedToken,
    });

    return {
      accountExists: response.accountExists,
      email: response.email,
      expiresAt: response.expiresAt,
      status: response.status,
    };
  } catch {
    return null;
  }
};

export const acceptTenantAdminInvitation = async (
  tenantPublicId: string,
  token: string,
  name?: string,
  password?: string
): Promise<AcceptTenantAdminInvitationResult> => {
  const normalizedToken = token.trim();
  if (!tenantPublicId.trim() || !normalizedToken) {
    return {
      message: "招待トークンが無効です。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.auth.acceptTenantAdminInvitation({
      name: name?.trim() ?? "",
      password: password?.trim() ?? "",
      tenant: { tenantPublicId },
      token: normalizedToken,
    });

    return {
      accepted: response.accepted,
      accountCreated: response.accountCreated,
      ok: true,
    };
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes("expired")) {
        return { message: "招待リンクの有効期限が切れています。", ok: false };
      }
      if (message.includes("canceled")) {
        return { message: "この招待は取り消されています。", ok: false };
      }
      if (message.includes("not_found")) {
        return { message: "招待が見つかりません。", ok: false };
      }
      if (message.includes("invalid_argument") || message.includes("required")) {
        return { message: "入力内容に誤りがあります。", ok: false };
      }
    }
    return {
      message: "招待の承諾に失敗しました。時間をおいて再試行してください。",
      ok: false,
    };
  }
};
