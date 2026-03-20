"use client";

import { useRender } from "@base-ui/react/use-render";
import { cn } from "@publira/utils";
import type { VariantProps } from "class-variance-authority";

import { buttonVariants } from "./button";

export type LinkButtonProps = useRender.ComponentProps<"a"> &
  VariantProps<typeof buttonVariants>;

export const LinkButton = ({
  className,
  size,
  variant,
  render,
  ref,
  ...props
}: LinkButtonProps) =>
  useRender({
    defaultTagName: "a",
    props: {
      ...props,
      className: cn(buttonVariants({ size, variant }), className),
    },
    ref,
    // eslint-disable-next-line jsx-a11y/anchor-has-content, jsx-a11y/anchor-is-valid
    render: render ?? <a />,
  });
