import { Receipt } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const ReceiptIcon = (props: IconProps): JSX.Element => (
  <Receipt {...props} />
);
