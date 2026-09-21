import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { createSeries } from "./series";

const {
  mockCreateCreator,
  mockCreateLabel,
  mockCreateSeries,
  mockGetAccessToken,
  mockUpdateCreator,
  mockUpdateLabel,
  mockUpdateSeries,
  mockUploadEpisodeImages,
  mockUploadLabelEyeCatchAspectImage,
  mockUploadSeriesEyeCatchAspectImage,
  mockUploadTenantIcon,
  mockUploadTenantLogo,
} = vi.hoisted(() => ({
  mockCreateCreator: vi.fn(),
  mockCreateLabel: vi.fn(),
  mockCreateSeries: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateCreator: vi.fn(),
  mockUpdateLabel: vi.fn(),
  mockUpdateSeries: vi.fn(),
  mockUploadEpisodeImages: vi.fn(),
  mockUploadLabelEyeCatchAspectImage: vi.fn(),
  mockUploadSeriesEyeCatchAspectImage: vi.fn(),
  mockUploadTenantIcon: vi.fn(),
  mockUploadTenantLogo: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    creator: {
      createCreator: mockCreateCreator,
      updateCreator: mockUpdateCreator,
    },
    label: {
      createLabel: mockCreateLabel,
      updateLabel: mockUpdateLabel,
      uploadLabelEyeCatchAspectImage: mockUploadLabelEyeCatchAspectImage,
    },
    series: {
      createSeries: mockCreateSeries,
      updateSeries: mockUpdateSeries,
      uploadEpisodeImages: mockUploadEpisodeImages,
      uploadSeriesEyeCatchAspectImage: mockUploadSeriesEyeCatchAspectImage,
    },
    theme: {
      uploadTenantIcon: mockUploadTenantIcon,
      uploadTenantLogo: mockUploadTenantLogo,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const storageNotConfiguredError = () =>
  new ConnectError(
    "object storage is not configured",
    Code.FailedPrecondition,
    undefined,
    [
      {
        desc: ErrorInfoSchema,
        value: { domain: "publira", reason: "STORAGE_NOT_CONFIGURED" },
      },
    ]
  );

const storageNotConfiguredByLocale: Record<Locale, string> = {
  en: "Images cannot be uploaded because image storage has not been set up on the platform yet. Ask a platform operator to set it up.",
  ja: "プラットフォームに画像の保存先がまだ設定されていないため、画像をアップロードできません。プラットフォームのオペレーターに設定を依頼してください。",
  ko: "플랫폼에 아직 이미지 저장소가 설정되지 않아 이미지를 업로드할 수 없습니다. 플랫폼 운영자에게 설정을 요청해 주세요.",
  "zh-Hans":
    "平台尚未设置图片存储，因此无法上传图片。请联系平台运营人员进行设置。",
  "zh-Hant":
    "平台尚未設定圖片儲存空間，因此無法上傳圖片。請聯絡平台營運人員進行設定。",
};

const image = new Uint8Array([1, 2, 3]);

const seriesInput: Parameters<typeof createSeries>[0] = {
  ageRating: "r15",
  availability: "all",
  commentMode: "",
  creatorCredits: [],
  eyeCatchImageContentType: "image/png",
  eyeCatchImageData: image,
  genrePublicIds: [],
  isPublished: false,
  labelPublicId: "LABEL001",
  readingDirection: "rtl",
  readingPeriodHours: 24,
  scheduleWeekdays: [],
  spreadStartIndex: 0,
  status: "ongoing",
  synopsis: "A synopsis",
  tagNames: [],
  tenantId: "TENANT001",
  title: "Series title",
};

interface UploadSurface {
  name: string;
  rpc: ReturnType<typeof vi.fn>;
  /** The message the surface showed for a failed precondition before. */
  fallback: string;
  upload: (locale: Locale) => Promise<unknown>;
}

const surfaces: UploadSurface[] = [
  {
    fallback: "Could not add the page images. Please try again later.",
    name: "episode page images",
    rpc: mockUploadEpisodeImages,
    upload: async (locale) => {
      const { uploadEpisodePages } = await import("./episode");
      return uploadEpisodePages(
        {
          episodePublicId: "EPISODE001",
          pages: [new File([image], "001.png", { type: "image/png" })],
          tenantId: "TENANT001",
        },
        locale
      );
    },
  },
  {
    fallback: "Could not add the page images. Please try again later.",
    name: "episode archive",
    rpc: mockUploadEpisodeImages,
    upload: async (locale) => {
      const { uploadEpisodePages } = await import("./episode");
      return uploadEpisodePages(
        {
          archive: new File([image], "episode.zip", {
            type: "application/zip",
          }),
          episodePublicId: "EPISODE001",
          seriesPublicId: "SERIES001",
          tenantId: "TENANT001",
        },
        locale
      );
    },
  },
  {
    fallback: "Could not save the series. Please try again later.",
    name: "new series eye-catch",
    rpc: mockCreateSeries,
    upload: async (locale) => {
      const { createSeries } = await import("./series");
      return createSeries(seriesInput, locale);
    },
  },
  {
    fallback: "Could not save the series. Please try again later.",
    name: "series eye-catch",
    rpc: mockUpdateSeries,
    upload: async (locale) => {
      const { updateSeries } = await import("./series");
      return updateSeries({ ...seriesInput, publicId: "SERIES001" }, locale);
    },
  },
  {
    fallback: "Could not save the series. Please try again later.",
    name: "series eye-catch aspect ratio",
    rpc: mockUploadSeriesEyeCatchAspectImage,
    upload: async (locale) => {
      const { uploadSeriesEyeCatchAspectImage } = await import("./series");
      return uploadSeriesEyeCatchAspectImage(
        {
          imageData: image,
          publicId: "SERIES001",
          tenantId: "TENANT001",
          variantType: "square",
        },
        locale
      );
    },
  },
  {
    fallback: "Could not save the author. Please try again later.",
    name: "new creator image",
    rpc: mockCreateCreator,
    upload: async (locale) => {
      const { createCreator } = await import("./creator");
      return createCreator(
        {
          iconImageContentType: "image/png",
          iconImageData: image,
          name: "Creator",
          profileText: "",
          tenantId: "TENANT001",
        },
        locale
      );
    },
  },
  {
    fallback: "Could not save the author. Please try again later.",
    name: "creator image",
    rpc: mockUpdateCreator,
    upload: async (locale) => {
      const { updateCreator } = await import("./creator");
      return updateCreator(
        {
          iconImageContentType: "image/png",
          iconImageData: image,
          name: "Creator",
          profileText: "",
          publicId: "CREATOR001",
          tenantId: "TENANT001",
        },
        locale
      );
    },
  },
  {
    fallback: "Could not save the label. Please try again later.",
    name: "new label eye-catch",
    rpc: mockCreateLabel,
    upload: async (locale) => {
      const { createLabel } = await import("./label");
      return createLabel(
        {
          eyeCatchImageContentType: "image/png",
          eyeCatchImageData: image,
          name: "Label",
          tenantId: "TENANT001",
        },
        locale
      );
    },
  },
  {
    fallback: "Could not save the label. Please try again later.",
    name: "label eye-catch",
    rpc: mockUpdateLabel,
    upload: async (locale) => {
      const { updateLabel } = await import("./label");
      return updateLabel(
        {
          eyeCatchImageContentType: "image/png",
          eyeCatchImageData: image,
          name: "Label",
          publicId: "LABEL001",
          tenantId: "TENANT001",
        },
        locale
      );
    },
  },
  {
    fallback: "Could not save the label. Please try again later.",
    name: "label eye-catch aspect ratio",
    rpc: mockUploadLabelEyeCatchAspectImage,
    upload: async (locale) => {
      const { uploadLabelEyeCatchAspectImage } = await import("./label");
      return uploadLabelEyeCatchAspectImage(
        {
          imageData: image,
          publicId: "LABEL001",
          tenantId: "TENANT001",
          variantType: "square",
        },
        locale
      );
    },
  },
  {
    fallback: "Could not upload the icon. Please try again later.",
    name: "theme icon",
    rpc: mockUploadTenantIcon,
    upload: async (locale) => {
      const { uploadTenantIcon } = await import("./theme-settings");
      return uploadTenantIcon(
        {
          iconContentType: "image/png",
          iconData: image,
          tenantId: "TENANT001",
        },
        locale
      );
    },
  },
  {
    fallback: "Could not upload the logo. Please try again later.",
    name: "theme logo",
    rpc: mockUploadTenantLogo,
    upload: async (locale) => {
      const { uploadTenantLogo } = await import("./theme-settings");
      return uploadTenantLogo(
        {
          logoContentType: "image/png",
          logoData: image,
          tenantId: "TENANT001",
        },
        locale
      );
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe.each(surfaces)("an upload of the $name", (surface) => {
  it.each(getLocales())(
    "explains in %s that no object storage is configured",
    async (locale) => {
      surface.rpc.mockRejectedValue(storageNotConfiguredError());

      await expect(surface.upload(locale)).resolves.toEqual({
        message: storageNotConfiguredByLocale[locale],
        ok: false,
      });
    }
  );

  it("keeps its own message for another failed precondition", async () => {
    surface.rpc.mockRejectedValue(
      new ConnectError("precondition failed", Code.FailedPrecondition)
    );

    await expect(surface.upload("en")).resolves.toEqual({
      message: surface.fallback,
      ok: false,
    });
  });
});
