"use client";

import { useActionFormSettled } from "@publira/ui-components/action-form";
import { useState } from "react";

import { ReaderPicker } from "#components/reader-picker";

/**
 * The reader to link. A link that went through remounts the picker, so the
 * reader just linked is not left chosen for a second submission.
 */
export const CreatorAccountReaderField = () => {
  const [linkCount, setLinkCount] = useState(0);
  useActionFormSettled((state) => {
    if (state?.ok) {
      setLinkCount((count) => count + 1);
    }
  });

  return <ReaderPicker key={linkCount} name="reader_id" />;
};
