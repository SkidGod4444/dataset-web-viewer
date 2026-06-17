"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, LogOut, PanelLeft } from "lucide-react";
import type { FileItem } from "@/lib/types";
import { basename } from "@/lib/format";
import { useIsMobile } from "@/hooks/use-mobile";
import { FileBrowser } from "@/components/FileBrowser";
import { Preview } from "@/components/Preview";
import { ModeToggle } from "@/components/mode-toggle";
import { AuthGate } from "@/components/AuthGate";
import { AutomationGuard } from "@/components/AutomationGuard";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  const [collapsed, setCollapsed] = useState(false); // desktop rail
  const [mobileOpen, setMobileOpen] = useState(false); // mobile sheet
  const isMobile = useIsMobile();

  function handleSelect(file: FileItem) {
    setSelected(file);
    if (isMobile) setMobileOpen(false); // reveal the preview behind the sheet
  }

  const currentLabel = prefix ? basename(prefix) : BUCKET;

  const browser = (
    <FileBrowser
      prefix={prefix}
      onNavigate={setPrefix}
      selectedKey={selected?.key ?? null}
      onSelect={handleSelect}
      collapsed={!isMobile && collapsed}
      onExpand={() => setCollapsed(false)}
    />
  );

  return (
    <AutomationGuard>
      <AuthGate>
        <div className="flex h-full flex-col bg-background text-foreground">
        <header className="flex items-center gap-2 border-b px-3 py-2.5 sm:gap-4 sm:px-4">
          <Link
            href="/"
            onClick={() => {
              setPrefix("");
              setSelected(null);
            }}
            className="flex shrink-0 items-center gap-2"
            aria-label="Dataset Viewer — go to home"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Dataset Viewer"
              className="size-6 rounded-[6px]"
            />
            <h1 className="hidden text-sm font-semibold tracking-tight sm:block">
              Dataset Viewer
            </h1>
          </Link>

          {/* Mobile: a single toggle that opens the file browser sheet
              (replaces the long breadcrumb path) */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMobileOpen(true)}
            className="flex min-w-0 flex-1 justify-start gap-2 md:hidden"
          >
            <PanelLeft className="size-4 shrink-0" />
            <span className="truncate font-mono">{currentLabel}</span>
          </Button>

          {/* Desktop: full breadcrumb path */}
          <div className="hidden h-5 w-px shrink-0 bg-border md:block" />
          <div className="hidden min-w-0 flex-1 overflow-x-auto md:block">
            <Breadcrumbs prefix={prefix} onNavigate={setPrefix} />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <ModeToggle />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Log out"
                    onClick={logout}
                  />
                }
              >
                <LogOut />
              </TooltipTrigger>
              <TooltipContent>Log out</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          {isMobile ? (
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetContent side="left" className="flex flex-col gap-0 p-0">
                <SheetHeader className="border-b p-3 pr-12">
                  <SheetTitle className="text-sm">Files</SheetTitle>
                </SheetHeader>
                <div className="min-h-0 flex-1 bg-sidebar text-sidebar-foreground">
                  {browser}
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <aside
              className={cn(
                "relative z-40 flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out",
                collapsed ? "w-14" : "w-72",
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

              {browser}
            </aside>
          )}

          <main className="min-w-0 flex-1">
            <Preview file={selected} />
          </main>
        </div>
        </div>
      </AuthGate>
    </AutomationGuard>
  );
}
