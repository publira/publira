import 'package:publira/csv/csv.dart';
import 'package:publira/models/my_creator.dart';

/// The name the Author's statement of [period] is handed to the share sheet
/// under, the one the site's download saves it as.
String creatorStatementCsvName(MyCreator creator, String period) =>
    'royalties-${creator.publicId}-$period.csv';

const _header = [
  'period',
  'role_name',
  'series_id',
  'series_title',
  'episode_id',
  'episode_title',
  'sale_count',
  'gross_amount',
  'refunded_amount',
  'share_percent',
  'payout_amount',
  'currency',
  'adjusted_period',
  'source',
];

/// A share in basis points as a percentage with two decimals: `12.50`.
String _sharePercent(int bps) =>
    '${bps ~/ 100}.${(bps % 100).toString().padLeft(2, '0')}';

/// The Author's lines of a closed month as CSV, in the columns and the
/// encoding of the site's download: a header row, then one row per line in
/// the order given, with no summary row.
///
/// The columns are those of the console's export of the same month, in the
/// same order and written the same way — amounts as integers in the minor unit
/// of `currency`, the share with two decimals — so a sheet built on one reads
/// the other. `creator_id` and `creator_name`, which would name the reader's
/// own Author on every row, and `role_id`, which the reader's API does not
/// answer, are left out. `series_id` and `episode_id` are public IDs, and are
/// empty once the row a line named has been deleted.
String renderCreatorStatementCsv(
  MyCreatorStatement statement,
  List<MyCreatorStatementLine> lines,
) {
  final rows = StringBuffer(csvBom)..write(encodeCsvRow(_header));
  for (final line in lines) {
    rows.write(
      encodeCsvRow([
        statement.period,
        line.roleName,
        line.seriesPublicId,
        line.seriesTitle,
        line.episodePublicId,
        line.episodeTitle,
        '${line.saleCount}',
        '${line.grossAmount}',
        '${line.refundedAmount}',
        _sharePercent(line.shareBps),
        '${line.payoutAmount}',
        statement.currency,
        line.adjustedPeriod,
        line.source.wireName,
      ]),
    );
  }
  return rows.toString();
}
