"use client";

import { Select } from "@publira/ui-components/select";
import { useCallback, useState } from "react";

import { useClientMessages } from "#components/client-message";
import { isReadingDirectionValue } from "#lib/reading-layout";
import type { ReadingDirectionValue } from "#lib/reading-layout";

/**
 * The direction the series is read in, and the hidden field that posts it. The
 * caller places it in a `Field` and writes the label and the description there.
 */
export const SeriesReadingDirectionSelect = ({
  initialValue,
}: {
  initialValue: ReadingDirectionValue;
}) => {
  const t = useClientMessages();
  const [value, setValue] = useState(initialValue);

  const handleValueChange = useCallback((next: string) => {
    if (isReadingDirectionValue(next)) {
      setValue(next);
    }
  }, []);

  return (
    <>
      <Select
        items={[
          {
            label: t("admin.series.form.reading_direction_options.rtl"),
            value: "rtl",
          },
          {
            label: t("admin.series.form.reading_direction_options.ltr"),
            value: "ltr",
          },
        ]}
        onValueChange={handleValueChange}
        value={value}
      />
      <input name="reading_direction" type="hidden" value={value} />
    </>
  );
};
