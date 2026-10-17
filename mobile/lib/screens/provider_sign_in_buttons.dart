import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/passkey.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/screens/sign_in_screen.dart';
import 'package:publira/typography/autospaced_text.dart';

/// A button per provider the tenant enables and this device offers, under the
/// sign-in form, then one that signs in with a passkey where the device uses
/// the site's, and nothing where there is none of either.
///
/// A first sign-in that would create an account the tenant asks consent for
/// continues on [AppRoutes.continueSignUp], which is handed the token.
class ProviderSignInButtons extends StatefulWidget {
  const ProviderSignInButtons({super.key, this.returnTo});

  /// Where the reader lands once signed in, as for the form above.
  final String? returnTo;

  @override
  State<ProviderSignInButtons> createState() => _ProviderSignInButtonsState();
}

class _ProviderSignInButtonsState extends State<ProviderSignInButtons> {
  ProviderSignIn? _signIn;
  PasskeyAuthenticator? _passkeys;
  var _providers = SignInProviders.none;
  var _offered = const <IdentityProvider>[];
  var _passkeyOffered = false;

  /// The provider whose sign-in is in flight, `null` while none is.
  IdentityProvider? _running;

  /// Whether a passkey sign-in is in flight.
  var _runningPasskey = false;

  /// Why the last attempt failed, `null` while none has.
  _Failure? _failure;

  bool get _busy => _running != null || _runningPasskey;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final signIn = ProviderSignInScope.maybeOf(context);
    final passkeys = PasskeyAuthenticatorScope.maybeOf(context);
    if (signIn == _signIn && passkeys == _passkeys) {
      return;
    }
    _signIn = signIn;
    _passkeys = passkeys;
    if (signIn != null || passkeys != null) {
      unawaited(_load(signIn, passkeys));
    }
  }

  /// A tenant read that fails offers no button; the form above still works.
  /// The providers and the passkey are asked about apart, so a device that
  /// cannot answer for one still offers the other.
  Future<void> _load(
    ProviderSignIn? signIn,
    PasskeyAuthenticator? passkeys,
  ) async {
    final SignInProviders providers;
    try {
      providers = await AuthScope.of(context).readSignInProviders();
    } on Exception {
      return;
    }
    var offered = const <IdentityProvider>[];
    var passkeyOffered = false;
    try {
      offered = await signIn?.offered(providers) ?? const [];
    } on Exception {
      // No provider button; the passkey may still be offered.
    }
    try {
      passkeyOffered = await passkeys?.offered(providers) ?? false;
    } on Exception {
      // No passkey button; the providers may still be offered.
    }
    if (!mounted || signIn != _signIn || passkeys != _passkeys) {
      return;
    }
    setState(() {
      _providers = providers;
      _offered = offered;
      _passkeyOffered = passkeyOffered;
    });
  }

  Future<void> _start(IdentityProvider provider) async {
    final signIn = _signIn;
    if (signIn == null || _busy) {
      return;
    }
    final auth = AuthScope.of(context);
    setState(() {
      _running = provider;
      _failure = null;
    });
    _Failure? failure;
    var signedIn = false;
    try {
      final credential = await signIn.signIn(provider, _providers);
      try {
        await auth.signInWithProvider(credential);
        signedIn = true;
      } on AuthFailure catch (error) {
        if (error.kind == AuthFailureKind.consentRequired) {
          if (mounted) {
            context.pushReplacementInTab(
              AppRoutes.continueSignUpPath(returnTo: widget.returnTo),
              extra: credential,
            );
          }
          return;
        }
        failure = switch (error.kind) {
          AuthFailureKind.providerRefused => _Failure.refused,
          AuthFailureKind.network => _Failure.network,
          _ => _Failure.failed,
        };
      }
    } on ProviderSignInCancelled {
      // The reader closed the provider's sheet, which needs no word.
    } on ProviderSignInFailure {
      failure = _Failure.unavailable;
    } on Exception {
      failure = _Failure.failed;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _running = null;
      _failure = failure;
    });
    if (signedIn) {
      leaveSignIn(context, widget.returnTo);
    }
  }

  /// Signs in with whichever passkey the reader picks in the system's sheet.
  /// A closed sheet is told apart from a refusal, because the system answers
  /// one that timed out the same way and the reader may not have closed it.
  Future<void> _startPasskey() async {
    final passkeys = _passkeys;
    if (passkeys == null || _busy) {
      return;
    }
    final auth = AuthScope.of(context);
    setState(() {
      _runningPasskey = true;
      _failure = null;
    });
    _Failure? failure;
    try {
      await auth.signInWithPasskey(passkeys);
    } on PasskeyCancelled {
      failure = _Failure.passkeyCancelled;
    } on AuthFailure catch (error) {
      failure = switch (error.kind) {
        AuthFailureKind.emailNotVerified => _Failure.emailNotVerified,
        AuthFailureKind.network => _Failure.network,
        AuthFailureKind.rateLimited => _Failure.rateLimited,
        _ => _Failure.passkeyFailed,
      };
    } on Exception {
      failure = _Failure.passkeyFailed;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _runningPasskey = false;
      _failure = failure;
    });
    if (failure == null) {
      leaveSignIn(context, widget.returnTo);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_offered.isEmpty && !_passkeyOffered) {
      return const SizedBox.shrink();
    }
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    final failure = _failure;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 24),
        AutospacedText(
          messages.signInDivider,
          textAlign: TextAlign.center,
          style: theme.textTheme.bodySmall,
        ),
        if (failure != null) ...[
          const SizedBox(height: 8),
          AutospacedText(
            switch (failure) {
              _Failure.refused => messages.signInProviderRefused,
              _Failure.unavailable => messages.signInProviderUnavailable,
              _Failure.network => messages.errorsRpcUnavailable,
              _Failure.rateLimited => messages.errorsRpcRateLimited,
              _Failure.failed => messages.signInProviderFailed,
              _Failure.emailNotVerified => messages.signInEmailNotVerified,
              _Failure.passkeyCancelled => messages.signInPasskeyCancelled,
              _Failure.passkeyFailed => messages.signInPasskeyFailed,
            },
            key: const ValueKey('provider-sign-in-error'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        ],
        for (final provider in _offered) ...[
          const SizedBox(height: 8),
          OutlinedButton(
            key: ValueKey('sign-in-with-${provider.name}'),
            onPressed: _busy ? null : () => unawaited(_start(provider)),
            child: _running == provider
                ? const _Progress()
                : AutospacedText(switch (provider) {
                    IdentityProvider.apple => messages.signInContinueWithApple,
                    IdentityProvider.google =>
                      messages.signInContinueWithGoogle,
                  }),
          ),
        ],
        if (_passkeyOffered) ...[
          const SizedBox(height: 8),
          OutlinedButton(
            key: const ValueKey('sign-in-with-passkey'),
            onPressed: _busy ? null : () => unawaited(_startPasskey()),
            child: _runningPasskey
                ? const _Progress()
                : AutospacedText(messages.signInWithPasskey),
          ),
        ],
      ],
    );
  }
}

class _Progress extends StatelessWidget {
  const _Progress();

  @override
  Widget build(BuildContext context) => const SizedBox.square(
    dimension: 20,
    child: CircularProgressIndicator(strokeWidth: 2),
  );
}

enum _Failure {
  failed,
  refused,
  unavailable,
  network,
  rateLimited,
  emailNotVerified,
  passkeyCancelled,
  passkeyFailed,
}
