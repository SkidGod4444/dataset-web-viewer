"use client";

import { useEffect, useState } from "react";
import { File, Folder, Info, Search } from "lucide-react";
import type { FileItem, ListResponse } from "@/lib/types";
import { basename, formatBytes } from "@/lib/format";
import { categoryOf } from "@/lib/mime";
import { CATEGORY_ICON } from "@/lib/icons";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DetailsDialog, type InfoTarget } from "@/components/DetailsDialog";
import { cn } from "@/lib/utils";

function InfoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            onClick={onClick}
            className="mr-1 shrink-0 text-muted-foreground"
          />
        }
      >
        <Info />
      </TooltipTrigger>
      <TooltipContent>Details</TooltipContent>
    </Tooltip>
  );
}

export function FileBrowser({
  prefix,
  onNavigate,
  selectedKey,
  onSelect,
  collapsed = false,
  onExpand,
}: {
  prefix: string;
  onNavigate: (prefix: string) => void;
  selectedKey: string | null;
  onSelect: (file: FileItem) => void;
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [extraFiles, setExtraFiles] = useState<FileItem[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [infoTarget, setInfoTarget] = useState<InfoTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExtraFiles([]);
    const params = new URLSearchParams({ prefix });
    if (recursive) params.set("recursive", "1");
    fetch(`/api/list?${params}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Failed to load");
        return json as ListResponse;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setNextToken(json.nextToken);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [prefix, recursive]);

  async function loadMore() {
    if (!nextToken) return;
    setLoadingMore(true);
    const params = new URLSearchParams({ prefix, token: nextToken });
    if (recursive) params.set("recursive", "1");
    try {
      const r = await fetch(`/api/list?${params}`);
      const json: ListResponse = await r.json();
      if (!r.ok) throw new Error((json as { error?: string }).error);
      setExtraFiles((prev) => [...prev, ...json.files]);
      setNextToken(json.nextToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  const folders = data?.folders ?? [];
  const allFiles = [...(data?.files ?? []), ...extraFiles];
  const q = filter.trim().toLowerCase();
  const filteredFolders = q
    ? folders.filter((f) => f.toLowerCase().includes(q))
    : folders;
  const filteredFiles = q
    ? allFiles.filter((f) => f.key.toLowerCase().includes(q))
    : allFiles;

  // --- Collapsed: a slim icon rail (icons only, names via shadcn tooltip) ---
  if (collapsed) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex justify-center border-b py-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Search and filter"
                  onClick={onExpand}
                  className="text-muted-foreground"
                />
              }
            >
              <Search />
            </TooltipTrigger>
            <TooltipContent side="right">Search &amp; filter</TooltipContent>
          </Tooltip>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {loading ? (
            <div className="flex flex-col items-center gap-1">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="size-9 rounded-md" />
              ))}
            </div>
          ) : (
            <ul className="flex flex-col items-center gap-0.5">
              {folders.map((folder) => (
                <li key={folder}>
                  <Tooltip>
                    <TooltipTrigger
                      aria-label={`${basename(folder)} folder`}
                      onClick={() => onNavigate(folder)}
                      className="flex size-9 cursor-pointer items-center justify-center rounded-md hover:bg-accent"
                    >
                      <Folder className="size-4 text-amber-500" />
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {basename(folder)}/
                    </TooltipContent>
                  </Tooltip>
                </li>
              ))}
              {allFiles.map((file) => {
                const active = file.key === selectedKey;
                const Icon = CATEGORY_ICON[categoryOf(file.key)] ?? File;
                return (
                  <li key={file.key}>
                    <Tooltip>
                      <TooltipTrigger
                        aria-label={basename(file.key)}
                        onClick={() => onSelect(file)}
                        className={cn(
                          "flex size-9 cursor-pointer items-center justify-center rounded-md hover:bg-accent",
                          active && "bg-accent",
                        )}
                      >
                        <Icon
                          className={cn(
                            "size-4",
                            active ? "text-foreground" : "text-muted-foreground",
                          )}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs break-all">
                        {recursive ? file.key : basename(file.key)}
                      </TooltipContent>
                    </Tooltip>
                  </li>
                );
              })}
              {!folders.length && !allFiles.length && (
                <li className="px-1 py-3 text-center text-[10px] text-muted-foreground">
                  Empty
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // --- Expanded: full browser ---
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-3 pr-5">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={recursive ? "Filter all results…" : "Filter this folder…"}
        />
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
          <Checkbox
            checked={recursive}
            onCheckedChange={(checked) => setRecursive(checked === true)}
          />
          Search all subfolders (recursive)
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="space-y-1 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="m-3 w-auto">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && !error && (
          <ul className="py-1">
            {filteredFolders.map((folder) => (
              <li key={folder}>
                <div className="flex items-center border-l-2 border-transparent hover:bg-accent">
                  <button
                    onClick={() => onNavigate(folder)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground"
                  >
                    <Folder className="size-4 shrink-0 text-amber-500" />
                    <span className="truncate">
                      {basename(folder)}
                      <span className="text-muted-foreground/60">/</span>
                    </span>
                  </button>
                  <InfoButton
                    label={`Details for ${basename(folder)}`}
                    onClick={() => setInfoTarget({ kind: "folder", prefix: folder })}
                  />
                </div>
              </li>
            ))}

            {filteredFiles.map((file) => {
              const active = file.key === selectedKey;
              const Icon = CATEGORY_ICON[categoryOf(file.key)] ?? File;
              return (
                <li key={file.key}>
                  <div
                    className={cn(
                      "flex items-center border-l-2",
                      active
                        ? "border-primary bg-accent"
                        : "border-transparent hover:bg-accent",
                    )}
                  >
                    <button
                      onClick={() => onSelect(file)}
                      className={cn(
                        "flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm",
                        active ? "font-medium text-foreground" : "text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {recursive ? file.key : basename(file.key)}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {formatBytes(file.size)}
                      </span>
                    </button>
                    <InfoButton
                      label={`Details for ${basename(file.key)}`}
                      onClick={() => setInfoTarget({ kind: "file", file })}
                    />
                  </div>
                </li>
              );
            })}

            {!filteredFolders.length && !filteredFiles.length && (
              <li className="px-3 py-8 text-center text-sm text-muted-foreground">
                {q ? "No matches." : "Empty folder."}
              </li>
            )}
          </ul>
        )}

        {nextToken && !q && (
          <div className="p-3">
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>

      <DetailsDialog
        target={infoTarget}
        onOpenChange={(open) => !open && setInfoTarget(null)}
      />
    </div>
  );
}
