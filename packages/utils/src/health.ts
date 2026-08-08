/**
 * Shared liveness / readiness helpers for Next.js apps.
 * Response shape matches server/internal/health (Go).
 *
 * - GET /livez  — process is up (always 200 + plain "ok")
 * - GET /readyz — dependencies healthy (200 / 503 + JSON)
 */

export const HEALTH_STATUS_OK = "ok" as const;
export const HEALTH_STATUS_UNAVAILABLE = "unavailable" as const;
export const HEALTH_STATUS_STARTING = "starting" as const;
export const HEALTH_STATUS_ERROR = "error" as const;

export type HealthOverallStatus =
  | typeof HEALTH_STATUS_OK
  | typeof HEALTH_STATUS_UNAVAILABLE
  | typeof HEALTH_STATUS_STARTING;

export type HealthCheckStatus =
  | typeof HEALTH_STATUS_OK
  | typeof HEALTH_STATUS_ERROR;

export interface HealthCheckResult {
  status: HealthCheckStatus;
  error?: string;
}

export interface ReadyzBody {
  status: HealthOverallStatus;
  checks: Record<string, HealthCheckResult>;
}

export interface HealthCheck {
  name: string;
  check: (signal: AbortSignal) => Promise<void>;
}

export interface ReadyzOptions {
  /** When false, overall status is "starting" with HTTP 503. */
  ready?: () => boolean;
  /** Per-check timeout in ms (default 2000). */
  timeoutMs?: number;
}

const DEFAULT_CHECK_TIMEOUT_MS = 2000;

const noStoreHeaders = {
  "cache-control": "no-store",
} as const;

const jsonResponse = (body: ReadyzBody, status: number): Response =>
  new Response(`${JSON.stringify(body)}\n`, {
    headers: {
      ...noStoreHeaders,
      "content-type": "application/json; charset=utf-8",
    },
    status,
  });

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "unknown error";
};

/** Liveness: process is accepting HTTP. */
export const createLivezResponse = (): Response =>
  new Response("ok", {
    headers: {
      ...noStoreHeaders,
      "content-type": "text/plain; charset=utf-8",
    },
    status: 200,
  });

const runCheck = async (
  check: HealthCheck,
  timeoutMs: number
): Promise<HealthCheckResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    await check.check(controller.signal);
    return { status: HEALTH_STATUS_OK };
  } catch (error) {
    return { error: errorMessage(error), status: HEALTH_STATUS_ERROR };
  } finally {
    clearTimeout(timer);
  }
};

/** Readiness: run dependency checks and return Kubernetes-friendly JSON. */
export const createReadyzResponse = async (
  checks: readonly HealthCheck[],
  options: ReadyzOptions = {}
): Promise<Response> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const results = await Promise.all(
    checks.map(async (check) => {
      const result = await runCheck(check, timeoutMs);
      return [check.name, result] as const;
    })
  );
  const checkMap: Record<string, HealthCheckResult> =
    Object.fromEntries(results);

  if (options.ready && !options.ready()) {
    const body: ReadyzBody = {
      checks: checkMap,
      status: HEALTH_STATUS_STARTING,
    };
    return jsonResponse(body, 503);
  }

  const failed = Object.values(checkMap).some(
    (result) => result.status !== HEALTH_STATUS_OK
  );
  const body: ReadyzBody = {
    checks: checkMap,
    status: failed ? HEALTH_STATUS_UNAVAILABLE : HEALTH_STATUS_OK,
  };
  return jsonResponse(body, failed ? 503 : 200);
};

/**
 * Probe an upstream Go API `/readyz` (or another path) over HTTP.
 * `baseUrl` is the service origin (e.g. `http://admin-api:8101`).
 */
export const checkUpstreamReadyz = async (
  baseUrl: string,
  signal?: AbortSignal,
  path = "/readyz"
): Promise<void> => {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error("upstream base URL is not configured");
  }

  let url: URL;
  try {
    url = new URL(path, trimmed.endsWith("/") ? trimmed : `${trimmed}/`);
  } catch {
    throw new Error(`invalid upstream base URL: ${trimmed}`);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json, text/plain;q=0.9,*/*;q=0.8" },
      method: "GET",
      redirect: "manual",
      signal,
    });
  } catch (error) {
    const detail = errorMessage(error);
    const reason =
      detail === "unknown error" ? "upstream request failed" : detail;
    throw new Error(`upstream ${url.toString()}: ${reason}`, { cause: error });
  }

  if (!response.ok) {
    throw new Error(
      `upstream ${url.pathname} returned HTTP ${response.status}`
    );
  }
};

/** Probe path helpers shared by app proxies. */
export const isHealthProbePath = (pathname: string): boolean =>
  pathname === "/livez" || pathname === "/readyz";
