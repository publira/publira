import { checkRedisReady } from "@publira/next-cache-handlers";
import {
  checkUpstreamReadyz,
  createReadyzResponse,
} from "@publira/utils/health";
import type { HealthCheck } from "@publira/utils/health";

const platformApiBaseUrl =
  process.env.PUBLIRA_PLATFORM_GRPC_URL ?? "http://localhost:8102";

const checks: HealthCheck[] = [
  {
    check: (signal) => checkUpstreamReadyz(platformApiBaseUrl, signal),
    name: "api",
  },
  {
    check: () => checkRedisReady(),
    name: "redis",
  },
];

export const GET = () => createReadyzResponse(checks);
