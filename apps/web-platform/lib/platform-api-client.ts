import { createPlatformApiClient } from "@publira/api-client/platform/client";

const platformApiBaseUrl =
  process.env.PUBLIRA_PLATFORM_API_BASE_URL ?? "http://localhost:8002";

export const platformApiClient = createPlatformApiClient({
  baseUrl: platformApiBaseUrl,
});
