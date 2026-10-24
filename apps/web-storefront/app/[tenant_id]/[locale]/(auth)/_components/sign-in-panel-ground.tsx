/**
 * The panel of a tenant that has uploaded no sign-in image, painted from its
 * theme colours (`sign-in-panel-ground` in `globals.css`).
 *
 * Decoration with nothing to read, so it is hidden from assistive technology.
 */
export const SignInPanelGround = () => (
  <div aria-hidden="true" className="size-full sign-in-panel-ground" />
);
