/**
 * Environment handling for the Next.js tracing registration.
 *
 * The names and the defaults are the ones `server/internal/tracing` already
 * uses, so one deployment turns tracing on for the Go processes and the web
 * apps at once and both label their spans with the same tier.
 */

/** Turns tracing on. Tracing is opt-in, exactly as it is on the Go side. */
export const ENABLED_ENV = "PUBLIRA_TRACING_ENABLED";

/** Deployment tier. Decides `deployment.environment.name` and the sampler. */
export const ENVIRONMENT_ENV = "PUBLIRA_DEPLOYMENT_ENVIRONMENT";

/**
 * Read only to detect that the operator has taken sampling over; the
 * OpenTelemetry SDK is what parses it.
 */
export const SAMPLER_ENV = "OTEL_TRACES_SAMPLER";

/**
 * The assumed tier when {@link ENVIRONMENT_ENV} is unset. Tracing is opt-in, so
 * a process with tracing on and no declared tier is someone trying it out
 * locally.
 */
export const ENVIRONMENT_DEVELOPMENT = "development";

/**
 * The share of root spans sampled outside development. Override it with
 * `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`.
 */
export const PRODUCTION_SAMPLE_RATIO = 0.1;

export type TracingEnv = Record<string, string | undefined>;

/** The values Go's `strconv.ParseBool` reads as true, case-insensitively. */
const TRUE_VALUES = new Set(["1", "t", "true"]);

const read = (env: TracingEnv, name: string): string =>
  (env[name] ?? "").trim();

/** Reports whether {@link ENABLED_ENV} asks for tracing. */
export const isTracingEnabled = (env: TracingEnv): boolean =>
  TRUE_VALUES.has(read(env, ENABLED_ENV).toLowerCase());

/** The deployment tier, defaulting to {@link ENVIRONMENT_DEVELOPMENT}. */
export const deploymentEnvironment = (env: TracingEnv): string =>
  read(env, ENVIRONMENT_ENV).toLowerCase() || ENVIRONMENT_DEVELOPMENT;

/**
 * How the root span of a trace this app starts should be sampled.
 *
 * Development samples every root span, because a trace you cannot find is
 * worth nothing while debugging. Every other tier samples a share of them,
 * since a busy deployment would otherwise export a span for every request.
 * `operator` means {@link SAMPLER_ENV} is set and the SDK parses that instead.
 */
export type RootSampling =
  | { kind: "always_on" }
  | { kind: "operator" }
  | { kind: "ratio"; ratio: number };

/** The sampling the deployment tier asks for. */
export const rootSampling = (env: TracingEnv): RootSampling => {
  if (read(env, SAMPLER_ENV)) {
    return { kind: "operator" };
  }
  if (deploymentEnvironment(env) === ENVIRONMENT_DEVELOPMENT) {
    return { kind: "always_on" };
  }
  return { kind: "ratio", ratio: PRODUCTION_SAMPLE_RATIO };
};
