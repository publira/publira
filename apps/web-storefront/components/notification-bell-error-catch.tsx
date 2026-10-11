"use client";

import { catchError } from "next/error";
import type { ReactNode } from "react";

export const NotificationBellErrorCatch = catchError(
  ({ fallback }: { fallback: ReactNode }) => fallback
);
