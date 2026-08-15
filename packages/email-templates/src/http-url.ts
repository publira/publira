const parseHttpUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
};

export const isHttpUrl = (value: string): boolean =>
  parseHttpUrl(value) !== null;
