"use client";

import type { ComboboxItem } from "@publira/ui-components/combobox";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { useAdminLocale } from "#components/admin-locale-context";
import { useClientMessages } from "#components/client-message";
import type { ReaderOption } from "#lib/reader-options";
import { listReaderOptionsAction } from "#lib/reader-options-action";
import { useTenantId } from "#lib/use-tenant-id";

/** How long typing pauses before the readers are searched. */
const READER_SEARCH_DELAY_MS = 300;

interface ReaderPickerProps {
  /** The form field the chosen reader's primary key is submitted as. */
  name: string;
  /** Called with the chosen reader's primary key, or `""` once it is cleared. */
  onValueChange?: (readerId: string) => void;
}

/**
 * Finds one of the tenant's active readers by name or email as the operator
 * types, and submits the chosen reader's primary key under `name`.
 */
export const ReaderPicker = ({ name, onValueChange }: ReaderPickerProps) => {
  const locale = useAdminLocale();
  const t = useClientMessages();
  const tenantId = useTenantId();
  const [isPending, startTransition] = useTransition();
  const [readerId, setReaderId] = useState("");
  const [readers, setReaders] = useState<ReaderOption[]>([]);
  const [selectedReader, setSelectedReader] = useState<ReaderOption>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const requestIdRef = useRef(0);
  const searchTimerRef = useRef(0);

  // The chosen reader stays an option while a later search returns others, so
  // the picker keeps showing who was chosen.
  const items = useMemo<ComboboxItem[]>(() => {
    const options =
      selectedReader && !readers.some((item) => item.id === selectedReader.id)
        ? [selectedReader, ...readers]
        : readers;
    return options.map((item) => ({
      label: t("admin.reader_picker.option", {
        email: item.email,
        name: item.name,
      }),
      value: item.id,
    }));
  }, [readers, selectedReader, t]);

  // A pending search is abandoned when the picker goes away, so it cannot set
  // state on a picker nobody sees.
  useEffect(() => () => window.clearTimeout(searchTimerRef.current), []);

  const handleSearch = useCallback(
    (query: string) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      window.clearTimeout(searchTimerRef.current);
      if (query.trim() === "") {
        setReaders([]);
        setErrorMessage(undefined);
        return;
      }

      // Typing an address would otherwise search every prefix of it.
      searchTimerRef.current = window.setTimeout(() => {
        startTransition(async () => {
          const result = await listReaderOptionsAction(tenantId, query, locale);
          if (requestId !== requestIdRef.current) {
            return;
          }
          setReaders(result.readers);
          setErrorMessage(result.ok ? undefined : result.message);
        });
      }, READER_SEARCH_DELAY_MS);
    },
    [locale, tenantId]
  );

  const handleValueChange = useCallback(
    (nextReaderId: string) => {
      setReaderId(nextReaderId);
      setSelectedReader(
        [...readers, ...(selectedReader ? [selectedReader] : [])].find(
          (item) => item.id === nextReaderId
        )
      );
      onValueChange?.(nextReaderId);
    },
    [onValueChange, readers, selectedReader]
  );

  return (
    <>
      <Combobox
        items={items}
        onSearch={handleSearch}
        onValueChange={handleValueChange}
        value={readerId}
      >
        <ComboboxInput placeholder={t("admin.reader_picker.placeholder")} />
        <ComboboxPopup>
          <ComboboxEmpty>
            {isPending
              ? t("admin.reader_picker.searching")
              : t("admin.reader_picker.empty")}
          </ComboboxEmpty>
          <ComboboxItems />
        </ComboboxPopup>
      </Combobox>
      <input name={name} type="hidden" value={readerId} />
      {errorMessage ? (
        <FormMessage variant="destructive">{errorMessage}</FormMessage>
      ) : null}
    </>
  );
};
