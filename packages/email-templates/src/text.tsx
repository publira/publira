import type { CSSProperties, ReactNode } from "react";
import { Link, Text } from "react-email";

import { emailColors, emailFonts } from "./colors";

const headingStyle: CSSProperties = {
  color: emailColors.foreground,
  fontFamily: emailFonts.serif,
  fontSize: "22px",
  fontWeight: 600,
  lineHeight: "30px",
  margin: "0 0 8px",
};

const introStyle: CSSProperties = {
  color: emailColors.muted,
  fontSize: "13px",
  lineHeight: "20px",
  margin: "0 0 16px",
};

const bodyStyle: CSSProperties = {
  color: emailColors.foreground,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 24px",
};

const detailStyle: CSSProperties = {
  color: emailColors.foreground,
  fontSize: "14px",
  lineHeight: "22px",
  margin: "8px 0 0",
  wordBreak: "break-all",
};

const metaStyle: CSSProperties = {
  color: emailColors.muted,
  fontSize: "13px",
  lineHeight: "20px",
  margin: "24px 0 0",
};

const fallbackStyle: CSSProperties = {
  color: emailColors.muted,
  fontSize: "12px",
  lineHeight: "20px",
  margin: "16px 0 0",
  wordBreak: "break-all",
};

const fallbackLinkStyle: CSSProperties = {
  color: emailColors.brand,
};

export interface EmailTextProps {
  children: ReactNode;
}

/** The card's title, one per template. */
export const EmailHeading = ({ children }: EmailTextProps) => (
  <Text style={headingStyle}>{children}</Text>
);

/** The line under the heading that says why the mail arrived. */
export const EmailIntro = ({ children }: EmailTextProps) => (
  <Text style={introStyle}>{children}</Text>
);

/** What the recipient is asked to do, above the button. */
export const EmailBody = ({ children }: EmailTextProps) => (
  <Text style={bodyStyle}>{children}</Text>
);

/** One labelled value, such as an email address the mail talks about. */
export const EmailDetail = ({ children }: EmailTextProps) => (
  <Text style={detailStyle}>{children}</Text>
);

/** A closing remark: an expiry, or what to do about an unexpected mail. */
export const EmailMeta = ({ children }: EmailTextProps) => (
  <Text style={metaStyle}>{children}</Text>
);

export interface EmailFallbackLinkProps {
  children: ReactNode;
  href: string;
}

/**
 * The URL spelled out for a client that strips the button. `children` is the
 * sentence introducing it; the link text is the URL itself, so a recipient who
 * cannot click it can still read where the link goes.
 */
export const EmailFallbackLink = ({
  children,
  href,
}: EmailFallbackLinkProps) => (
  <Text style={fallbackStyle}>
    {children}{" "}
    <Link href={href} style={fallbackLinkStyle}>
      {href}
    </Link>
  </Text>
);
