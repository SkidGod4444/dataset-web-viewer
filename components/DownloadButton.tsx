"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const DOWNLOAD_PASSWORD = "dev1974sai";
// Remembered for the session so the user isn't re-prompted on every download.
let sessionUnlocked = false;

export function DownloadButton({
  url,
  className,
  children,
}: {
  url: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);

  function triggerDownload() {
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function onButtonClick() {
    if (sessionUnlocked) {
      triggerDownload();
      return;
    }
    setPw("");
    setError(false);
    setOpen(true);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw === DOWNLOAD_PASSWORD) {
      sessionUnlocked = true;
      setOpen(false);
      triggerDownload();
    } else {
      setError(true);
    }
  }

  return (
    <>
      <button type="button" onClick={onButtonClick} className={className}>
        {children}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Password required</DialogTitle>
            <DialogDescription>
              Enter the password to download files.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <Input
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => {
                setPw(e.target.value);
                setError(false);
              }}
              placeholder="Password"
            />
            {error && (
              <p className="text-sm text-destructive">Incorrect password.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Download</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
