"use client";

import { useEffect, useState } from "react";
import { Folder } from "lucide-react";
import type { FileItem } from "@/lib/types";
import { basename, formatBytes, formatDate } from "@/lib/format";
import { categoryOf } from "@/lib/mime";
import { CATEGORY_ICON } from "@/lib/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export type InfoTarget =
  | { kind: "file"; file: FileItem }
  | { kind: "folder"; prefix: string };

type FileInfo = {
  type: "file";
  contentType: string | null;
  etag: string | null;
  storageClass: string | null;
  metadata: Record<string, string>;
};

type FolderInfo = {
  type: "folder";
  subfolderCount: number;
  immediateFileCount: number;
  immediateFileSize: number;
  hasMore: boolean;
};

// Cache responses (and de-dupe in-flight requests) so reopening is instant.
const cache = new Map<string, Promise<unknown>>();
function fetchJsonCached<T>(url: string): Promise<T> {
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url).then(async (r) => {
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Failed to load details");
      return json as T;
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url)); // allow retry on failure
  }
  return p;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Pending() {
  return <span className="text-muted-foreground/60">Loading…</span>;
}

export function DetailsDialog({
  target,
  onOpenChange,
}: {
  target: InfoTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  // Retain the last target so content stays put during the close animation.
  const [current, setCurrent] = useState<InfoTarget | null>(target);
  const [info, setInfo] = useState<FileInfo | FolderInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) setCurrent(target);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setInfo(null);
    setError(null);

    const url =
      target.kind === "file"
        ? `/api/info?key=${encodeURIComponent(target.file.key)}`
        : `/api/info?prefix=${encodeURIComponent(target.prefix)}`;

    fetchJsonCached<FileInfo | FolderInfo>(url)
      .then((json) => !cancelled && setInfo(json))
      .catch((e) => !cancelled && setError(e.message));

    return () => {
      cancelled = true;
    };
  }, [target]);

  const name =
    current?.kind === "file"
      ? basename(current.file.key)
      : current
        ? basename(current.prefix)
        : "";
  const path =
    current?.kind === "file" ? current.file.key : (current?.prefix ?? "");
  const TitleIcon =
    current?.kind === "file" ? CATEGORY_ICON[categoryOf(current.file.key)] : Folder;

  const fileInfo = info?.type === "file" ? info : null;
  const folderInfo = info?.type === "folder" ? info : null;

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            {TitleIcon && (
              <TitleIcon
                className={
                  current?.kind === "folder"
                    ? "size-4 shrink-0 text-amber-500"
                    : "size-4 shrink-0 text-muted-foreground"
                }
              />
            )}
            <span className="truncate">{name}</span>
          </DialogTitle>
          <DialogDescription className="font-mono break-all">
            {path}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <dl className="text-sm">
            {current?.kind === "file" && (
              <>
                <Row label="Type">
                  <Badge variant="outline" className="font-mono uppercase">
                    {categoryOf(current.file.key)}
                  </Badge>
                </Row>
                <Row label="Size">
                  {formatBytes(current.file.size)}{" "}
                  <span className="text-muted-foreground">
                    ({current.file.size.toLocaleString()} bytes)
                  </span>
                </Row>
                <Row label="Modified">{formatDate(current.file.lastModified)}</Row>
                <Row label="Content-Type">
                  {fileInfo ? (fileInfo.contentType ?? "—") : <Pending />}
                </Row>
                <Row label="Storage">
                  {fileInfo ? (fileInfo.storageClass ?? "STANDARD") : <Pending />}
                </Row>
                <Row label="ETag">
                  {fileInfo ? (
                    <span className="font-mono text-xs break-all">
                      {fileInfo.etag ?? "—"}
                    </span>
                  ) : (
                    <Pending />
                  )}
                </Row>
                {fileInfo && Object.keys(fileInfo.metadata).length > 0 && (
                  <Row label="Metadata">
                    <div className="space-y-0.5">
                      {Object.entries(fileInfo.metadata).map(([k, v]) => (
                        <div key={k} className="font-mono text-xs">
                          <span className="text-muted-foreground">{k}:</span> {v}
                        </div>
                      ))}
                    </div>
                  </Row>
                )}
              </>
            )}

            {current?.kind === "folder" && (
              <>
                <Row label="Type">
                  <Badge variant="outline">folder</Badge>
                </Row>
                {!folderInfo ? (
                  <Row label="Contents">
                    <Pending />
                  </Row>
                ) : folderInfo.subfolderCount === 0 &&
                  folderInfo.immediateFileCount === 0 ? (
                  <Row label="Contents">
                    {folderInfo.hasMore ? <Pending /> : "Empty"}
                  </Row>
                ) : (
                  <>
                    {folderInfo.subfolderCount > 0 && (
                      <Row label="Subfolders">
                        {folderInfo.subfolderCount.toLocaleString()}
                        {folderInfo.hasMore ? "+" : ""}
                      </Row>
                    )}
                    {folderInfo.immediateFileCount > 0 && (
                      <Row label="Files">
                        {folderInfo.immediateFileCount.toLocaleString()}
                        {folderInfo.hasMore ? "+" : ""}{" "}
                        <span className="text-muted-foreground">
                          ({formatBytes(folderInfo.immediateFileSize)}
                          {folderInfo.hasMore ? "+" : ""})
                        </span>
                      </Row>
                    )}
                  </>
                )}
              </>
            )}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}
