import { Message } from "#components/message";

import type { EyeCatchAspect } from "./aspects";

type EyeCatchVariantType = EyeCatchAspect["variantType"];

/** The kind of record an eye-catch belongs to. */
export type EyeCatchEntity =
  | "campaign_banner"
  | "episode"
  | "genre"
  | "label"
  | "series";

/**
 * What a ratio is called on screen, rendered as its own catalog string.
 *
 * Each branch names its key inside the `<Message>` it returns, so the key is
 * where a translation extractor can see it. `eyeCatchAspectName` is the same
 * name resolved to a string, for the attributes a Client Component sets.
 */
export const EyeCatchAspectNameMessage = ({
  variantType,
}: {
  variantType: EyeCatchVariantType;
}) => {
  switch (variantType) {
    case "portrait": {
      return <Message message="admin.eye_catch.aspect.names.portrait" />;
    }
    case "square": {
      return <Message message="admin.eye_catch.aspect.names.square" />;
    }
    case "landscape": {
      return <Message message="admin.eye_catch.aspect.names.landscape" />;
    }
    default: {
      return <Message message="admin.eye_catch.aspect.names.og" />;
    }
  }
};

const SeriesAspectUsageMessage = ({
  variantType,
}: {
  variantType: EyeCatchVariantType;
}) => {
  switch (variantType) {
    case "portrait": {
      return (
        <Message message="admin.eye_catch.aspect.usages.series.portrait" />
      );
    }
    case "square": {
      return <Message message="admin.eye_catch.aspect.usages.series.square" />;
    }
    case "landscape": {
      return (
        <Message message="admin.eye_catch.aspect.usages.series.landscape" />
      );
    }
    default: {
      return <Message message="admin.eye_catch.aspect.usages.series.og" />;
    }
  }
};

const LabelAspectUsageMessage = ({
  variantType,
}: {
  variantType: EyeCatchVariantType;
}) => {
  switch (variantType) {
    case "portrait": {
      return <Message message="admin.eye_catch.aspect.usages.label.portrait" />;
    }
    case "square": {
      return <Message message="admin.eye_catch.aspect.usages.label.square" />;
    }
    case "landscape": {
      return (
        <Message message="admin.eye_catch.aspect.usages.label.landscape" />
      );
    }
    default: {
      return <Message message="admin.eye_catch.aspect.usages.label.og" />;
    }
  }
};

const GenreAspectUsageMessage = ({
  variantType,
}: {
  variantType: EyeCatchVariantType;
}) => {
  switch (variantType) {
    case "portrait": {
      return <Message message="admin.eye_catch.aspect.usages.genre.portrait" />;
    }
    case "square": {
      return <Message message="admin.eye_catch.aspect.usages.genre.square" />;
    }
    case "landscape": {
      return (
        <Message message="admin.eye_catch.aspect.usages.genre.landscape" />
      );
    }
    default: {
      return <Message message="admin.eye_catch.aspect.usages.genre.og" />;
    }
  }
};

const EpisodeAspectUsageMessage = ({
  variantType,
}: {
  variantType: EyeCatchVariantType;
}) => {
  switch (variantType) {
    case "portrait": {
      return (
        <Message message="admin.eye_catch.aspect.usages.episode.portrait" />
      );
    }
    case "square": {
      return <Message message="admin.eye_catch.aspect.usages.episode.square" />;
    }
    case "landscape": {
      return (
        <Message message="admin.eye_catch.aspect.usages.episode.landscape" />
      );
    }
    default: {
      return <Message message="admin.eye_catch.aspect.usages.episode.og" />;
    }
  }
};

/**
 * A banner has no page of its own, so nothing shares a link to it and its
 * link preview ratio is never drawn. The other three are there for the band
 * the site and the app draw, whichever shape that band takes.
 */
const CampaignBannerAspectUsageMessage = ({
  variantType,
}: {
  variantType: EyeCatchVariantType;
}) =>
  variantType === "og" ? (
    <Message message="admin.eye_catch.aspect.usages.campaign_banner.og" />
  ) : (
    <Message message="admin.eye_catch.aspect.usages.campaign_banner.band" />
  );

/**
 * Where the site and the app draw one ratio of this record's eye-catch.
 *
 * The answer differs by record: a series' portrait image is its cover, while
 * no screen draws a label's at all. Each record therefore has its own copy
 * rather than one line stretched to be true of every one.
 */
export const EyeCatchAspectUsageMessage = ({
  entity,
  variantType,
}: {
  entity: EyeCatchEntity;
  variantType: EyeCatchVariantType;
}) => {
  switch (entity) {
    case "series": {
      return <SeriesAspectUsageMessage variantType={variantType} />;
    }
    case "label": {
      return <LabelAspectUsageMessage variantType={variantType} />;
    }
    case "campaign_banner": {
      return <CampaignBannerAspectUsageMessage variantType={variantType} />;
    }
    case "episode": {
      return <EpisodeAspectUsageMessage variantType={variantType} />;
    }
    default: {
      return <GenreAspectUsageMessage variantType={variantType} />;
    }
  }
};
