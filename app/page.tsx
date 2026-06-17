"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Database, LogOut } from "lucide-react";
import type { FileItem } from "@/lib/types";
import { FileBrowser } from "@/components/FileBrowser";
import { Preview } from "@/components/Preview";
import { ModeToggle } from "@/components/mode-toggle";
import { AuthGate } from "@/components/AuthGate";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const BUCKET = process.env.NEXT_PUBLIC_R2_BUCKET ?? "neuro-awign-approved";

function Breadcrumbs({
  prefix,
  onNavigate,
}: {
  prefix: string;
  onNavigate: (prefix: string) => void;
}) {
  const segments = prefix.split("/").filter(Boolean);
  let acc = "";
  return (
    <nav className="flex w-max items-center gap-1 text-sm whitespace-nowrap">
      <button
        onClick={() => onNavigate("")}
        className="shrink-0 cursor-pointer font-mono font-medium text-foreground hover:text-foreground/70"
      >
        {BUCKET}
      </button>
      {segments.map((seg) => {
        acc += `${seg}/`;
        const target = acc;
        return (
          <span key={target} className="flex shrink-0 items-center gap-1">
            <span className="text-muted-foreground/50">/</span>
            <button
              onClick={() => onNavigate(target)}
              className="cursor-pointer text-muted-foreground hover:text-foreground"
            >
              {seg}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.reload();
}

export default function Home() {
  const [prefix, setPrefix] = useState("");
  const [selected, setSelected] = useState<FileItem | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const isMobile = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px)").matches;

  function handleSelect(file: FileItem) {
    setSelected(file);
    // On phones the expanded sidebar overlays content — collapse to the rail
    // so the preview is visible.
    if (isMobile()) setCollapsed(true);
  }

  return (
    <AuthGate>
      <div className="flex h-full flex-col bg-background text-foreground">
        <header className="flex items-center gap-2 border-b px-3 py-2.5 sm:gap-4 sm:px-4">
          <div className="flex shrink-0 items-center gap-2">
            <Database className="size-4 text-muted-foreground" />
            <h1 className="text-sm font-semibold tracking-tight">
              Dataset Viewer
            </h1>
          </div>

          <div className="hidden h-5 w-px shrink-0 bg-border sm:block" />

          <div className="min-w-0 flex-1 overflow-x-auto">
            <Breadcrumbs prefix={prefix} onNavigate={setPrefix} />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <ModeToggle />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Log out"
              title="Log out"
              onClick={logout}
            >
              <LogOut />
            </Button>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          {/* Backdrop (mobile only) when the sidebar is expanded as an overlay */}
          {!collapsed && (
            <div
              className="absolute inset-0 z-30 bg-black/50 md:hidden"
              onClick={() => setCollapsed(true)}
              aria-hidden
            />
          )}

          <aside
            className={cn(
              "relative z-40 flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out",
              collapsed
                ? "w-14"
                : "w-72 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:shadow-xl",
            )}
          >
            {/* Collapse / expand handle on the sidebar edge */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={() => setCollapsed((v) => !v)}
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    className="absolute -right-3 top-3 z-50 flex size-6 cursor-pointer items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                  />
                }
              >
                {collapsed ? (
                  <ChevronRight className="size-3.5" />
                ) : (
                  <ChevronLeft className="size-3.5" />
                )}
              </TooltipTrigger>
              <TooltipContent side="right">
                {collapsed ? "Expand sidebar" : "Collapse sidebar"}
              </TooltipContent>
            </Tooltip>

            <FileBrowser
              prefix={prefix}
              onNavigate={setPrefix}
              selectedKey={selected?.key ?? null}
              onSelect={handleSelect}
              collapsed={collapsed}
              onExpand={() => setCollapsed(false)}
            />
          </aside>

          <main className="min-w-0 flex-1">
            <Preview file={selected} />
          </main>
        </div>
      </div>
    </AuthGate>
  );
}
