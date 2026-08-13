import { fromDateTimeLocalValue } from "@publira/utils";

/**
 * Resolve a `datetime-local` wall clock against the zone the form was
 * rendered in, and write the absolute instant into a hidden field. The
 * Server Action then cannot reinterpret the same wall clock after the
 * tenant zone changes in another tab.
 */
export const fillInstantFromDateTimeLocal = (
  form: HTMLFormElement,
  input: {
    isoName: string;
    localName: string;
    timeZone: string;
  }
): void => {
  const localInput = form.elements.namedItem(input.localName);
  const isoInput = form.elements.namedItem(input.isoName);
  if (!(isoInput instanceof HTMLInputElement)) {
    return;
  }

  const localValue =
    localInput instanceof HTMLInputElement ? localInput.value : "";
  isoInput.value = fromDateTimeLocalValue(localValue, input.timeZone);
};
