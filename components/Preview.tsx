"use client";

import { useEffect, useState } from "react";
import Papa from "papaparse";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileQuestion,
  Table as TableIcon,
} from "lucide-react";
import type { FileItem, TableData } from "@/lib/types";
import { basename, formatBytes, formatDate } from "@/lib/format";
import { categoryOf, type Category } from "@/lib/mime";
import { DataTable } from "./DataTable";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DownloadButton } from "@/components/DownloadButton";
import { cn } from "@/lib/utils";

const TEXT_CAP = 2_000_000; // 2 MB cap for text-based previews
const DISPLAY_ROW_CAP = 5000; // max rows rendered in the DOM
const PARQUET_PAGE_SIZE = 100;

type View =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "table"; data: TableData }
  | { kind: "text"; text: string; truncated: boolean };

function objectUrl(key: string, opts?: { head?: number; download?: boolean }) {
  const p = new URLSearchParams({ key });
  if (opts?.head) p.set("head", String(opts.head));
  if (opts?.download) p.set("download", "1");
  return `/api/object?${p}`;
}

function recordsToTable(records: unknown[]): { columns: string[]; rows: Record<string, unknown>[] } {
  const columns = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const rec of records) {
    if (rec && typeof rec === "object" && !Array.isArray(rec)) {
      Object.keys(rec).forEach((k) => columns.add(k));
      rows.push(rec as Record<string, unknown>);
    } else {
      columns.add("value");
      rows.push({ value: rec });
    }
  }
  return { columns: [...columns], rows };
}

export function Preview({ file }: { file: FileItem | null }) {
  const [view, setView] = useState<View>({ kind: "idle" });
  const [page, setPage] = useState(0);

  const cat: Category | null = file ? categoryOf(file.key) : null;
  // Media types render directly from a URL — no fetch/parse needed.
  const isDirect =
    cat === "image" || cat === "pdf" || cat === "audio" || cat === "video";

  useEffect(() => {
    setPage(0);
  }, [file?.key]);

  useEffect(() => {
    if (!file || !cat) return;
    // Media renders from a URL and binary has no inline preview — nothing to fetch.
    if (isDirect || cat === "binary") {
      setView({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setView({ kind: "loading" });

    async function run() {
      try {
        if (cat === "parquet") {
          const params = new URLSearchParams({
            key: file!.key,
            limit: String(PARQUET_PAGE_SIZE),
            offset: String(page * PARQUET_PAGE_SIZE),
          });
          const res = await fetch(`/api/parquet?${params}`);
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? "Failed to read parquet");
          if (!cancelled) setView({ kind: "table", data: json as TableData });
          return;
        }

        const res = await fetch(objectUrl(file!.key, { head: TEXT_CAP }));
        if (!res.ok) throw new Error(await res.text());
        const text = await res.text();
        const truncated = file!.size > TEXT_CAP;
        if (cancelled) return;

        if (cat === "csv" || cat === "tsv") {
          const parsed = Papa.parse<Record<string, unknown>>(text, {
            header: true,
            skipEmptyLines: true,
            delimiter: cat === "tsv" ? "\t" : "",
          });
          const rows = parsed.data.slice(0, DISPLAY_ROW_CAP);
          setView({
            kind: "table",
            data: {
              columns: parsed.meta.fields ?? Object.keys(rows[0] ?? {}),
              rows,
              totalRows: parsed.data.length,
              truncated: truncated || parsed.data.length > rows.length,
            },
          });
          return;
        }

        if (cat === "jsonl") {
          const records = text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => {
              try {
                return JSON.parse(l);
              } catch {
                return { _parseError: l };
              }
            });
          const { columns, rows } = recordsToTable(records.slice(0, DISPLAY_ROW_CAP));
          setView({
            kind: "table",
            data: { columns, rows, totalRows: records.length, truncated: truncated || records.length > rows.length },
          });
          return;
        }

        if (cat === "json") {
          try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
              const { columns, rows } = recordsToTable(parsed.slice(0, DISPLAY_ROW_CAP));
              setView({
                kind: "table",
                data: { columns, rows, totalRows: parsed.length, truncated: truncated || parsed.length > rows.length },
              });
            } else {
              setView({ kind: "text", text: JSON.stringify(parsed, null, 2), truncated });
            }
          } catch {
            // Truncated/invalid JSON — fall back to showing raw text.
            setView({ kind: "text", text, truncated });
          }
          return;
        }

        // text, markdown, and everything else textual
        setView({ kind: "text", text, truncated });
      } catch (e) {
        if (!cancelled)
          setView({ kind: "error", message: e instanceof Error ? e.message : "Failed to load" });
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [file, cat, isDirect, page]);

  if (!file || !cat) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <TableIcon className="size-10 opacity-40" />
        <p className="text-sm">Select a file to preview it.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PreviewHeader file={file} cat={cat} view={view} page={page} setPage={setPage} />
      <div className="min-h-0 flex-1">
        <PreviewBody file={file} cat={cat} isDirect={isDirect} view={view} />
      </div>
    </div>
  );
}

function PreviewHeader({
  file,
  cat,
  view,
  page,
  setPage,
}: {
  file: FileItem;
  cat: Category;
  view: View;
  page: number;
  setPage: (n: number) => void;
}) {
  const table = view.kind === "table" ? view.data : null;
  const totalPages =
    cat === "parquet" && table
      ? Math.max(1, Math.ceil(table.totalRows / PARQUET_PAGE_SIZE))
      : 1;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-3 sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium" title={file.key}>
            {basename(file.key)}
          </span>
          <Badge variant="outline" className="shrink-0 font-mono tracking-wide uppercase">
            {cat}
          </Badge>
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
          {file.key}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
        {table && (
          <span className="font-mono">
            {table.totalRows.toLocaleString()} rows
            {table.columns.length ? ` × ${table.columns.length} cols` : ""}
          </span>
        )}
        <span className="font-mono">{formatBytes(file.size)}</span>
        <span className="hidden font-mono sm:inline">
          {formatDate(file.lastModified)}
        </span>
        <DownloadButton
          url={objectUrl(file.key, { download: true })}
          className={cn(buttonVariants({ size: "sm" }))}
        >
          <Download />
          Download
        </DownloadButton>
      </div>

      {cat === "parquet" && table && (
        <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
          <Button
            variant="outline"
            size="xs"
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
          >
            <ChevronLeft />
            Prev
          </Button>
          <span className="font-mono">
            Page {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
            <ChevronRight />
          </Button>
          <span className="text-muted-foreground/70">
            rows {page * PARQUET_PAGE_SIZE + 1}–
            {Math.min((page + 1) * PARQUET_PAGE_SIZE, table.totalRows)}
          </span>
        </div>
      )}
    </div>
  );
}

function TruncatedBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b bg-muted px-4 py-1.5 text-xs text-amber-600 dark:text-amber-500">
      {children}
    </div>
  );
}

