/** A reader a picker offers, addressed by the primary key the RPCs take. */
export interface ReaderOption {
  email: string;
  id: string;
  name: string;
}

export type ListReaderOptionsResult =
  | { ok: true; readers: ReaderOption[] }
  | { message: string; ok: false; readers: ReaderOption[] };
