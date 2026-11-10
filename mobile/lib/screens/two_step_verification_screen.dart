import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:publira/auth/account_confirmation.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/passkey.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/auth/two_step_verification.dart';
import 'package:publira/forms/password_field.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/qr_code_image.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/links/link_scope.dart';
import 'package:publira/screens/two_step_sign_in_screen.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The signed-in reader's two-step verification, the same one the tenant's
/// site and console ask for, through `AuthService/GetMfaStatus`.
///
/// **Turn on** sets an authenticator up (`AuthService/StartMfaEnrollment`)
/// and shows the setup key, to copy into an authenticator on this device, and
/// a QR code, for one on another device; a code from it turns two-step
/// verification on (`AuthService/ConfirmMfaEnrollment`) and shows the ten
/// recovery codes this once, to copy or share. Once on, **Regenerate recovery
/// codes** replaces them for a code from the authenticator
/// (`AuthService/RegenerateMfaRecoveryCodes`), and **Turn off** takes it off
/// (`AuthService/DisableMfa`) for the password and a code, from the
/// authenticator or a recovery code. An account without a password confirms
/// the turning off with one of its passkeys or a fresh sign-in to a provider
/// linked to it instead, as it confirms a deletion.
class TwoStepVerificationScreen extends StatefulWidget {
  const TwoStepVerificationScreen({super.key});

  @override
  State<TwoStepVerificationScreen> createState() =>
      _TwoStepVerificationScreenState();
}

/// Which form the screen shows.
sealed class _Step {
  const _Step();
}

/// The state of the account, and what can be done with it.
class _Overview extends _Step {
  const _Overview();
}

/// An authenticator set up and waiting for its first code.
class _Enrolling extends _Step {
  const _Enrolling(this.enrollment);

  final MfaEnrollment enrollment;
}

/// Recovery codes just handed out, which the API never answers again.
class _RecoveryCodes extends _Step {
  const _RecoveryCodes(this.codes);

  final List<String> codes;
}

class _Regenerating extends _Step {
  const _Regenerating();
}

class _Disabling extends _Step {
  const _Disabling();
}

/// Why the last step did not go through, said above the form it was sent
/// from.
enum _Failure {
  enableFailed,
  setUpInConsole,
  regenerateFailed,
  disableFailed,
  invalidCode,
  locked,
  wrongPassword,
  unconfirmed,
  passkeyCancelled,
  passkeyFailed,
  passkeyNone,
  network,
  rateLimited,
}

class _TwoStepVerificationScreenState extends State<TwoStepVerificationScreen> {
  final _formKey = GlobalKey<FormState>();
  final _codeController = TextEditingController();
  final _passwordController = TextEditingController();

  MfaStatus? _status;

  /// How the account confirms turning two-step verification off.
  AccountConfirmation? _confirmation;
  var _loadFailed = false;
  var _started = false;

