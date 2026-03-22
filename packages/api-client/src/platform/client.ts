import { createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { ConnectTransportOptions } from "@connectrpc/connect-web";

import { PlatformAuthService } from "../gen/publira/platform/v1/auth_pb.js";
import { PlatformOperatorService } from "../gen/publira/platform/v1/operator_pb.js";
import { PlatformSetupService } from "../gen/publira/platform/v1/setup_pb.js";
import { PlatformTenantService } from "../gen/publira/platform/v1/tenant_pb.js";
import { PlatformUserService } from "../gen/publira/platform/v1/user_pb.js";

export type PlatformApiClientOptions = {
  baseUrl: string;
} & Omit<ConnectTransportOptions, "baseUrl">;

export interface PlatformApiClient {
  auth: Client<typeof PlatformAuthService>;
  operators: Client<typeof PlatformOperatorService>;
  setup: Client<typeof PlatformSetupService>;
  tenants: Client<typeof PlatformTenantService>;
  users: Client<typeof PlatformUserService>;
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
    operators: createClient(PlatformOperatorService, transport),
    setup: createClient(PlatformSetupService, transport),
    tenants: createClient(PlatformTenantService, transport),
    users: createClient(PlatformUserService, transport),
  };
};
