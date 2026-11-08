import { Languages } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const LanguageIcon = (props: IconProps): JSX.Element => (
  <Languages {...props} />
);
