import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

import { Message } from "#components/message";

interface LabelTabNavProps {
  current: "basic" | "eye-catch";
  labelId: string;
}

export const LabelTabNav = ({ current, labelId }: LabelTabNavProps) => (
  <div className="flex flex-wrap gap-2">
    <LinkButton
      render={<Link href={`/labels/${labelId}`} />}
      variant={current === "basic" ? "default" : "outline"}
    >
      <Message message="admin.labels.basic_tab" />
    </LinkButton>
    <LinkButton
      render={<Link href={`/labels/${labelId}?tab=eye-catch`} />}
      variant={current === "eye-catch" ? "default" : "outline"}
    >
      <Message message="admin.labels.eye_catch_tab" />
    </LinkButton>
  </div>
);
