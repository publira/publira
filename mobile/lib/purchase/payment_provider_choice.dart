/// @docImport 'package:publira/purchase/purchase_failure.dart';
library;

import 'dart:io';

import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Where the app remembers the payment provider the reader last paid through
/// on the web, so the next choice starts on it.
abstract class PaymentProviderChoiceStore {
  /// The stored provider id, empty when the reader has chosen none.
  Future<String> read();

  Future<void> write(String providerId);
}

/// [PaymentProviderChoiceStore] that keeps the id in memory, which widget
/// tests inject so a choice does not reach the filesystem.
class MemoryPaymentProviderChoiceStore implements PaymentProviderChoiceStore {
  MemoryPaymentProviderChoiceStore({this.providerId = ''});

  String providerId;

  @override
  Future<String> read() async => providerId;

  @override
  Future<void> write(String providerId) async {
    this.providerId = providerId;
  }
}

/// Resolves the directory the file is written under. Injected so a test can
/// point one at a temporary directory instead of the app's own.
typedef PaymentProviderChoiceRootResolver = Future<Directory> Function();

Future<Directory> _applicationSupportRoot() => getApplicationSupportDirectory();

/// [PaymentProviderChoiceStore] as a file in the app's private directory.
///
/// One id rather than one per tenant: an app is built for one tenant, and an
/// id that tenant no longer sells through is read as no choice.
class FilePaymentProviderChoiceStore implements PaymentProviderChoiceStore {
  const FilePaymentProviderChoiceStore({this._root = _applicationSupportRoot});

  static const _fileName = 'payment-provider';

  final PaymentProviderChoiceRootResolver _root;

  @override
  Future<String> read() async {
    try {
      final file = await _file();
      if (!await file.exists()) {
        return '';
      }
      return (await file.readAsString()).trim();
    } on FileSystemException {
      return '';
    }
  }

  @override
  Future<void> write(String providerId) async {
    final file = await _file();
    await file.parent.create(recursive: true);
    // A rename on the same filesystem is atomic, so a process that dies
    // mid-write cannot leave a truncated id behind.
    final staged = File('${file.path}.writing');
    await staged.writeAsString(providerId);
    await staged.rename(file.path);
  }

  Future<File> _file() async {
    final dir = await _root();
    return File('${dir.path}/$_fileName');
  }
}

/// Asks the reader which provider a checkout through the web pays through,
/// where the tenant sells through more than one, and answers its id: empty
/// where there is no choice to make, which the API reads as the one provider,
/// and `null` for a sheet the reader dismissed, which starts no checkout.
///
/// The sheet starts on the provider [choice] remembers, or on the first one
/// when it remembers none the tenant still sells through, and [choice] then
/// remembers the one the reader went on with.
///
/// Throws [PurchaseFailure] when the providers cannot be read.
Future<String?> choosePaymentProvider(
  BuildContext context, {
  required PurchaseRepository repository,
  required PaymentProviderChoiceStore choice,
}) async {
  final providers = await repository.paymentProviders();
  if (providers.length < 2) {
    return '';
  }
  final stored = await choice.read();
  if (!context.mounted) {
    return null;
  }
  final chosen = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (context) => PaymentProviderSheet(
      providers: providers,
      initial: providers.any((provider) => provider.id == stored)
          ? stored
          : providers.first.id,
    ),
  );
  if (chosen != null) {
    await _writeQuietly(choice, chosen);
  }
  return chosen;
}

/// A choice that cannot be remembered still pays through the provider chosen.
Future<void> _writeQuietly(
  PaymentProviderChoiceStore choice,
  String providerId,
) async {
  try {
    await choice.write(providerId);
  } on FileSystemException {
    // Nothing to tell the reader: the next purchase asks again.
  }
}

/// **Pay with**: one option per provider, named by its display name and what
/// it is known to take, as the public site names them, and **Go to the
/// payment page**, which closes the sheet with the one chosen.
class PaymentProviderSheet extends StatefulWidget {
  const PaymentProviderSheet({
    super.key,
    required this.providers,
    required this.initial,
  });

  /// More than one, in the order the tenant added them.
  final List<PaymentProvider> providers;

  /// The id the sheet starts on, one of [providers].
  final String initial;

  @override
  State<PaymentProviderSheet> createState() => _PaymentProviderSheetState();
}

class _PaymentProviderSheetState extends State<PaymentProviderSheet> {
  late String _chosen = widget.initial;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    return SingleChildScrollView(
      key: const ValueKey('payment-provider-sheet'),
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AutospacedText(
            messages.purchasePaymentProviderLabel,
            style: theme.textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          RadioGroup<String>(
            groupValue: _chosen,
            onChanged: (id) => setState(() => _chosen = id ?? _chosen),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final provider in widget.providers)
                  RadioListTile<String>(
                    key: ValueKey('payment-provider-${provider.id}'),
                    contentPadding: EdgeInsets.zero,
                    value: provider.id,
                    title: AutospacedText(provider.displayName),
                    subtitle: switch (_methods(messages, provider.id)) {
                      final methods? => AutospacedText(methods),
                      null => null,
                    },
                  ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            key: const ValueKey('payment-provider-continue'),
            onPressed: () => Navigator.of(context).pop(_chosen),
            child: AutospacedText(messages.purchasePaymentProviderContinue),
          ),
        ],
      ),
    );
  }

  /// What a provider is known to take, for the line under its name. A
  /// provider this build does not know, such as one an operator added in a
  /// fork, is named alone.
  static String? _methods(AppMessages messages, String id) => switch (id) {
    'payjp' => messages.purchasePaymentProviderMethodsPayjp,
    'stripe' => messages.purchasePaymentProviderMethodsStripe,
    _ => null,
  };
}
