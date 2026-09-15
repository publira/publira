import type { ReactNode } from "react";

/**
 * Compound scaffold for the screens that stand outside a signed-in session:
 * sign-in, sign-up, the password and verification flows, and the invitation
 * screens.
 *
 * Two halves from `lg` up: the form in one, whatever the app puts in
 * `AuthScreenPanel` in the other. A screen that supplies no panel is the
 * single centred column this was before it had halves, because the form
 * column takes whatever width the panel leaves.
 *
 * The form sits directly on the page: no surface of its own, no shadow, and no
 * label above the heading.
 *
 * Composed rather than prop-driven so any slot can hold a `<Suspense>`
 * boundary: a heading that names the tenant streams on its own while the form
 * below it stays in the static shell.
 *
 * ```tsx
 * <AuthScreen>
 *   <AuthScreenMain>
 *     <AuthScreenHeader>
 *       <AuthScreenTitle>Seed Publishing</AuthScreenTitle>
 *       <AuthScreenTagline>Stories, one episode at a time</AuthScreenTagline>
 *     </AuthScreenHeader>
 *     <AuthScreenBody>{form}</AuthScreenBody>
 *     <AuthScreenFooter>{links}</AuthScreenFooter>
 *   </AuthScreenMain>
 *   <AuthScreenPanel>
 *     <AuthScreenPattern />
 *   </AuthScreenPanel>
 * </AuthScreen>
 * ```
 */
export const AuthScreen = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-full">{children}</div>
);

/**
 * The half the form is read in, capped at the reading measure and left-aligned
 * inside it — the same page the rest of the design is, rather than a centred
 * card floating on the paper.
 *
 * `content-start` is what keeps the heading at the top of a column that the
 * panel beside it has stretched to the height of the window.
 */
export const AuthScreenMain = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-1 justify-center">
    <main className="grid w-full max-w-(--measure-prose) content-start gap-8 px-6 py-10">
      {children}
    </main>
  </div>
);

/**
 * The other half: a tenant's image on the public site, the fixed geometry of
 * {@link AuthScreenPattern} in a console.
 *
 * It gives way below `lg`, where half a phone screen is neither a picture nor
 * room to type in, and the form keeps the width. Where it does appear it is as
 * tall as the window and stays there while a long form scrolls past it.
 */
export const AuthScreenPanel = ({ children }: { children: ReactNode }) => (
  <div className="hidden h-dvh flex-1 bg-surface lg:sticky lg:top-0 lg:block">
    {children}
  </div>
);

/**
 * Paper ruled into even squares, in a hairline mixed down from the one the
 * rest of the design separates sections with.
 *
 * What the consoles fill their panel with. They are staff screens, so there is
 * no tenant behind them whose image this could be, and geometry that is the
 * same on every visit is the honest answer to that rather than a picture
 * chosen to stand in for one.
 *
 * Decoration with nothing to read, so it is hidden from assistive technology.
 */
export const AuthScreenPattern = () => (
  <div aria-hidden="true" className="size-full auth-screen-pattern" />
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
