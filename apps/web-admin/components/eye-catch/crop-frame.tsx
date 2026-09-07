"use client";

import { getMessage } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cn } from "@publira/utils";
import type { KeyboardEvent, PointerEvent, ReactEventHandler } from "react";
import { useContext, useRef } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import type { CropRect } from "#lib/crop-rect";

import type { EyeCatchAspect } from "./aspects";
import type { CropCorner, CropSource } from "./crop";
import {
  cropBounds,
  moveCropRect,
  resizeCropRectBy,
  resizeCropRectToPointer,
} from "./crop";

interface EyeCatchCropFrameProps {
  aspect: EyeCatchAspect;
  /**
   * The rectangle the editor has framed, in pixels of the picked file, and
   * that file's own size. Both are `null` until the browser has decoded the
   * file, which is what the image below reports.
   */
  crop: CropRect | null;
  source: CropSource | null;
  imageUrl: string;
  onCropChange: (crop: CropRect) => void;
  onImageLoad: ReactEventHandler<HTMLImageElement>;
}

/** The corners, clockwise from the top left. */
const CROP_CORNERS: readonly CropCorner[] = ["nw", "ne", "se", "sw"];

const CORNER_LABEL_KEYS = {
  ne: "admin.eye_catch.aspect.crop.resize_top_right",
  nw: "admin.eye_catch.aspect.crop.resize_top_left",
  se: "admin.eye_catch.aspect.crop.resize_bottom_right",
  sw: "admin.eye_catch.aspect.crop.resize_bottom_left",
} as const;

/**
 * How far one arrow key press moves the frame: a hundredth of the image, so a
 * press is a visible nudge whatever the file's size, and never below a pixel.
 * Holding Shift takes ten of those at once.
 */
const keyboardStep = (source: CropSource, coarse: boolean): number =>
  Math.max(1, Math.round(source.width / 100)) * (coarse ? 10 : 1);

/** Which way an arrow key points, in the image's own axes. */
const ARROW_DIRECTIONS = {
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
} as const;

const arrowDirection = (key: string): { x: number; y: number } | undefined =>
  key in ARROW_DIRECTIONS
    ? ARROW_DIRECTIONS[key as keyof typeof ARROW_DIRECTIONS]
    : undefined;

const percent = (value: number, total: number): string =>
  `${(value / total) * 100}%`;

const cornerLabel = (
  messages: SharedMessages,
  corner: CropCorner,
  variantType: string
): string =>
  getMessage(messages, CORNER_LABEL_KEYS[corner], {
    variant_type: variantType,
  });

/**
 * The picked file at full frame, with the rectangle that will be cut out of it
 * drawn on top. The frame is locked to the ratio, so an editor chooses where
 * the cut sits and how much of the image it covers, and nothing else.
 *
 * The rectangle is held by the slot rather than here: the slot posts it with
 * the upload and previews the same region, so this component reports every
 * change instead of keeping one.
 */
