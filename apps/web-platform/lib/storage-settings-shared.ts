/**
 * How the stored secret access key is treated by a save or a test, matching
 * `publira.platform.v1.SecretUpdateMode`.
 */
export const STORAGE_SECRET_UNCHANGED = 1;
export const STORAGE_SECRET_REPLACE = 2;
export const STORAGE_SECRET_CLEAR = 3;

/**
 * Which credential signs requests to the bucket: the one each process finds
 * for itself, or an access key saved here.
 */
export type StorageCredentialMode = "access_key" | "ambient";

export interface PlatformStorageSettings {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  hasSecretAccessKey: boolean;
  publicBaseUrl: string;
  /** Decimal int64; `"0"` means no configuration has been saved yet. */
  revision: string;
  region: string;
}

export const storageCredentialMode = (
  settings: Pick<PlatformStorageSettings, "accessKeyId">
): StorageCredentialMode => (settings.accessKeyId ? "access_key" : "ambient");
