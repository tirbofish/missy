const GIPHY_SEARCH_URL = "https://api.giphy.com/v1/gifs/search";
const DEFAULT_GIPHY_RATING = "pg-13";
const DEFAULT_GIPHY_LANG = "en";

type GiphyImage = {
  url?: string;
};

type GiphyGif = {
  images?: {
    downsized?: GiphyImage;
    fixed_height?: GiphyImage;
    original?: GiphyImage;
  };
  url?: string;
};

type GiphySearchResponse = {
  data?: GiphyGif[];
  meta?: {
    msg?: string;
    status?: number;
  };
};

export type GiphySearchOptions = {
  apiKey?: string;
  fetcher?: typeof fetch;
  limit?: number;
  rating?: string;
};

function giphyApiKey(options: GiphySearchOptions): string | undefined {
  return options.apiKey?.trim() || Deno.env.get("GIPHY_API_KEY")?.trim();
}

function bestGifUrl(gif: GiphyGif): string | undefined {
  return gif.images?.downsized?.url ??
    gif.images?.fixed_height?.url ??
    gif.images?.original?.url ??
    gif.url;
}

export async function searchGiphyGif(
  query: string,
  options: GiphySearchOptions = {},
): Promise<string | undefined> {
  const apiKey = giphyApiKey(options);
  const trimmedQuery = query.trim();

  if (!apiKey || !trimmedQuery) {
    return undefined;
  }

  const url = new URL(GIPHY_SEARCH_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("q", trimmedQuery);
  url.searchParams.set("limit", String(options.limit ?? 10));
  url.searchParams.set("rating", options.rating ?? DEFAULT_GIPHY_RATING);
  url.searchParams.set("lang", DEFAULT_GIPHY_LANG);

  const response = await (options.fetcher ?? fetch)(url);
  const responseBody = await response.text();

  if (!response.ok) {
    console.error(
      `GIPHY search failed with HTTP ${response.status}: ${responseBody}`,
    );
    return undefined;
  }

  const parsed = JSON.parse(responseBody) as GiphySearchResponse;
  const urls = (parsed.data ?? []).map(bestGifUrl).filter(
    (url): url is string => Boolean(url),
  );

  if (urls.length === 0) {
    return undefined;
  }

  return urls[Math.floor(Math.random() * urls.length)];
}
