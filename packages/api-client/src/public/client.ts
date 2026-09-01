import { createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { ConnectTransportOptions } from "@connectrpc/connect-web";

import { AuthService } from "../gen/publira/v1/auth_pb.js";
import {
  CatalogService,
  ContentViewService,
  EpisodeReadService,
  FollowService,
  PurchaseService,
  RatingService,
} from "../gen/publira/v1/catalog_pb.js";
import { DomainService } from "../gen/publira/v1/domain_pb.js";
import { NotificationService } from "../gen/publira/v1/notification_pb.js";
import { PublicPagesService } from "../gen/publira/v1/page_pb.js";
import { TenantService } from "../gen/publira/v1/tenant_pb.js";
import { createTenantHeaderInterceptor } from "../tenant-header.js";
import type { TenantHeaderOptions } from "../tenant-header.js";
import { createTracingInterceptor } from "../tracing.js";
import type { TransportType } from "../transport-type.js";

export type { TransportType } from "../transport-type.js";

export type PublicApiClientOptions = {
  baseUrl: string;
  transport?: TransportType;
} & Omit<ConnectTransportOptions, "baseUrl"> &
  TenantHeaderOptions;

export interface PublicApiClient {
  auth: Client<typeof AuthService>;
  catalog: Client<typeof CatalogService>;
  contentView: Client<typeof ContentViewService>;
  episodeRead: Client<typeof EpisodeReadService>;
  follow: Client<typeof FollowService>;
  notification: Client<typeof NotificationService>;
  pages: Client<typeof PublicPagesService>;
  purchase: Client<typeof PurchaseService>;
  rating: Client<typeof RatingService>;
  tenant: Client<typeof TenantService>;
  domain: Client<typeof DomainService>;
}

export const createPublicApiClient = (
  options: PublicApiClientOptions
): PublicApiClient => {
  const {
    baseUrl,
    transport = "connect",
    tenantPublicId,
    ...transportOptions
  } = options;

  const tenantHeaderInterceptor = createTenantHeaderInterceptor({
    tenantPublicId,
  });
  const interceptors = [
    createTracingInterceptor(transport),
    ...(tenantHeaderInterceptor ? [tenantHeaderInterceptor] : []),
    ...(transportOptions.interceptors ?? []),
  ];

  const transportInstance =
    transport === "grpc"
      ? createGrpcTransport({
          baseUrl,
          ...transportOptions,
          interceptors,
        })
      : createConnectTransport({
          baseUrl,
          ...transportOptions,
          interceptors,
        });

  return {
    auth: createClient(AuthService, transportInstance),
    catalog: createClient(CatalogService, transportInstance),
    contentView: createClient(ContentViewService, transportInstance),
    domain: createClient(DomainService, transportInstance),
    episodeRead: createClient(EpisodeReadService, transportInstance),
    follow: createClient(FollowService, transportInstance),
    notification: createClient(NotificationService, transportInstance),
    pages: createClient(PublicPagesService, transportInstance),
    purchase: createClient(PurchaseService, transportInstance),
    rating: createClient(RatingService, transportInstance),
    tenant: createClient(TenantService, transportInstance),
  };
};
