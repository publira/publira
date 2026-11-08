import { Shapes } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const ShapesIcon = (props: IconProps): JSX.Element => (
  <Shapes {...props} />
);
