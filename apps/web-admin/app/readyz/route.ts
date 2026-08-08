import { checkRedisReady } from "@publira/next-cache-handlers";
import {
  checkUpstreamReadyz,
  createReadyzResponse,
} from "@publira/utils/health";
import type { HealthCheck } from "@publira/utils/health";

const adminApiBaseUrl =
  process.env.PUBLIRA_ADMIN_GRPC_URL ?? "http://localhost:8101";

const checks: HealthCheck[] = [
  {
    check: (signal) => checkUpstreamReadyz(adminApiBaseUrl, signal),
    name: "api",
  },
  {
    check: () => checkRedisReady(),
    name: "redis",
  },
];

export const GET = () => createReadyzResponse(checks);
