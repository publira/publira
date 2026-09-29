import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/auth/sign_up_requirements.dart';
import 'package:publira/forms/sign_up_fields.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/screens/sign_in_screen.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Where a first sign-in with Apple or Google asks the consent the tenant
/// requires, and the birth date where it checks ages, before the account is
/// created.
///
/// The API left the token unspent when it asked, so the same [credential] is
/// sent again with the answers.
class ContinueSignUpScreen extends StatefulWidget {
  const ContinueSignUpScreen({super.key, this.credential, this.returnTo});

  /// The token the provider issued, `null` when the screen was reached
  /// without one, which only a fresh sign-in can replace.
  final ProviderCredential? credential;

  /// Where the reader lands once the account is created.
  final String? returnTo;

  @override
  State<ContinueSignUpScreen> createState() => _ContinueSignUpScreenState();
}

class _ContinueSignUpScreenState extends State<ContinueSignUpScreen> {
  final _formKey = GlobalKey<FormState>();

  /// The locale the requirements were last read in.
  Locale? _locale;
  SignUpRequirements? _requirements;
  DateTime? _birthDate;
  var _submitting = false;
  var _legalPagesChanged = false;
  AuthFailureKind? _failure;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final locale = Localizations.localeOf(context);
    if (locale == _locale) {
      return;
    }
    _locale = locale;
    unawaited(_readRequirements());
  }

  Future<void> _readRequirements() async {
    final locale = Localizations.localeOf(context);
    final SignUpRequirements requirements;
    try {
      requirements = await AuthScope.of(
        context,
      ).readSignUpRequirements(locale: locale.toLanguageTag());
    } on Exception {
      return;
    }
    if (!mounted || locale != _locale) {
      return;
    }
    setState(() {
      _requirements = requirements;
    });
  }

  Future<void> _submit(ProviderCredential credential) async {
    if (_submitting || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final auth = AuthScope.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final birthDate = _birthDate;
    final shown = _requirements;
    setState(() {
      _submitting = true;
      _failure = null;
      _legalPagesChanged = false;
    });
    AuthFailureKind? failure;
    try {
      // Read again, as the sign-up form does, so a page republished since
      // the screen was read is agreed to anew.
      final current = await auth.readSignUpRequirements(locale: locale);
      if (shown == null || !current.asksSameConsentAs(shown)) {
        if (!mounted) {
          return;
        }
        setState(() {
          _submitting = false;
          _requirements = current;
          _legalPagesChanged = shown != null;
        });
        return;
      }
      await auth.signInWithProvider(
        credential,
        birthDate: birthDate == null ? '' : formatBirthDate(birthDate),
        agreedPageVersionIds: [
          for (final page in current.legalPages) page.versionId,
        ],
      );
    } on AuthFailure catch (error) {
      failure = error.kind;
    } on Exception {
      failure = AuthFailureKind.unexpected;
    }
    if (!mounted) {
      return;
    }
    if (failure == null) {
      leaveSignIn(context, widget.returnTo);
      return;
    }
    setState(() {
      _submitting = false;
      _failure = failure;
    });
    if (failure == AuthFailureKind.consentRequired) {
      // The pages changed between the read above and the API's own.
      unawaited(_readRequirements());
    }
  }

  Future<void> _pickBirthDate() async {
    final picked = await pickBirthDate(context);
    if (picked == null || !mounted) {
      return;
    }
    setState(() {
      _birthDate = picked;
    });
  }

  void _startAgain() {
    context.pushReplacementInTab(
      AppRoutes.signInPath(returnTo: widget.returnTo),
    );
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final credential = widget.credential;
    return Scaffold(
      appBar: AppBar(title: AutospacedText(messages.continueSignUpTitle)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: credential == null
              ? _buildExpired(messages)
              : _buildForm(messages, credential),
        ),
      ),
    );
  }

  Widget _buildExpired(AppMessages messages) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AutospacedText(
          messages.continueSignUpExpired,
          key: const ValueKey('continue-sign-up-expired'),
        ),
        const SizedBox(height: 24),
        FilledButton(
          key: const ValueKey('continue-sign-up-start-again'),
          onPressed: _startAgain,
          child: AutospacedText(messages.commonSignIn),
        ),
      ],
    );
  }

  Widget _buildForm(AppMessages messages, ProviderCredential credential) {
    final failure = _failure;
    final requirements = _requirements;
    final error = Theme.of(context).colorScheme.error;
    // A token the API no longer takes is spent; only a fresh sign-in helps.
    final spent =
        failure != null &&
        failure != AuthFailureKind.network &&
        failure != AuthFailureKind.rateLimited &&
        failure != AuthFailureKind.birthDateInvalid &&
        failure != AuthFailureKind.consentRequired;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AutospacedText(messages.continueSignUpDescription),
          if (failure != null) ...[
            const SizedBox(height: 16),
            AutospacedText(
              switch (failure) {
                AuthFailureKind.network => messages.errorsRpcUnavailable,
                AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
                AuthFailureKind.birthDateInvalid =>
                  messages.accountBirthDateInvalid,
                AuthFailureKind.consentRequired =>
                  messages.signUpConsentChanged,
                AuthFailureKind.providerRefused =>
                  messages.signInProviderRefused,
                _ => messages.continueSignUpExpired,
              },
              key: const ValueKey('continue-sign-up-error'),
              style: TextStyle(color: error),
            ),
          ] else if (_legalPagesChanged) ...[
            const SizedBox(height: 16),
            AutospacedText(
              messages.signUpConsentChanged,
              key: const ValueKey('sign-up-consent-changed'),
              style: TextStyle(color: error),
            ),
          ],
          if (requirements?.ageVerification == AgeVerification.checked)
            BirthDateField(
              date: _birthDate,
              onPick: () => unawaited(_pickBirthDate()),
              onClear: () => setState(() => _birthDate = null),
            ),
          if (requirements?.legalPages case final pages? when pages.isNotEmpty)
            ConsentField(
              key: ValueKey(pages.map((page) => page.versionId).join(',')),
              pages: pages,
            ),
          const SizedBox(height: 24),
          if (spent)
            FilledButton(
              key: const ValueKey('continue-sign-up-start-again'),
              onPressed: _startAgain,
              child: AutospacedText(messages.commonSignIn),
            )
          else
            FilledButton(
              key: const ValueKey('continue-sign-up-submit'),
              onPressed: _submitting
                  ? null
                  : () => unawaited(_submit(credential)),
              child: _submitting
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : AutospacedText(messages.continueSignUpSubmit),
            ),
        ],
      ),
    );
  }
}
