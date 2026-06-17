export type FileItem = {
  key: string;
  size: number;
  lastModified: string | null;
};

export type ListResponse = {
  prefix: string;
  folders: string[];
  files: FileItem[];
  nextToken: string | null;
};

export type TableData = {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  /** Set when the preview only shows a subset of the underlying data. */
  truncated?: boolean;
};
