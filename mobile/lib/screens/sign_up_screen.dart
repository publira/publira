import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/auth/sign_up_requirements.dart';
import 'package:publira/forms/email_input.dart';
import 'package:publira/forms/name_input.dart';
import 'package:publira/forms/password_input.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

/// Creating a reader account through `AuthService/CreateUser`, and what
/// follows it until the address is confirmed.
///
/// The API answers an accepted sign-up by mailing a confirmation link, and
/// says nothing about whether the address already had an account, so this
/// screen ends the same way either way: it names the address it wrote to and
/// offers to write again. The link itself is opened from the mailbox, and the
/// app takes it at [AppRoutes.verifyEmail].
class SignUpScreen extends StatefulWidget {
  const SignUpScreen({super.key});

  /// The oldest birth date the picker offers, matching
  /// `oldestPlausibleAge` in `server/internal/ageverification`.
  static const oldestPlausibleAge = 130;

  @override
  State<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends State<SignUpScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();

  var _started = false;
  var _submitting = false;

  /// What the tenant asks of a sign-up — a birth date where it checks ages,
  /// and consent to the pages it names — `null` until `GetTenant` has
  /// answered, and for good when it could not.
  SignUpRequirements? _requirements;

  /// The date the reader picked, `null` while they have picked none. The
  /// field is optional wherever it is offered: an account without a date can
  /// still be created, and the date given later on the account screen.
  DateTime? _birthDate;

  /// Why the last attempt failed, rendered in the current locale on each
  /// build rather than as the copy of the locale it failed under.
  AuthFailureKind? _failure;

