import { createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { ConnectTransportOptions } from "@connectrpc/connect-web";

import { PlatformAuthService } from "../gen/publira/platform/v1/auth_pb.js";
import { PlatformSetupService } from "../gen/publira/platform/v1/setup_pb.js";

export type PlatformApiClientOptions = {
  baseUrl: string;
} & Omit<ConnectTransportOptions, "baseUrl">;

export interface PlatformApiClient {
  auth: Client<typeof PlatformAuthService>;
  setup: Client<typeof PlatformSetupService>;
}

export const createPlatformApiClient = (
  options: PlatformApiClientOptions
): PlatformApiClient => {
  const { baseUrl, ...transportOptions } = options;
  const transport = createConnectTransport({
    baseUrl,
    ...transportOptions,
  });

  return {
    auth: createClient(PlatformAuthService, transport),
    setup: createClient(PlatformSetupService, transport),
  };
};
