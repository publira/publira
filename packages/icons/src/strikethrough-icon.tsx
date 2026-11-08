import { Strikethrough } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const StrikethroughIcon = (props: IconProps): JSX.Element => (
  <Strikethrough {...props} />
);
