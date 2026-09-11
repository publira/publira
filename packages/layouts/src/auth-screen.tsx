import type { ReactNode } from "react";

/**
 * Compound scaffold for the screens that stand outside a signed-in session:
 * sign-in, sign-up, the password and verification flows, and the invitation
 * screens.
 *
 * One column, left-aligned, capped at the reading measure — the same page the
 * rest of the design is, rather than a centred card floating on the paper. The
 * form sits directly on the page: no surface of its own, no shadow, and no
 * label above the heading.
 *
 * Composed rather than prop-driven so any slot can hold a `<Suspense>`
 * boundary: a heading that names the tenant streams on its own while the form
 * below it stays in the static shell.
 *
 * ```tsx
 * <AuthScreen>
 *   <AuthScreenHeader>
 *     <AuthScreenTitle>Seed Publishing</AuthScreenTitle>
 *     <AuthScreenTagline>Stories, one episode at a time</AuthScreenTagline>
 *   </AuthScreenHeader>
 *   <AuthScreenBody>{form}</AuthScreenBody>
 *   <AuthScreenFooter>{links}</AuthScreenFooter>
 * </AuthScreen>
 * ```
 */
export const AuthScreen = ({ children }: { children: ReactNode }) => (
  <main className="mx-auto grid w-full max-w-(--measure-prose) gap-8 px-6 py-10">
    {children}
  </main>
);

export const AuthScreenHeader = ({ children }: { children: ReactNode }) => (
  <header className="grid gap-2">{children}</header>
);

/**
 * The one heading the screen leads with, in the serif face both shells already
 * set a site or product name in.
 */
export const AuthScreenTitle = ({ children }: { children: ReactNode }) => (
  <h1 className="font-serif text-2xl font-semibold text-foreground">
    {children}
  </h1>
);

/**
 * A sentence under the heading: the tenant's tagline, or what the screen is
 * for.
 */
export const AuthScreenTagline = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);

export const AuthScreenBody = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-4">{children}</div>
);

/**
 * A sentence the screen states rather than asks for: what a confirmation link
 * did, or what happens next.
 */
export const AuthScreenText = ({ children }: { children: ReactNode }) => (
  <p className="text-sm leading-normal text-foreground">{children}</p>
);

/** The same sentence, when it is context rather than the answer itself. */
export const AuthScreenNote = ({ children }: { children: ReactNode }) => (
  <p className="text-sm leading-normal text-muted-foreground">{children}</p>
);

/**
 * What follows the form: the links to the neighbouring screens, each on its own
 * line and underlined in Ai like every other link.
 */
export const AuthScreenFooter = ({ children }: { children: ReactNode }) => (
  <footer className="grid gap-2 text-sm">{children}</footer>
);
