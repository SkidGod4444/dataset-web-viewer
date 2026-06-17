export type Category =
  | "image"
  | "csv"
  | "tsv"
  | "json"
  | "jsonl"
  | "parquet"
  | "markdown"
  | "text"
  | "pdf"
  | "audio"
  | "video"
  | "binary";

const CATEGORY_BY_EXT: Record<string, Category> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  ico: "image",
  avif: "image",
  tiff: "image",
  csv: "csv",
  tsv: "tsv",
  json: "json",
  geojson: "json",
  jsonl: "jsonl",
  ndjson: "jsonl",
  parquet: "parquet",
  pq: "parquet",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  log: "text",
  yaml: "text",
  yml: "text",
  xml: "text",
  html: "text",
  htm: "text",
  css: "text",
  js: "text",
  ts: "text",
  py: "text",
  sh: "text",
  conf: "text",
  ini: "text",
  toml: "text",
  pdf: "pdf",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  m4a: "audio",
  mp4: "video",
  webm: "video",
  mov: "video",
  mkv: "video",
};

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  tiff: "image/tiff",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  geojson: "application/json",
  jsonl: "application/x-ndjson",
  ndjson: "application/x-ndjson",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  log: "text/plain",
  yaml: "text/yaml",
  yml: "text/yaml",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

export function extOf(key: string): string {
  const name = key.split("/").pop() ?? key;
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function categoryOf(key: string): Category {
  return CATEGORY_BY_EXT[extOf(key)] ?? "binary";
}

/** Best-guess content type from the extension; falls back to octet-stream. */
export function mimeOf(key: string): string {
  return MIME_BY_EXT[extOf(key)] ?? "application/octet-stream";
}