function PreviewBody({
  file,
  cat,
  isDirect,
  view,
}: {
  file: FileItem;
  cat: Category;
  isDirect: boolean;
  view: View;
}) {
  if (isDirect) {
    const url = objectUrl(file.key);
    if (cat === "image")
      return (
        <div className="flex h-full items-center justify-center overflow-auto bg-muted p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={file.key} className="max-h-full max-w-full object-contain" />
        </div>
      );
    if (cat === "pdf")
      return <iframe src={url} className="h-full w-full bg-white" title={file.key} />;
    if (cat === "audio")
      return (
        <div className="flex h-full items-center justify-center bg-muted p-6">
          <audio
            controls
            controlsList="nodownload noplaybackrate"
            onContextMenu={(e) => e.preventDefault()}
            src={url}
            className="w-full max-w-xl"
          />
        </div>
      );
    if (cat === "video")
      return (
        <div className="flex h-full items-center justify-center bg-black p-6">
          <video
            controls
            controlsList="nodownload noremoteplayback noplaybackrate"
            disablePictureInPicture
            onContextMenu={(e) => e.preventDefault()}
            src={url}
            className="max-h-full max-w-full"
          />
        </div>
      );
  }

  if (view.kind === "loading")
    return <div className="p-6 text-sm text-muted-foreground">Loading preview…</div>;

  if (view.kind === "error")
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{view.message}</AlertDescription>
        </Alert>
      </div>
    );

  if (view.kind === "table") {
    return (
      <div className="flex h-full flex-col">
        {view.data.truncated && (
          <TruncatedBanner>
            Showing a preview subset — the full file has more data.
          </TruncatedBanner>
        )}
        <div className="min-h-0 flex-1">
          <DataTable columns={view.data.columns} rows={view.data.rows} />
        </div>
      </div>
    );
  }

  if (view.kind === "text")
    return (
      <div className="flex h-full flex-col">
        {view.truncated && (
          <TruncatedBanner>
            Truncated to the first {formatBytes(TEXT_CAP)}.
          </TruncatedBanner>
        )}
        <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[13px] leading-relaxed whitespace-pre text-foreground">
          {view.text}
        </pre>
      </div>
    );

  // Unknown/binary type
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <FileQuestion className="size-10 opacity-40" />
      <p className="text-sm">No inline preview for this file type.</p>
      <DownloadButton
        url={objectUrl(file.key, { download: true })}
        className={cn(buttonVariants({ size: "sm" }))}
      >
        <Download />
        Download {basename(file.key)}
      </DownloadButton>
    </div>
  );
}
