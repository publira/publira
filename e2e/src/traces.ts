import "temporal-polyfill/global";

/**
 * Reads back the traces the stack's processes exported to the Jaeger of a run
 * on `PUBLIRA_E2E_TRACING=on` (`task e2e:tracing`), through its query API.
 */

/** OTLP's span kinds, as the query API writes them. */
export const SpanKind = {
  CLIENT: 3,
  SERVER: 2,
} as const;

/** One span of a trace, with the `service.name` of the process that made it. */
export interface TraceSpan {
  attributes: Record<string, string>;
  kind: number;
  name: string;
  parentSpanId: string;
  service: string;
  spanId: string;
  traceId: string;
}

interface OtlpValue {
  boolValue?: boolean;
  doubleValue?: number;
  intValue?: string;
  stringValue?: string;
}

interface OtlpAttribute {
  key: string;
  value: OtlpValue;
}

interface OtlpTraces {
  result?: {
    resourceSpans?: {
      resource?: { attributes?: OtlpAttribute[] };
      scopeSpans?: {
        spans?: {
          attributes?: OtlpAttribute[];
          kind?: number;
          name: string;
          parentSpanId?: string;
          spanId: string;
          traceId: string;
        }[];
      }[];
    }[];
  };
}

const jaegerBaseUrl = (): string => {
  const url = process.env.PUBLIRA_E2E_JAEGER_BASE_URL?.trim();

  if (!url) {
    throw new Error(
      "PUBLIRA_E2E_JAEGER_BASE_URL is unset: run the suite through `task e2e:tracing`, which starts the stack with PUBLIRA_E2E_TRACING=on"
    );
  }

  return url.replace(/\/$/u, "");
};

const attributeValue = ({
  boolValue,
  doubleValue,
  intValue,
  stringValue,
}: OtlpValue): string =>
  String(stringValue ?? intValue ?? doubleValue ?? boolValue ?? "");

const attributeRecord = (
  attributes: readonly OtlpAttribute[] | undefined
): Record<string, string> =>
  Object.fromEntries(
    (attributes ?? []).map(({ key, value }) => [key, attributeValue(value)])
  );

/**
 * Every span of the traces that hold a span of `service` started at or after
 * `since`, flattened across the processes that made them. A trace is returned
 * whole, with the spans of every other service in it, so one query is enough to
 * follow a request from the process it entered to the last one it reached.
 *
 * An empty list is what the API answers before the first span of such a trace
 * has been exported, since every SDK in the stack exports in batches.
 */
export const tracesOfService = async (
  service: string,
  since: Temporal.Instant
): Promise<TraceSpan[]> => {
  const query = new URLSearchParams({
    "query.num_traces": "100",
    "query.service_name": service,
    "query.start_time_max": Temporal.Now.instant()
      .add({ minutes: 1 })
      .toString(),
    "query.start_time_min": since.toString(),
  });

  const response = await fetch(`${jaegerBaseUrl()}/api/v3/traces?${query}`);

  // The API answers a search that matched nothing with a 404.
  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(
      `Jaeger did not answer the trace search: ${response.status} ${await response.text()}`
    );
  }

  // SAFETY: the OTLP JSON Jaeger's `/api/v3/traces` answers a search with.
  const { result } = (await response.json()) as OtlpTraces;

  return (result?.resourceSpans ?? []).flatMap(({ resource, scopeSpans }) => {
    const serviceName =
      attributeRecord(resource?.attributes)["service.name"] ?? "";

    return (scopeSpans ?? []).flatMap(({ spans }) =>
      (spans ?? []).map((span) => ({
        attributes: attributeRecord(span.attributes),
        kind: span.kind ?? 0,
        name: span.name,
        parentSpanId: span.parentSpanId ?? "",
        service: serviceName,
        spanId: span.spanId,
        traceId: span.traceId,
      }))
    );
  });
};
