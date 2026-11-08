import { Ticket } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const TicketIcon = (props: IconProps): JSX.Element => (
  <Ticket {...props} />
);
