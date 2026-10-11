/**
 * POST a report to this app's own API and resolve whether it was delivered.
 * `keepalive` outlives a navigation as a beacon does, and unlike a beacon it
 * answers: a rejected request (offline) or a 5xx is undelivered, while a 4xx
 * would be refused again and so settles the report.
 *
 * The JSON content type keeps the request off the CORS safelist, the layer
 * above the endpoint's same-origin check.
 */
export const postReport = async (
  path: string,
  body: unknown = {}
): Promise<boolean> => {
  try {
    const response = await fetch(path, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    });
    return response.status < 500;
  } catch {
    return false;
  }
};

/** Calls `retry` once the browser reports the connection back; returns the unsubscribe. */
export type WaitForConnection = (retry: () => void) => () => void;

export const waitForConnection: WaitForConnection = (retry) => {
  window.addEventListener("online", retry, { once: true });
  return () => {
    window.removeEventListener("online", retry);
  };
};

export interface Report {
  /** Send the report unless it is already in flight or delivered. */
  send: () => void;
}

/**
 * A report sent until it is delivered. A failed send tries again on its own
 * once the connection returns, and a later `send` also retries it.
 */
export const createReport = ({
  deliver,
  onReconnect = waitForConnection,
}: {
  deliver: () => Promise<boolean>;
  onReconnect?: WaitForConnection;
}): Report => {
  let state: "delivered" | "idle" | "sending" = "idle";
  let stopWaiting: (() => void) | null = null;

  const send = async () => {
    if (state !== "idle") {
      return;
    }
    stopWaiting?.();
    stopWaiting = null;
    state = "sending";
    if (await deliver()) {
      state = "delivered";
      return;
    }
    state = "idle";
    stopWaiting = onReconnect(() => {
      void send();
    });
  };

  return {
    send: () => {
      void send();
    },
  };
};
