import {
  isMissingResourceRpcError,
  isUnauthenticatedRpcError,
  RPC_ERROR_REASON,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import type { RpcErrorDisposition } from "@publira/api-client/errors";
import { DataExportState } from "@publira/api-client/public/types";
import type { DataExport } from "@publira/api-client/public/types";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";

/** The generated `DataExport` fields {@link toMyDataExport} reads. */
type RawDataExport = Pick<DataExport, "expiresAt" | "state">;

/**
 * The reader's latest request for an archive of their data. `failed` is one
 * the install gave up on for want of an object store, which the reader may ask
 * again after.
 */
export type MyDataExport =
  | { state: "failed" }
  | { state: "pending" }
  | {
      /** RFC 3339: when the archive is deleted and stops downloading. */
      expiresAt: string;
      state: "ready";
    };

/** A state this build does not know reads as no request at all. */
const toMyDataExport = (dataExport: RawDataExport): MyDataExport | null => {
  switch (dataExport.state) {
    case DataExportState.PENDING: {
      return { state: "pending" };
    }

    case DataExportState.READY: {
      return { expiresAt: dataExport.expiresAt, state: "ready" };
    }

    case DataExportState.FAILED: {
      return { state: "failed" };
    }

    default: {
      return null;
    }
  }
};

/**
 * The signed-in reader's latest request for their archive that has not
 * expired, or `null` when there is none.
 */
export const getMyDataExport = async (
  tenantId: string,
  accessToken?: string
): Promise<MyDataExport | null> => {
  const sid = await resolveAccessToken(accessToken);

  if (!sid) {
    return null;
  }

  const response = await apiClient.auth.getMyDataExport(
    { tenant: { tenantId } },
    buildSessionHeaders(sid)
  );

  return response.dataExport ? toMyDataExport(response.dataExport) : null;
};

/**
 * What became of a request for the archive. `in-progress` is a request of the
 * reader's still being prepared, and `storage-not-configured` an install with
 * no object store to keep the archive in; every other refusal keeps its
 * disposition so it is worded the way the shared RPC copy words it.
 */
export type DataExportRequestOutcome =
  | { ok: true }
  | {
      ok: false;
      refusal: "in-progress" | "storage-not-configured" | RpcErrorDisposition;
    };

/**
 * Ask for an archive of what the install keeps about the signed-in reader,
 * which the worker builds and then tells them of in their inbox and by mail.
 */
export const requestMyDataExport = async (
  tenantId: string,
  accessToken?: string
): Promise<DataExportRequestOutcome> => {
  const sid = await resolveAccessToken(accessToken);

  try {
    await apiClient.auth.requestMyDataExport(
      { tenant: { tenantId } },
      buildSessionHeaders(sid)
    );

    return { ok: true };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }

    rethrowUnclassifiedRpcError(error);

    if (rpcErrorHasReason(error, RPC_ERROR_REASON.dataExportInProgress)) {
      return { ok: false, refusal: "in-progress" };
    }

    if (rpcErrorHasReason(error, RPC_ERROR_REASON.storageNotConfigured)) {
      return { ok: false, refusal: "storage-not-configured" };
    }

    return { ok: false, refusal: rpcErrorDisposition(error) };
  }
};

/**
 * The signed-in reader's ready archive as a stream of the ZIP file's bytes, or
 * `null` when there is none to download.
 *
 * The first piece is awaited before the stream is handed back, because the API
 * refuses a call — a session it turns away, an archive that expired — before it
 * sends anything: the caller can still answer with a redirect or a 404 then,
 * where a failure halfway through can only cut the download short. Cancelling
 * the stream, as a browser that gives up on the download does, ends the call.
 */
export const openMyDataExport = async (
  tenantId: string,
  accessToken?: string
): Promise<ReadableStream<Uint8Array> | null> => {
  const sid = await resolveAccessToken(accessToken);
  const call = new AbortController();

  const response = apiClient.auth.downloadMyDataExport(
    { tenant: { tenantId } },
    { ...buildSessionHeaders(sid), signal: call.signal }
  );

  const pieces = response[Symbol.asyncIterator]();

  let first: Awaited<ReturnType<typeof pieces.next>>;

  try {
    first = await pieces.next();
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return null;
    }

    throw error;
  }

  return new ReadableStream<Uint8Array>({
    cancel: () => {
      call.abort();
    },
    pull: async (controller) => {
      if (first.done) {
        controller.close();

        return;
      }

      controller.enqueue(first.value.data);
      first = await pieces.next();
    },
  });
};
