import 'package:flutter/material.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_classification.dart';
import 'package:publira/models/series_item.dart';

/// The sort, the serialization state, and the free-to-start filter over a
/// genre's or a tag's series, which are the ones the storefront offers there.
class SeriesFilterBar extends StatelessWidget {
  const SeriesFilterBar({
    super.key,
    required this.filter,
    required this.onChanged,
  });

  final SeriesListFilter filter;
  final ValueChanged<SeriesListFilter> onChanged;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Wrap(
        spacing: 16,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          DropdownButton<SeriesListOrder>(
            key: const ValueKey('series-filter-order'),
            value: filter.order,
            hint: Text(messages.seriesFilterOrder),
            onChanged: (order) => onChanged(filter.copyWith(order: order)),
            items: [
              DropdownMenuItem(
                value: SeriesListOrder.newest,
                child: Text(messages.seriesFilterOrderNewest),
              ),
              DropdownMenuItem(
                value: SeriesListOrder.updated,
                child: Text(messages.seriesFilterOrderUpdated),
              ),
              DropdownMenuItem(
                value: SeriesListOrder.title,
                child: Text(messages.seriesFilterOrderTitle),
              ),
            ],
          ),
          DropdownButton<SeriesStatus?>(
            key: const ValueKey('series-filter-status'),
            value: filter.status,
            hint: Text(messages.seriesFilterStatus),
            onChanged: (status) =>
                onChanged(filter.copyWith(status: () => status)),
            items: [
              DropdownMenuItem(child: Text(messages.seriesFilterStatusAll)),
              DropdownMenuItem(
                value: SeriesStatus.ongoing,
                child: Text(messages.seriesStatusLabel(SeriesStatus.ongoing)),
              ),
              DropdownMenuItem(
                value: SeriesStatus.completed,
                child: Text(messages.seriesStatusLabel(SeriesStatus.completed)),
              ),
              DropdownMenuItem(
                value: SeriesStatus.hiatus,
                child: Text(messages.seriesStatusLabel(SeriesStatus.hiatus)),
              ),
            ],
          ),
          FilterChip(
            key: const ValueKey('series-filter-free'),
            label: Text(messages.seriesFilterFree),
            selected: filter.freeOnly,
            onSelected: (freeOnly) =>
                onChanged(filter.copyWith(freeOnly: freeOnly)),
          ),
        ],
      ),
    );
  }
}
