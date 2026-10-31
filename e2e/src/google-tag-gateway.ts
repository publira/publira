import { GOOGLE_TAG_GATEWAY_BASE_URL } from "./urls";

/** A request web-storefront forwarded to the stand-in for Google's gateway. */
export interface GoogleTagGatewayRequest {
  body: string;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  /** The path and query, as forwarded. */
  url: string;
}

const requestsUrl = `${GOOGLE_TAG_GATEWAY_BASE_URL}/__e2e/requests`;

/** Every request the stand-in received since it was last cleared, oldest first. */
export const googleTagGatewayRequests = async (): Promise<
  GoogleTagGatewayRequest[]
> => {
  const response = await fetch(requestsUrl);

  if (!response.ok) {
    throw new Error(
      `the Google tag gateway stand-in did not answer its requests: ${response.status}`
    );
  }

  // SAFETY: the list of recorded requests e2e/scripts/google-tag-gateway.ts
  // answers `GET /__e2e/requests` with.
  return (await response.json()) as GoogleTagGatewayRequest[];
};

/** Forgets every request the stand-in received. */
export const clearGoogleTagGatewayRequests = async (): Promise<void> => {
  const response = await fetch(requestsUrl, { method: "DELETE" });

  if (!response.ok) {
    throw new Error(
      `the Google tag gateway stand-in did not clear its requests: ${response.status}`
    );
  }
};
