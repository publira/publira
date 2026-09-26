import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

import { Message } from "#components/message";

interface GenreTabNavProps {
  current: "basic" | "eye-catch";
  genreId: string;
}

export const GenreTabNav = ({ current, genreId }: GenreTabNavProps) => (
  <div className="flex flex-wrap gap-2">
    <LinkButton
      render={<Link href={`/genres/${genreId}`} />}
      variant={current === "basic" ? "default" : "outline"}
    >
      <Message message="admin.genres.basic_tab" />
    </LinkButton>
    <LinkButton
      render={<Link href={`/genres/${genreId}?tab=eye-catch`} />}
      variant={current === "eye-catch" ? "default" : "outline"}
    >
      <Message message="admin.genres.eye_catch_tab" />
    </LinkButton>
  </div>
);