export const EyeCatchCropFrame = ({
  aspect,
  crop,
  imageUrl,
  onCropChange,
  onImageLoad,
  source,
}: EyeCatchCropFrameProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const imageRef = useRef<HTMLImageElement>(null);
  /**
   * What the pointer is dragging, and where it grabbed the frame. It is read
   * and written between two events of one gesture and never rendered, so it is
   * a ref rather than state.
   */
  const dragRef = useRef<{
    corner: CropCorner | null;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  /** The frame and what it moves in, once the file's size is known. */
  const frame =
    crop && source ? { bounds: cropBounds(source, aspect), crop } : null;

  /** The pointer's position in pixels of the picked file. */
  const pointerPosition = (
    event: PointerEvent<HTMLElement>
  ): { x: number; y: number } | null => {
    const box = imageRef.current?.getBoundingClientRect();
    if (!(frame && box) || box.width === 0 || box.height === 0) {
      return null;
    }
    return {
      x: ((event.clientX - box.left) / box.width) * frame.bounds.source.width,
      y: ((event.clientY - box.top) / box.height) * frame.bounds.source.height,
    };
  };

  const startDrag = (
    event: PointerEvent<HTMLButtonElement>,
    corner: CropCorner | null
  ) => {
    const pointer = pointerPosition(event);
    if (!(frame && pointer)) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      corner,
      offsetX: pointer.x - frame.crop.x,
      offsetY: pointer.y - frame.crop.y,
    };
  };

  const continueDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const pointer = pointerPosition(event);
    if (!(frame && drag && pointer)) {
      return;
    }
    onCropChange(
      drag.corner
        ? resizeCropRectToPointer(
            frame.crop,
            frame.bounds,
            drag.corner,
            pointer
          )
        : moveCropRect(
            frame.crop,
            frame.bounds,
            pointer.x - drag.offsetX,
            pointer.y - drag.offsetY
          )
    );
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const handleFrameKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction = arrowDirection(event.key);
    if (!(frame && direction)) {
      return;
    }
    event.preventDefault();
    const step = keyboardStep(frame.bounds.source, event.shiftKey);
    onCropChange(
      moveCropRect(
        frame.crop,
        frame.bounds,
        frame.crop.x + direction.x * step,
        frame.crop.y + direction.y * step
      )
    );
  };

  /**
   * An arrow key moves the corner it is pressed on, the way dragging it would.
   * Which side of the frame that grows is the corner's own business, so the
   * step is handed over as a signed width for the anchor to apply.
   */
  const handleCornerKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    corner: CropCorner
  ) => {
    const direction = arrowDirection(event.key);
    if (!(frame && direction)) {
      return;
    }
    event.preventDefault();
    const { largest, source: file } = frame.bounds;
    const step = keyboardStep(file, event.shiftKey);
    const outwardX = corner === "ne" || corner === "se" ? 1 : -1;
    const outwardY = corner === "se" || corner === "sw" ? 1 : -1;
    const widthDelta =
      direction.x === 0
        ? (direction.y * outwardY * step * largest.width) / largest.height
        : direction.x * outwardX * step;
    onCropChange(
      resizeCropRectBy(frame.crop, frame.bounds, corner, widthDelta)
    );
  };

  return (
    <div className="relative mx-auto w-fit overflow-hidden rounded-md bg-muted/40">
      {/* The picked file is a blob of unknown size, so next/image cannot carry
          it, and this element's box is what the frame is measured against. */}
      {/* oxlint-disable-next-line next/no-img-element, react-doctor/nextjs-no-img-element */}
      <img
        alt={getMessage(messages, "admin.eye_catch.aspect.crop.image_alt", {
          variant_type: aspect.variantType,
        })}
        className="block max-h-[60vh] w-auto max-w-full touch-none select-none"
        draggable={false}
        onLoad={onImageLoad}
        ref={imageRef}
        src={imageUrl}
      />

      {frame ? (
        <div className="pointer-events-none absolute inset-0">
          <button
            aria-label={getMessage(
              messages,
              "admin.eye_catch.aspect.crop.move",
              { variant_type: aspect.variantType }
            )}
            className="pointer-events-auto absolute cursor-grab touch-none shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] outline-2 outline-white focus-visible:outline-4 focus-visible:outline-blue-400 active:cursor-grabbing"
            onKeyDown={handleFrameKeyDown}
            onLostPointerCapture={endDrag}
            onPointerCancel={endDrag}
            onPointerDown={(event) => startDrag(event, null)}
            onPointerMove={continueDrag}
            onPointerUp={endDrag}
            style={{
              height: percent(frame.crop.height, frame.bounds.source.height),
              left: percent(frame.crop.x, frame.bounds.source.width),
              top: percent(frame.crop.y, frame.bounds.source.height),
              width: percent(frame.crop.width, frame.bounds.source.width),
            }}
            type="button"
          />

          {CROP_CORNERS.map((corner) => (
            <button
              aria-label={cornerLabel(messages, corner, aspect.variantType)}
              className={cn(
                "pointer-events-auto absolute size-4 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-blue-500 focus-visible:outline-4 focus-visible:outline-blue-400",
                corner === "ne" || corner === "sw"
                  ? "cursor-nesw-resize"
                  : "cursor-nwse-resize"
              )}
              key={corner}
              onKeyDown={(event) => handleCornerKeyDown(event, corner)}
              onLostPointerCapture={endDrag}
              onPointerCancel={endDrag}
              onPointerDown={(event) => startDrag(event, corner)}
              onPointerMove={continueDrag}
              onPointerUp={endDrag}
              style={{
                left: percent(
                  corner === "ne" || corner === "se"
                    ? frame.crop.x + frame.crop.width
                    : frame.crop.x,
                  frame.bounds.source.width
                ),
                top: percent(
                  corner === "se" || corner === "sw"
                    ? frame.crop.y + frame.crop.height
                    : frame.crop.y,
                  frame.bounds.source.height
                ),
              }}
              type="button"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};
