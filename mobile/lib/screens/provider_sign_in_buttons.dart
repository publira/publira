import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/screens/sign_in_screen.dart';
import 'package:publira/typography/autospaced_text.dart';

/// A button per provider the tenant enables and this device offers, under the
/// sign-in form, and nothing where there is none.
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
  var _providers = SignInProviders.none;
  var _offered = const <IdentityProvider>[];

  /// The provider whose sign-in is in flight, `null` while none is.
  IdentityProvider? _running;

  /// Why the last attempt failed, `null` while none has.
  _Failure? _failure;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final signIn = ProviderSignInScope.maybeOf(context);
    if (signIn == _signIn) {
      return;
    }
    _signIn = signIn;
    if (signIn != null) {
      unawaited(_load(signIn));
    }
  }

  /// A tenant read that fails offers no button; the form above still works.
  Future<void> _load(ProviderSignIn signIn) async {
    final SignInProviders providers;
    final List<IdentityProvider> offered;
    try {
      providers = await AuthScope.of(context).readSignInProviders();
      offered = await signIn.offered(providers);
    } on Exception {
      return;
    }
    if (!mounted || signIn != _signIn) {
      return;
    }
    setState(() {
      _providers = providers;
      _offered = offered;
    });
  }

  Future<void> _start(IdentityProvider provider) async {
    final signIn = _signIn;
    if (signIn == null || _running != null) {
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

  @override
  Widget build(BuildContext context) {
    if (_offered.isEmpty) {
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
              _Failure.failed => messages.signInProviderFailed,
            },
            key: const ValueKey('provider-sign-in-error'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        ],
        for (final provider in _offered) ...[
          const SizedBox(height: 8),
          OutlinedButton(
            key: ValueKey('sign-in-with-${provider.name}'),
            onPressed: _running == null
                ? () => unawaited(_start(provider))
                : null,
            child: _running == provider
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : AutospacedText(switch (provider) {
                    IdentityProvider.apple => messages.signInContinueWithApple,
                    IdentityProvider.google =>
                      messages.signInContinueWithGoogle,
                  }),
          ),
        ],
      ],
    );
  }
}

enum _Failure { failed, refused, unavailable, network }
