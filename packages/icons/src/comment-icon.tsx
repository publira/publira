import { MessageSquare } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const CommentIcon = (props: IconProps): JSX.Element => (
  <MessageSquare {...props} />
);
