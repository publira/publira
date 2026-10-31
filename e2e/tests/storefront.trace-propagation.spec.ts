import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import type { TraceSpan } from "../src/traces";
import { SpanKind, tracesOfService } from "../src/traces";
import { storefrontPath } from "../src/urls";

const STOREFRONT_SERVICE = "publira-web-storefront";
const API_SERVICE = "publira-api-server";

/**
 * The RPC the search page issues for the keyword in its URL. A keyword no
 * other request has used is a read no cache entry answers, so the request
 * reaches the API and the database every time the test runs, on a stack kept
 * across runs as well as on a fresh one.
 */
const SEARCH_RPC = "CatalogService/SearchPublishedSeries";

/** Whether `span` sits somewhere beneath the span `ancestorId` names. */
const descendsFrom = (
  span: TraceSpan,
  ancestorId: string,
  bySpanId: ReadonlyMap<string, TraceSpan>
): boolean => {
  for (
    let parent = bySpanId.get(span.parentSpanId);
    parent;
    parent = bySpanId.get(parent.parentSpanId)
  ) {
    if (parent.spanId === ancestorId) {
      return true;
    }
  }

  return false;
};

/**
 * The chain of the search RPC within one trace, one step per segment that
 * joined it up: the storefront's client span, the API's server span under it,
 * and a database query under that. A step is missing from the end when the
 * segment before it started a trace of its own, or when the trace has not been
 * exported in full yet.
 */
const traceChain = (trace: readonly TraceSpan[]): string[] => {
  const bySpanId = new Map(trace.map((span) => [span.spanId, span]));
  const chain = [`${STOREFRONT_SERVICE} request`];

  const client = trace.find(
    ({ kind, name, service }) =>
      service === STOREFRONT_SERVICE &&
      kind === SpanKind.CLIENT &&
      name === SEARCH_RPC
  );

  if (!client) {
    return chain;
  }

  chain.push(`${STOREFRONT_SERVICE} client ${SEARCH_RPC}`);

  const server = trace.find(
    ({ kind, name, parentSpanId, service }) =>
      service === API_SERVICE &&
      kind === SpanKind.SERVER &&
      name === SEARCH_RPC &&
      parentSpanId === client.spanId
  );

  if (!server) {
    return chain;
  }

  chain.push(`${API_SERVICE} server ${SEARCH_RPC}`);

  if (
    trace.some(
      (span) =>
        span.service === API_SERVICE &&
        span.name === "db.query" &&
        descendsFrom(span, server.spanId, bySpanId)
    )
  ) {
    chain.push(`${API_SERVICE} db.query`);
  }

  return chain;
};

/**
 * The longest {@link traceChain} among the traces a request for `target` left.
 * One request leaves two: `proxy.ts` runs in a trace of its own, apart from the
 * render, and both of its root spans name the request's URL.
 */
const searchChain = (spans: readonly TraceSpan[], target: string): string[] => {
  const traceIds = new Set(
    spans.flatMap(({ attributes, service, traceId }) =>
      service === STOREFRONT_SERVICE &&
      attributes["http.target"]?.includes(target)
        ? [traceId]
        : []
    )
  );

  let longest: string[] = [];

  for (const id of traceIds) {
    const chain = traceChain(spans.filter(({ traceId }) => traceId === id));

    if (chain.length > longest.length) {
      longest = chain;
    }
  }

  return longest;
};

test.describe("Trace propagation", () => {
  test("joins a storefront request, the RPC it issues, and the queries behind it into one trace", async ({
    request,
  }) => {
    const keyword = `trace-${randomUUID()}`;
    // The query API filters on when a trace started, so the window opens a
    // little before the request does, for a clock Jaeger reads apart from
    // this one.
    const since = Temporal.Now.instant().subtract({ seconds: 5 });

    // Through the edge, as a reader arrives: it strips any inbound
    // `traceparent`, so the storefront's span is the root of the trace.
    const response = await request.get(
      `${storefrontPath("/search")}?${new URLSearchParams({ q: keyword })}`
    );

    expect(response.status()).toBe(200);

    // Every SDK exports in batches, a few seconds apart.
    await expect
      .poll(
        async () =>
          searchChain(
            await tracesOfService(STOREFRONT_SERVICE, since),
            keyword
          ),
        { timeout: 30_000 }
      )
      .toEqual([
        `${STOREFRONT_SERVICE} request`,
        `${STOREFRONT_SERVICE} client ${SEARCH_RPC}`,
        `${API_SERVICE} server ${SEARCH_RPC}`,
        `${API_SERVICE} db.query`,
      ]);
  });
});
