import type { CSSProperties, ReactNode } from "react";
import { Button } from "react-email";

import { emailColors, emailFonts } from "./colors";

const buttonStyle: CSSProperties = {
  backgroundColor: emailColors.brand,
  borderRadius: "6px",
  color: emailColors.buttonForeground,
  display: "inline-block",
  fontFamily: emailFonts.sans,
  fontSize: "15px",
  fontWeight: 600,
  lineHeight: "100%",
  padding: "14px 24px",
  textDecoration: "none",
};

export interface EmailButtonProps {
  children: ReactNode;
  href: string;
}

export const EmailButton = ({ children, href }: EmailButtonProps) => (
  <Button href={href} style={buttonStyle}>
    {children}
  </Button>
);