  /// The address the sign-up was accepted for, `null` until it has been.
  /// Holding it is what lets the pending state ask for another mail without
  /// making the reader type the address again.
  String? _pendingEmail;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    unawaited(_readRequirements());
  }

  /// A read that fails leaves the form as a tenant that asks nothing gets it:
  /// the API still refuses a sign-up without the consent it requires.
  Future<void> _readRequirements() async {
    final SignUpRequirements requirements;
    try {
      requirements = await AuthScope.of(context).readSignUpRequirements();
    } on Exception {
      return;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _requirements = requirements;
    });
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final auth = AuthScope.of(context);
    final email = _emailController.text.trim();
    final birthDate = _birthDate;
    // Validation has already held the form back without the consent, so the
    // pages on screen are the ones agreed to.
    final agreedPageVersionIds = [
      for (final page in _requirements?.legalPages ?? const <LegalPage>[])
        page.versionId,
    ];
    setState(() {
      _submitting = true;
      _failure = null;
    });
    AuthFailureKind? failure;
    try {
      await auth.signUp(
        name: _nameController.text.trim(),
        email: email,
        password: _passwordController.text,
        birthDate: birthDate == null ? '' : formatBirthDate(birthDate),
        agreedPageVersionIds: agreedPageVersionIds,
      );
    } on AuthFailure catch (error) {
      failure = error.kind;
    } on Exception {
      failure = AuthFailureKind.unexpected;
    }
    if (!mounted) {
      return;
    }
    // A refusal leaves every field as the reader wrote it, so a retry is one
    // correction rather than the whole form again.
    setState(() {
      _submitting = false;
      _failure = failure;
      _pendingEmail = failure == null ? email : null;
    });
  }

  /// Asks for a date between the oldest one the API finds plausible and
  /// today, so nothing the picker can produce is a date the API refuses.
  Future<void> _pickBirthDate() async {
    final messages = AppMessages.of(context);
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialEntryMode: DatePickerEntryMode.input,
      initialDatePickerMode: DatePickerMode.year,
      firstDate: DateTime(now.year - SignUpScreen.oldestPlausibleAge),
      lastDate: now,
      helpText: messages.signUpBirthDateLabel,
    );
    if (picked == null || !mounted) {
      return;
    }
    setState(() {
      _birthDate = DateTime.utc(picked.year, picked.month, picked.day);
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final pendingEmail = _pendingEmail;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          pendingEmail == null
              ? messages.signUpTitle
              : messages.signUpPendingTitle,
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: pendingEmail == null
              ? _buildForm(messages)
              : _SignUpPending(email: pendingEmail),
        ),
      ),
    );
  }

  Widget _buildForm(AppMessages messages) {
    final failure = _failure;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (failure != null) ...[
            Text(
              _failureCopy(messages, failure),
              key: const ValueKey('sign-up-error'),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            const SizedBox(height: 16),
          ],
          TextFormField(
            key: const ValueKey('sign-up-name'),
            controller: _nameController,
            decoration: InputDecoration(
              labelText: messages.signUpNameLabel,
              border: const OutlineInputBorder(),
            ),
            autofillHints: const [AutofillHints.name],
            textInputAction: TextInputAction.next,
            validator: (value) => validateDisplayName(messages, value ?? ''),
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const ValueKey('sign-up-email'),
            controller: _emailController,
            decoration: InputDecoration(
              labelText: messages.authEmailLabel,
              border: const OutlineInputBorder(),
            ),
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            autofillHints: const [AutofillHints.newUsername],
            textInputAction: TextInputAction.next,
            validator: (value) => validateAuthEmail(messages, value ?? ''),
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const ValueKey('sign-up-password'),
            controller: _passwordController,
            decoration: InputDecoration(
              labelText: messages.authPasswordLabel,
              border: const OutlineInputBorder(),
            ),
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            textInputAction: TextInputAction.next,
            validator: (value) => validateNewPassword(messages, value ?? ''),
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const ValueKey('sign-up-password-confirm'),
            controller: _confirmController,
            decoration: InputDecoration(
              labelText: messages.signUpPasswordConfirmLabel,
              border: const OutlineInputBorder(),
            ),
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            textInputAction: TextInputAction.done,
            validator: (value) => validatePasswordConfirmation(
              messages,
              value ?? '',
              password: _passwordController.text,
            ),
            onFieldSubmitted: (_) => unawaited(_submit()),
          ),
          if (_requirements?.ageVerification == AgeVerification.checked)
            _BirthDateField(
              date: _birthDate,
              onPick: () => unawaited(_pickBirthDate()),
              onClear: () => setState(() => _birthDate = null),
            ),
          if (_requirements?.legalPages case final pages? when pages.isNotEmpty)
            _ConsentField(pages: pages),
          const SizedBox(height: 24),
          FilledButton(
            key: const ValueKey('sign-up-submit'),
            onPressed: _submitting ? null : () => unawaited(_submit()),
            child: _submitting
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(messages.signUpSubmit),
          ),
          const SizedBox(height: 24),
          Text(
            messages.signUpHaveAccount,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            key: const ValueKey('sign-up-to-sign-in'),
            onPressed: () => _openSignIn(context),
            child: Text(messages.commonSignIn),
          ),
        ],
      ),
    );
  }

  String _failureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
      _ => messages.signUpFailed,
    };
  }
}

/// The birth date the account is created with, offered only where the tenant
/// checks ages.
///
/// It stays optional there: the API takes a sign-up without one, and the
/// account screen is where a reader gives it afterwards. A tenant read that
/// has not answered yet, or could not, therefore leaves the field out rather
/// than holding the form back — a sign-up sent in the meantime has lost
/// nothing the reader cannot still do.
class _BirthDateField extends StatelessWidget {
  const _BirthDateField({
    required this.date,
    required this.onPick,
    required this.onClear,
  });

  final DateTime? date;
  final VoidCallback onPick;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final picked = date;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 16),
        InputDecorator(
          key: const ValueKey('sign-up-birth-date'),
          decoration: InputDecoration(
            labelText: messages.signUpBirthDateLabel,
            helperText: messages.signUpBirthDateHelp,
            helperMaxLines: 4,
            border: const OutlineInputBorder(),
            suffixIcon: picked == null
                ? IconButton(
                    key: const ValueKey('sign-up-birth-date-pick'),
                    icon: const Icon(Icons.calendar_today_outlined),
                    tooltip: messages.signUpBirthDateLabel,
                    onPressed: onPick,
                  )
                : IconButton(
                    key: const ValueKey('sign-up-birth-date-clear'),
                    icon: const Icon(Icons.close),
                    tooltip: messages.signUpBirthDateClear,
                    onPressed: onClear,
                  ),
          ),
          child: InkWell(
            onTap: onPick,
            child: Text(
              picked == null ? '' : messages.formatCalendarDate(picked),
            ),
          ),
        ),
      ],
    );
  }
}