  _Step _step = const _Overview();
  var _busy = false;
  _Failure? _failure;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_started) {
      _started = true;
      unawaited(_load());
    }
  }

  @override
  void dispose() {
    _codeController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final auth = AuthScope.of(context);
    final signIn = ProviderSignInScope.maybeOf(context);
    final passkeys = PasskeyAuthenticatorScope.maybeOf(context);
    if (!auth.isSignedIn) {
      return;
    }
    if (_loadFailed) {
      setState(() {
        _loadFailed = false;
      });
    }
    try {
      final (status, confirmation) = await (
        auth.readMfaStatus(),
        AccountConfirmation.read(auth, signIn, passkeys),
      ).wait;
      if (!mounted) {
        return;
      }
      setState(() {
        _status = status;
        _confirmation = confirmation;
      });
    } on Object {
      if (!mounted) {
        return;
      }
      setState(() {
        _status = null;
        _confirmation = null;
        _loadFailed = true;
      });
    }
  }

  /// Shows [step] with empty fields and nothing said about the last one.
  void _show(_Step step) {
    setState(() {
      _step = step;
      _failure = null;
      _codeController.clear();
      _passwordController.clear();
    });
  }

  /// Runs [change] with the screen held, and returns what it answered, or
  /// `null` once [failureOf] has worded why it did not go through.
  Future<T?> _run<T>(
    Future<T> Function(AuthController auth) change,
    _Failure Function(AuthFailureKind kind) failureOf,
  ) async {
    final auth = AuthScope.of(context);
    setState(() {
      _busy = true;
      _failure = null;
    });
    _Failure? failure;
    T? result;
    try {
      result = await change(auth);
    } on _Refused catch (refused) {
      failure = refused.failure;
    } on AuthFailure catch (error) {
      failure = switch (error.kind) {
        AuthFailureKind.mfaInvalidCode => _Failure.invalidCode,
        AuthFailureKind.mfaLocked => _Failure.locked,
        AuthFailureKind.network => _Failure.network,
        AuthFailureKind.rateLimited => _Failure.rateLimited,
        final kind => failureOf(kind),
      };
    } on Exception {
      failure = failureOf(AuthFailureKind.unexpected);
    }
    if (mounted) {
      setState(() {
        _busy = false;
        _failure = failure;
      });
    }
    return failure == null ? result : null;
  }

  Future<void> _start() async {
    final enrollment = await _run(
      (auth) => auth.startMfaEnrollment(),
      (kind) => kind == AuthFailureKind.mfaSetUpInConsole
          ? _Failure.setUpInConsole
          : _Failure.enableFailed,
    );
    if (enrollment != null && mounted) {
      _show(_Enrolling(enrollment));
    }
  }

  Future<void> _confirm() async {
    if (_busy || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    final code = _codeController.text.trim();
    final codes = await _run(
      (auth) => auth.confirmMfaEnrollment(code),
      (kind) => kind == AuthFailureKind.mfaSetUpInConsole
          ? _Failure.setUpInConsole
          : _Failure.enableFailed,
    );
    if (codes == null || !mounted) {
      return;
    }
    messenger.showSnackBar(
      SnackBar(content: AutospacedText(messages.twoStepVerificationEnabled)),
    );
    _show(_RecoveryCodes(codes));
    await _load();
  }

  Future<void> _regenerate() async {
    if (_busy || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    final code = _codeController.text.trim();
    final codes = await _run(
      (auth) => auth.regenerateMfaRecoveryCodes(code),
      (_) => _Failure.regenerateFailed,
    );
    if (codes == null || !mounted) {
      return;
    }
    messenger.showSnackBar(
      SnackBar(
        content: AutospacedText(messages.twoStepVerificationRegenerated),
      ),
    );
    _show(_RecoveryCodes(codes));
    await _load();
  }

  Future<void> _disable() async {
    if (_busy || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final password = _passwordController.text;
    final code = _codeController.text.trim();
    await _turnOff(
      (auth) => auth.disableMfa(password: password, code: code),
      (kind) => kind == AuthFailureKind.invalidInput
          ? _Failure.wrongPassword
          : _Failure.disableFailed,
    );
  }

  Future<void> _disableWithProvider(
    IdentityProvider provider,
    SignInProviders providers,
  ) async {
    final signIn = ProviderSignInScope.maybeOf(context);
    if (_busy ||
        signIn == null ||
        !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final code = _codeController.text.trim();
    await _turnOff(
      (auth) async {
        final ProviderCredential credential;
        try {
          credential = await signIn.signIn(provider, providers);
        } on ProviderSignInCancelled {
          throw const _Cancelled();
        } on ProviderSignInFailure {
          throw const _Refused(_Failure.unconfirmed);
        }
        await auth.disableMfaWithProvider(credential, code: code);
      },
      (kind) => kind == AuthFailureKind.invalidInput
          ? _Failure.unconfirmed
          : _Failure.disableFailed,
    );
  }

  /// Confirms with whichever of the reader's passkeys they pick in the
  /// system's sheet.
  Future<void> _disableWithPasskey() async {
    final passkeys = PasskeyAuthenticatorScope.maybeOf(context);
    if (_busy ||
        passkeys == null ||
        !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final code = _codeController.text.trim();
    await _turnOff(
      (auth) async {
        try {
          await auth.disableMfaWithPasskey(passkeys, code: code);
        } on PasskeyCancelled {
          throw const _Refused(_Failure.passkeyCancelled);
        } on PasskeyFailure {
          throw const _Refused(_Failure.passkeyFailed);
        }
      },
      (kind) => switch (kind) {
        AuthFailureKind.passkeyNotFound => _Failure.passkeyNone,
        AuthFailureKind.passkeyRefused => _Failure.passkeyFailed,
        _ => _Failure.disableFailed,
      },
    );
  }

  Future<void> _turnOff(
    Future<void> Function(AuthController auth) disable,
    _Failure Function(AuthFailureKind kind) failureOf,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    var cancelled = false;
    final done = await _run((auth) async {
      try {
        await disable(auth);
      } on _Cancelled {
        // The reader closed the provider's sheet, which needs no word.
        cancelled = true;
      }
      return true;
    }, failureOf);
    if (done == null || cancelled || !mounted) {
      return;
    }
    messenger.showSnackBar(
      SnackBar(content: AutospacedText(messages.twoStepVerificationDisabled)),
    );
    _show(const _Overview());
    await _load();
  }

  Future<void> _copy(String text, String copied) async {
    final messenger = ScaffoldMessenger.of(context);
    await Clipboard.setData(ClipboardData(text: text));
    messenger.showSnackBar(SnackBar(content: AutospacedText(copied)));
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final signedIn = AuthScope.of(context).isSignedIn;
    return Scaffold(
      appBar: AppBar(title: AutospacedText(messages.twoStepVerificationTitle)),
      body: SafeArea(
        child: !signedIn
            ? const SignedOutNotice()
            : SingleChildScrollView(
                key: const ValueKey('two-step-verification-body'),
                padding: const EdgeInsets.all(24),
                child: ReadableWidth(child: _body(messages)),
              ),
      ),
    );
  }

  Widget _body(AppMessages messages) {
    final status = _status;
    final confirmation = _confirmation;
    if (status == null || confirmation == null) {
      if (!_loadFailed) {
        return const Center(child: CircularProgressIndicator());
      }
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AutospacedText(
            messages.twoStepVerificationLoadFailed,
            key: const ValueKey('two-step-verification-load-error'),
          ),
          const SizedBox(height: 16),
          OutlinedButton(
            key: const ValueKey('two-step-verification-retry'),
            onPressed: () => unawaited(_load()),
            child: AutospacedText(messages.commonRetry),
          ),
        ],
      );
    }
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: switch (_step) {
          _Overview() => _overview(messages, status),
          _Enrolling(:final enrollment) => _enrolling(messages, enrollment),
          _RecoveryCodes(:final codes) => _recoveryCodes(messages, codes),
          _Regenerating() => _regenerating(messages),
          _Disabling() => _disabling(messages, confirmation),
        },
      ),
    );
  }

  List<Widget> _overview(AppMessages messages, MfaStatus status) {
    return [
      AutospacedText(messages.twoStepVerificationDescription),
      const SizedBox(height: 16),
      AutospacedText(
        switch (status) {
          MfaStatus(enabled: true, :final enabledAt?) =>
            messages.twoStepVerificationStatusEnabled(
              date: messages.formatDate(enabledAt),
            ),
          // An enabled account the API sent no date for is still on.
          MfaStatus(enabled: true) => messages.twoStepVerificationEnabled,
          MfaStatus() => messages.twoStepVerificationStatusDisabled,
        },
        key: const ValueKey('two-step-verification-status'),
        style: Theme.of(context).textTheme.titleMedium,
      ),
      if (status.enabled) ...[
        const SizedBox(height: 8),
        AutospacedText(
          messages.twoStepVerificationRemainingRecoveryCodes(
            count: status.remainingRecoveryCodes,
          ),
          key: const ValueKey('two-step-verification-remaining'),
        ),
      ],
      ..._failureNotice(messages),
      const SizedBox(height: 24),
      if (!status.enabled)
        FilledButton(
          key: const ValueKey('two-step-verification-enable'),
          onPressed: _busy ? null : () => unawaited(_start()),
          child: _busy
              ? const _Progress()
              : AutospacedText(messages.twoStepVerificationEnable),
        )
      else ...[
        OutlinedButton(
          key: const ValueKey('two-step-verification-regenerate'),
          onPressed: _busy ? null : () => _show(const _Regenerating()),
          child: AutospacedText(messages.twoStepVerificationRegenerate),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          key: const ValueKey('two-step-verification-disable'),
          onPressed: _busy ? null : () => _show(const _Disabling()),
          child: AutospacedText(messages.twoStepVerificationDisable),
        ),
      ],
    ];
  }

  List<Widget> _enrolling(AppMessages messages, MfaEnrollment enrollment) {
    final theme = Theme.of(context);
    return [
      AutospacedText(messages.twoStepVerificationSetupDescription),
      const SizedBox(height: 24),
      Center(
        child: QrCodeImage(
          key: const ValueKey('two-step-verification-qr'),
          data: enrollment.otpauthUri,
          semanticLabel: messages.twoStepVerificationQrLabel,
        ),
      ),
      const SizedBox(height: 24),
      AutospacedText(
        messages.twoStepVerificationSecretLabel,
        style: theme.textTheme.labelLarge,
      ),
      const SizedBox(height: 4),
      SelectionArea(
        child: AutospacedText(
          enrollment.secret,
          key: const ValueKey('two-step-verification-secret'),
          style: theme.textTheme.bodyLarge?.copyWith(
            fontFamily: 'monospace',
            letterSpacing: 1,
          ),
        ),
      ),
      const SizedBox(height: 8),
      OutlinedButton.icon(
        key: const ValueKey('two-step-verification-secret-copy'),
        icon: const Icon(Icons.copy),
        onPressed: () => unawaited(
          _copy(enrollment.secret, messages.twoStepVerificationSecretCopied),
        ),
        label: AutospacedText(messages.twoStepVerificationSecretCopy),
      ),
      const SizedBox(height: 24),
      ..._failureNotice(messages, bottom: 16),
      TwoStepCodeField(
        key: const ValueKey('two-step-verification-code'),
        controller: _codeController,
        label: messages.twoStepCodeLabel,
        help: messages.twoStepVerificationCodeHelp,
        authenticatorOnly: true,
        onSubmitted: () => unawaited(_confirm()),
      ),
      const SizedBox(height: 24),
      FilledButton(
        key: const ValueKey('two-step-verification-confirm'),
        onPressed: _busy ? null : () => unawaited(_confirm()),
        child: _busy
            ? const _Progress()
            : AutospacedText(messages.twoStepVerificationConfirm),
      ),
      const SizedBox(height: 8),
      _cancel(messages),
    ];
  }

  List<Widget> _recoveryCodes(AppMessages messages, List<String> codes) {
    final theme = Theme.of(context);
    final share = LinkScope.maybeOf(context)?.share;
    final text = codes.join('\n');
    return [
      AutospacedText(
        messages.twoStepVerificationRecoveryCodesTitle,
        style: theme.textTheme.titleMedium,
      ),
      const SizedBox(height: 8),
      AutospacedText(messages.twoStepVerificationRecoveryCodesDescription),
      const SizedBox(height: 16),
      DecoratedBox(
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: SelectionArea(
            child: AutospacedText(
              text,
              key: const ValueKey('two-step-verification-recovery-codes'),
              style: theme.textTheme.bodyLarge?.copyWith(
                fontFamily: 'monospace',
                height: 1.6,
              ),
            ),
          ),
        ),
      ),
      const SizedBox(height: 16),
      OutlinedButton.icon(
        key: const ValueKey('two-step-verification-recovery-codes-copy'),
        icon: const Icon(Icons.copy),
        onPressed: () => unawaited(
          _copy(text, messages.twoStepVerificationRecoveryCodesCopied),
        ),
        label: AutospacedText(messages.twoStepVerificationRecoveryCodesCopy),
      ),
      if (share != null) ...[
        const SizedBox(height: 8),
        OutlinedButton.icon(
          key: const ValueKey('two-step-verification-recovery-codes-share'),
          icon: const Icon(Icons.share_outlined),
          onPressed: () => unawaited(
            share.shareText(
              text: text,
              title: messages.twoStepVerificationRecoveryCodesTitle,
            ),
          ),
          label: AutospacedText(messages.twoStepVerificationRecoveryCodesShare),
        ),
      ],
      const SizedBox(height: 24),
      FilledButton(
        key: const ValueKey('two-step-verification-done'),
        onPressed: () => _show(const _Overview()),
        child: AutospacedText(messages.twoStepVerificationDone),
      ),
    ];
  }

  List<Widget> _regenerating(AppMessages messages) {
    return [
      AutospacedText(
        messages.twoStepVerificationRecoveryCodesTitle,
        style: Theme.of(context).textTheme.titleMedium,
      ),
      const SizedBox(height: 8),
      AutospacedText(messages.twoStepVerificationRegenerateDescription),
      const SizedBox(height: 24),
      ..._failureNotice(messages, bottom: 16),
      TwoStepCodeField(
        key: const ValueKey('two-step-verification-code'),
        controller: _codeController,
        label: messages.twoStepCodeLabel,
        help: messages.twoStepVerificationCodeHelp,
        authenticatorOnly: true,
        autofocus: true,
        onSubmitted: () => unawaited(_regenerate()),
      ),
      const SizedBox(height: 24),
      FilledButton(
        key: const ValueKey('two-step-verification-regenerate-submit'),
        onPressed: _busy ? null : () => unawaited(_regenerate()),
        child: _busy
            ? const _Progress()
            : AutospacedText(messages.twoStepVerificationRegenerate),
      ),
      const SizedBox(height: 8),
      _cancel(messages),
    ];
  }

  List<Widget> _disabling(
    AppMessages messages,
    AccountConfirmation confirmation,
  ) {
    final colors = Theme.of(context).colorScheme;
    final confirmStyle = FilledButton.styleFrom(
      backgroundColor: colors.error,
      foregroundColor: colors.onError,
    );
    final codeField = TwoStepCodeField(
      key: const ValueKey('two-step-verification-code'),
      controller: _codeController,
      label: messages.twoStepCodeLabel,
      help: messages.twoStepVerificationCodeOrRecoveryHelp,
      authenticatorOnly: false,
    );
    return [
      AutospacedText(
        messages.twoStepVerificationDisableHeading,
        style: Theme.of(context).textTheme.titleMedium,
      ),
      const SizedBox(height: 8),
      AutospacedText(messages.twoStepVerificationDisableDescription),
      const SizedBox(height: 24),
      ..._failureNotice(messages, bottom: 16),
      ...switch (confirmation) {
        AccountConfirmation(providers: null) => [
          PasswordField(
            key: const ValueKey('two-step-verification-password'),
            controller: _passwordController,
            label: messages.twoStepVerificationPasswordLabel,
            autofillHints: const [AutofillHints.password],
            textInputAction: TextInputAction.next,
            validator: (value) =>
                (value ?? '').isEmpty ? messages.authPasswordRequired : null,
          ),
          const SizedBox(height: 16),
          codeField,
          const SizedBox(height: 24),
          FilledButton(
            key: const ValueKey('two-step-verification-disable-submit'),
            style: confirmStyle,
            onPressed: _busy ? null : () => unawaited(_disable()),
            child: _busy
                ? const _Progress()
                : AutospacedText(messages.twoStepVerificationDisable),
          ),
        ],
        AccountConfirmation(:final providers?, :final linked, :final passkey)
            when passkey || linked.isNotEmpty =>
          [
            codeField,
            if (passkey) ...[
              const SizedBox(height: 24),
              FilledButton(
                key: const ValueKey('two-step-verification-disable-passkey'),
                style: confirmStyle,
                onPressed: _busy
                    ? null
                    : () => unawaited(_disableWithPasskey()),
                child: AutospacedText(
                  messages.twoStepVerificationDisableWithPasskey,
                ),
              ),
            ],
            for (final provider in linked) ...[
              const SizedBox(height: 16),
              FilledButton(
                key: ValueKey('two-step-verification-disable-${provider.name}'),
                style: confirmStyle,
                onPressed: _busy
                    ? null
                    : () =>
                          unawaited(_disableWithProvider(provider, providers)),
                child: AutospacedText(switch (provider) {
                  IdentityProvider.apple =>
                    messages.twoStepVerificationDisableWithApple,
                  IdentityProvider.google =>
                    messages.twoStepVerificationDisableWithGoogle,
                }),
              ),
            ],
          ],
        AccountConfirmation() => [
          AutospacedText(
            messages.twoStepVerificationDisableNoConfirmation,
            key: const ValueKey('two-step-verification-disable-unavailable'),
          ),
        ],
      },
      const SizedBox(height: 8),
      _cancel(messages),
    ];
  }

  Widget _cancel(AppMessages messages) => TextButton(
    key: const ValueKey('two-step-verification-cancel'),
    onPressed: _busy ? null : () => _show(const _Overview()),
    child: AutospacedText(messages.commonCancel),
  );

  List<Widget> _failureNotice(AppMessages messages, {double bottom = 0}) {
    final failure = _failure;
    if (failure == null) {
      return const [];
    }
    return [
      if (bottom == 0) const SizedBox(height: 16),
      AutospacedText(
        _failureCopy(messages, failure),
        key: const ValueKey('two-step-verification-error'),
        style: TextStyle(color: Theme.of(context).colorScheme.error),
      ),
      if (bottom > 0) SizedBox(height: bottom),
    ];
  }

  String _failureCopy(AppMessages messages, _Failure failure) {
    return switch (failure) {
      _Failure.enableFailed => messages.twoStepVerificationEnableFailed,
      _Failure.setUpInConsole => messages.twoStepVerificationSetUpInConsole,
      _Failure.regenerateFailed => messages.twoStepVerificationRegenerateFailed,
      _Failure.disableFailed => messages.twoStepVerificationDisableFailed,
      // Only turning off takes a recovery code; every other form asks for
      // the authenticator's.
      _Failure.invalidCode =>
        _step is _Disabling
            ? messages.twoStepInvalidCodeOrRecoveryCode
            : messages.twoStepInvalidCode,
      _Failure.locked => messages.twoStepLocked,
      _Failure.wrongPassword => messages.twoStepVerificationWrongPassword,
      _Failure.unconfirmed => messages.twoStepVerificationDisableUnconfirmed,
      _Failure.passkeyCancelled => messages.passkeysConfirmCancelled,
      _Failure.passkeyFailed => messages.passkeysConfirmFailed,
      _Failure.passkeyNone => messages.passkeysConfirmNone,
      _Failure.network => messages.errorsRpcUnavailable,
      _Failure.rateLimited => messages.errorsRpcRateLimited,
    };
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

/// The reader closed the provider's sheet, which leaves the form as it was.
class _Cancelled implements Exception {
  const _Cancelled();
}

/// A confirmation that did not go through, for the reason [failure] names.
class _Refused implements Exception {
  const _Refused(this.failure);

  final _Failure failure;
}
