import { CalendarDays } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const CalendarIcon = (props: IconProps): JSX.Element => (
  <CalendarDays {...props} />
);