/// Consent to the pages the tenant names as its terms of service and its
/// privacy policy, asked only where it names one, and required there.
///
/// Each page opens on its own screen above the form, so reading it keeps
/// everything the reader has typed.
class _ConsentField extends StatelessWidget {
  const _ConsentField({required this.pages});

  final List<LegalPage> pages;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    return FormField<bool>(
      initialValue: false,
      validator: (value) =>
          value ?? false ? null : messages.signUpConsentRequired,
      builder: (field) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 16),
          CheckboxListTile(
            key: const ValueKey('sign-up-consent'),
            value: field.value ?? false,
            onChanged: field.didChange,
            title: Text(messages.signUpConsentLabel),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
          ),
          Wrap(
            spacing: 8,
            children: [
              for (final page in pages)
                TextButton(
                  key: ValueKey('sign-up-legal-page-${page.slug}'),
                  onPressed: () => unawaited(
                    context.pushInTab<void>(
                      AppRoutes.publishedPagePath(page.slug),
                    ),
                  ),
                  child: Text(page.title),
                ),
            ],
          ),
          if (field.errorText case final error?)
            Text(
              error,
              key: const ValueKey('sign-up-consent-error'),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
        ],
      ),
    );
  }
}

/// What the reader is told once the API has taken the sign-up: which address
/// the link went to, and the way to another one.
class _SignUpPending extends StatefulWidget {
  const _SignUpPending({required this.email});

  final String email;

  @override
  State<_SignUpPending> createState() => _SignUpPendingState();
}

class _SignUpPendingState extends State<_SignUpPending> {
  var _resending = false;

  /// What the last resend did, `null` before the reader has asked for one.
  AuthFailureKind? _failure;
  var _resent = false;

  Future<void> _resend() async {
    if (_resending) {
      return;
    }
    final auth = AuthScope.of(context);
    setState(() {
      _resending = true;
      _failure = null;
      _resent = false;
    });
    AuthFailureKind? failure;
    try {
      await auth.requestEmailVerification(widget.email);
    } on AuthFailure catch (error) {
      failure = error.kind;
    } on Exception {
      failure = AuthFailureKind.unexpected;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _resending = false;
      _failure = failure;
      _resent = failure == null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    final failure = _failure;
    return Column(
      key: const ValueKey('sign-up-pending'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(messages.signUpPendingSent),
        const SizedBox(height: 8),
        Text(
          messages.authSentTo(email: widget.email),
          key: const ValueKey('sign-up-pending-email'),
          style: theme.textTheme.bodyMedium,
        ),
        const SizedBox(height: 8),
        Text(messages.authCheckSpam, style: theme.textTheme.bodySmall),
        if (_resent) ...[
          const SizedBox(height: 16),
          Text(
            messages.authVerificationSent,
            key: const ValueKey('sign-up-pending-resent'),
          ),
        ],
        if (failure != null) ...[
          const SizedBox(height: 16),
          Text(
            _resendFailureCopy(messages, failure),
            key: const ValueKey('sign-up-pending-error'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        ],
        const SizedBox(height: 24),
        OutlinedButton(
          key: const ValueKey('sign-up-pending-resend'),
          onPressed: _resending ? null : () => unawaited(_resend()),
          child: _resending
              ? const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(messages.authResendVerification),
        ),
        const SizedBox(height: 16),
        FilledButton(
          key: const ValueKey('sign-up-pending-sign-in'),
          onPressed: () => _openSignIn(context),
          child: Text(messages.commonSignIn),
        ),
      ],
    );
  }

  String _resendFailureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
      _ => messages.authResendFailed,
    };
  }
}

/// The sign-in form, in place of whichever of these screens asked for it, so
/// the back gesture does not land on a form the reader has finished with.
void _openSignIn(BuildContext context) {
  if (context.canPop()) {
    context.pushReplacementInTab(AppRoutes.signIn);
  } else {
    context.goInTab(AppRoutes.signIn);
  }
}
