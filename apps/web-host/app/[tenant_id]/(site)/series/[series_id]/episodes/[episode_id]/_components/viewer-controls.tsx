"use client";

import { useViewerContext } from "@publira/comic-viewer";
import type { PageFitMode, ReadingDirection } from "@publira/comic-viewer";

interface SegmentedOption<TValue extends string> {
  ariaLabel: string;
  label: string;
  value: TValue;
}

const READING_DIRECTION_OPTIONS: SegmentedOption<ReadingDirection>[] = [
  { ariaLabel: "右開きで読む", label: "右開き", value: "rtl" },
  { ariaLabel: "左開きで読む", label: "左開き", value: "ltr" },
];

/**
 * The viewer zooms by pinch and resets by double tap, neither of which a mouse
 * or a keyboard can reach, so the sizing those gestures change is offered as a
 * control too. Fit-to-height is the viewer's own default and leads the list.
 */
const PAGE_FIT_OPTIONS: SegmentedOption<PageFitMode>[] = [
  { ariaLabel: "画面の高さに合わせる", label: "高さ", value: "height" },
  { ariaLabel: "画面の幅に合わせる", label: "幅", value: "width" },
  { ariaLabel: "原寸で表示する", label: "原寸", value: "actual" },
];

export const CONTROL_BUTTON_CLASS =
  "rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap text-neutral-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-100 aria-pressed:bg-white/15 aria-pressed:text-white";

const SegmentedControl = <TValue extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange: (value: TValue) => void;
  options: SegmentedOption<TValue>[];
  value: TValue;
}) => (
  <fieldset
    aria-label={ariaLabel}
    className="flex items-center gap-0.5 rounded-full bg-white/5 p-0.5"
  >
    {options.map((option) => (
      <button
        aria-label={option.ariaLabel}
        aria-pressed={value === option.value}
        className={CONTROL_BUTTON_CLASS}
        key={option.value}
        onClick={() => onChange(option.value)}
        type="button"
      >
        {option.label}
      </button>
    ))}
  </fieldset>
);

export const ReadingDirectionControl = () => {
  const { readingDirection, setReadingDirection } = useViewerContext();

  return (
    <SegmentedControl
      ariaLabel="綴じ方向"
      onChange={setReadingDirection}
      options={READING_DIRECTION_OPTIONS}
      value={readingDirection}
    />
  );
};

export const PageFitControl = () => {
  const { pageFitMode, setPageFitMode } = useViewerContext();

  return (
    <SegmentedControl
      ariaLabel="ページの表示サイズ"
      onChange={setPageFitMode}
      options={PAGE_FIT_OPTIONS}
      value={pageFitMode}
    />
  );
};
