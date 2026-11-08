import { Activity } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const ActivityIcon = (props: IconProps): JSX.Element => (
  <Activity {...props} />
);
