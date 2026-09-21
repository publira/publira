import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/contact/contact_failure.dart';
import 'package:publira/contact/contact_repository.dart';
import 'package:publira/forms/email_input.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/router.dart';

/// A message to the people who run the tenant, sent through
/// `ContactService/SubmitContactMessage`.
///
/// A guest can send one too, since a reader who cannot sign in is one of the
/// people who needs to reach the tenant.
class ContactScreen extends StatefulWidget {
  const ContactScreen({super.key});

  /// The limits `SubmitContactMessage` enforces, counted the way it counts
  /// them: the address in bytes and the subject and message in code points.
  static const maxReplyToBytes = 254;
  static const maxSubjectLength = 200;
  static const maxBodyLength = 4000;

  @override
  State<ContactScreen> createState() => _ContactScreenState();
}

class _ContactScreenState extends State<ContactScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _subjectController = TextEditingController();
  final _bodyController = TextEditingController();

  var _started = false;
  var _submitting = false;
  var _sent = false;

  /// Why the last attempt failed, rendered in the current locale on each
  /// build rather than as the copy of the locale it failed under.
  ContactFailureKind? _failure;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    unawaited(_fillEmail());
  }

  @override
  void dispose() {
    _emailController.dispose();
    _subjectController.dispose();
    _bodyController.dispose();
    super.dispose();
  }

  /// Offers a signed-in reader the address their account holds, unless they
  /// have started typing one of their own.
  Future<void> _fillEmail() async {
    final String? email;
    try {
      email = await AuthScope.of(context).readEmail();
    } on Exception {
      // The reader can still type the address themselves.
      return;
    }
    if (!mounted || email == null || _emailController.text.isNotEmpty) {
      return;
    }
    _emailController.text = email;
  }

  Future<void> _submit() async {
    if (_submitting || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final repository = ContactScope.maybeOf(context);
    if (repository == null) {
      setState(() => _failure = ContactFailureKind.unexpected);
      return;
    }
    setState(() {
      _submitting = true;
      _failure = null;
    });
    ContactFailureKind? failure;
    try {
      await repository.submit(
        replyToEmail: _emailController.text.trim(),
        subject: _subjectController.text.trim(),
        body: _bodyController.text.trim(),
      );
    } on ContactFailure catch (error) {
      failure = error.kind;
    } on Exception {
      failure = ContactFailureKind.unexpected;
    }
    if (!mounted) {
      return;
    }
    // A refusal leaves every field as the reader wrote it.
    setState(() {
      _submitting = false;
      _failure = failure;
      _sent = failure == null;
    });
  }

  void _close() {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(AppRoutes.account);
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(messages.contactTitle)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: _sent ? _buildSent(messages) : _buildForm(messages),
        ),
      ),
    );
  }

  Widget _buildSent(AppMessages messages) {
    return Column(
      key: const ValueKey('contact-sent'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          messages.contactSentHeading,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        Text(messages.contactSentDescription),
        const SizedBox(height: 24),
        FilledButton(
          key: const ValueKey('contact-done'),
          onPressed: _close,
          child: Text(messages.contactDone),
        ),
      ],
    );
  }

  Widget _buildForm(AppMessages messages) {
    final failure = _failure;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(messages.contactDescription),
          const SizedBox(height: 24),
          if (failure != null) ...[
            Text(
              _failureCopy(messages, failure),
              key: const ValueKey('contact-error'),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            const SizedBox(height: 16),
          ],
          TextFormField(
            key: const ValueKey('contact-email'),
            controller: _emailController,
            decoration: InputDecoration(
              labelText: messages.contactEmailLabel,
              helperText: messages.contactEmailHelp,
              border: const OutlineInputBorder(),
            ),
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            autofillHints: const [AutofillHints.email],
            textInputAction: TextInputAction.next,
            validator: (value) => _validateEmail(messages, value ?? ''),
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const ValueKey('contact-subject'),
            controller: _subjectController,
            decoration: InputDecoration(
              labelText: messages.contactSubjectLabel,
              border: const OutlineInputBorder(),
            ),
            textInputAction: TextInputAction.next,
            validator: (value) =>
                (value ?? '').trim().runes.length >
                    ContactScreen.maxSubjectLength
                ? messages.contactSubjectTooLong(
                    max: '${ContactScreen.maxSubjectLength}',
                  )
                : null,
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const ValueKey('contact-body'),
            controller: _bodyController,
            decoration: InputDecoration(
              labelText: messages.contactBodyLabel,
              border: const OutlineInputBorder(),
              alignLabelWithHint: true,
            ),
            keyboardType: TextInputType.multiline,
            minLines: 6,
            maxLines: null,
            validator: (value) => _validateBody(messages, value ?? ''),
          ),
          const SizedBox(height: 24),
          FilledButton(
            key: const ValueKey('contact-submit'),
            onPressed: _submitting ? null : _submit,
            child: _submitting
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(messages.contactSubmit),
          ),
        ],
      ),
    );
  }

  String? _validateEmail(AppMessages messages, String value) {
    final email = value.trim();
    if (email.isEmpty) {
      return messages.contactEmailRequired;
    }
    if (utf8.encode(email).length > ContactScreen.maxReplyToBytes) {
      return messages.contactEmailTooLong;
    }
    if (!emailShape.hasMatch(email)) {
      return messages.contactEmailInvalid;
    }
    return null;
  }

  String? _validateBody(AppMessages messages, String value) {
    final body = value.trim();
    if (body.isEmpty) {
      return messages.contactBodyRequired;
    }
    if (body.runes.length > ContactScreen.maxBodyLength) {
      return messages.contactBodyTooLong(max: '${ContactScreen.maxBodyLength}');
    }
    return null;
  }

  String _failureCopy(AppMessages messages, ContactFailureKind failure) {
    return switch (failure) {
      ContactFailureKind.network => messages.errorsRpcUnavailable,
      ContactFailureKind.invalid => messages.errorsRpcInvalidArgument,
      ContactFailureKind.rateLimited => messages.errorsRpcRateLimited,
      ContactFailureKind.unexpected => messages.contactSubmitFailed,
    };
  }
}
