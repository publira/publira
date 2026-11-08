import { Check } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const CheckIcon = (props: IconProps): JSX.Element => (
  <Check {...props} />
);
