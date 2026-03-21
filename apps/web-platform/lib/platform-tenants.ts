import { platformApiClient } from "./platform-api-client";

export interface CreatePlatformTenantInput {
  domain?: string;
  initialAdminEmails?: string[];
  name: string;
  sessionId: string;
  subdomain: string;
}

export type CreatePlatformTenantResult =
  | { ok: true; publicId?: string }
  | { ok: false; message: string };

const genericErrorMessage =
  "テナント作成に失敗しました。時間をおいて再試行してください。";

export const createPlatformTenant = async (
  input: CreatePlatformTenantInput
): Promise<CreatePlatformTenantResult> => {
  const sessionId = input.sessionId.trim();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  const name = input.name.trim();
  const subdomain = input.subdomain.trim();
  const domain = (input.domain ?? "").trim();
  const initialAdminEmails = (input.initialAdminEmails ?? [])
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

  try {
    const response = await platformApiClient.tenants.createTenant(
      {
        domain,
        initialAdminEmails,
        name,
        subdomain,
      } as never,
      { headers: { "X-Publira-Session-Id": sessionId } } as never
    );

    return {
      ok: true,
      publicId: response.tenant?.publicId,
    };
  } catch (error) {
    if (!(error instanceof Error)) {
      return { message: genericErrorMessage, ok: false };
    }

    const message = error.message.toLowerCase();
    if (
      message.includes("already_exists") ||
      message.includes("already exists")
    ) {
      if (message.includes("subdomain")) {
        return {
          message: "サブドメインが既に使用されています。",
          ok: false,
        };
      }
      if (message.includes("domain")) {
        return {
          message: "ドメインが既に使用されています。",
          ok: false,
        };
      }
      return {
        message: "重複するデータがあるため作成できません。",
        ok: false,
      };
    }

    if (
      message.includes("unauthenticated") ||
      message.includes("permission_denied")
    ) {
      return {
        message: "セッションが無効です。再ログインしてください。",
        ok: false,
      };
    }

    if (
      message.includes("invalid_argument") ||
      message.includes("required") ||
      message.includes("invalid")
    ) {
      return { message: "入力内容に誤りがあります。", ok: false };
    }

    return { message: genericErrorMessage, ok: false };
  }
};
