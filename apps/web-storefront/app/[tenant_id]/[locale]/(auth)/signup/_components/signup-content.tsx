import * as AuthScreen from "@publira/layouts/auth-screen";

import { SignUpClosedNotice } from "#components/sign-up-closed-notice";
import { getTenantSignUp } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { SignupFooter, SignupForm } from "./signup-form";

/**
 * The form, or in its place the tenant's notice while sign-up is closed. A
 * form the API would refuse every submission of is not offered at all.
 */
export const SignupContent = async () => {
  const signUp = await getTenantSignUp(await getTenantId());
  if (signUp.open) {
    return <SignupForm />;
  }

  return (
    <>
      <AuthScreen.Body>
        <SignUpClosedNotice message={signUp.message} />
      </AuthScreen.Body>
      <SignupFooter />
    </>
  );
};
