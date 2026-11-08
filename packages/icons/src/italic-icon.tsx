import { Italic } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const ItalicIcon = (props: IconProps): JSX.Element => (
  <Italic {...props} />
);
