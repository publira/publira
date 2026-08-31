import type { Sampler } from "@opentelemetry/sdk-trace-base";
import {
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from "@opentelemetry/semantic-conventions";
import { registerOTel } from "@vercel/otel";

import type { TracingEnv } from "./config.js";
import {
  deploymentEnvironment,
  isTracingEnabled,
  rootSampling,
} from "./config.js";

export {
  ENABLED_ENV,
  ENVIRONMENT_DEVELOPMENT,
  ENVIRONMENT_ENV,
  PRODUCTION_SAMPLE_RATIO,
  SAMPLER_ENV,
} from "./config.js";

/**
 * The sampler for the current deployment tier, or `undefined` when the
 * operator has taken sampling over through `OTEL_TRACES_SAMPLER`.
 *
 * It is parent-based, so a request that arrives already sampled stays sampled
 * through the Connect RPCs and DB queries it triggers. A Next.js app is where
 * a browser request becomes a trace, so this decision is the one the Go
 * services downstream inherit.
 */
const defaultSampler = (env: TracingEnv): Sampler | undefined => {
  const sampling = rootSampling(env);
  if (sampling.kind === "operator") {
    return undefined;
  }
  return new ParentBasedSampler({
    root:
      sampling.kind === "always_on"
        ? new AlwaysOnSampler()
        : new TraceIdRatioBasedSampler(sampling.ratio),
  });
};

/**
 * Registers the OpenTelemetry SDK for a Next.js app. Call it from the app's
 * `instrumentation.ts` `register()`.
 *
 * Tracing is opt-in: without `PUBLIRA_TRACING_ENABLED` nothing is registered,
 * so Next.js records into OpenTelemetry's no-op provider and no collector has
 * to exist. `@vercel/otel` has a build for both the Node.js and the Edge
 * runtime, so the same call is safe from either.
 *
 * serviceName is the process-level default for `service.name`;
 * `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` override it. The exporter
 * is configured through the `OTEL_EXPORTER_OTLP_*` variables the SDK reads
 * itself.
 */
export const registerTracing = (serviceName: string): void => {
  const { env } = process;
  if (!isTracingEnabled(env)) {
    return;
  }

  const sampler = defaultSampler(env);
  registerOTel({
    attributes: {
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: deploymentEnvironment(env),
    },
    serviceName,
    ...(sampler ? { traceSampler: sampler } : {}),
  });
};
