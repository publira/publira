"use client";

// `images.loaderFile` takes a path relative to the app root, so the shared
// implementation is re-exported from here rather than resolved as a package.
export { imageServerLoader as default } from "@publira/utils/image-loader";
