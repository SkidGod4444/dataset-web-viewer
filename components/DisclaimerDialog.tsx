"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const DISCLAIMER_ACK_KEY = "neuroscape-disclaimer-ack";

/** Mandatory disclaimer shown once per session after the user is in. */
export function DisclaimerDialog({
  onAcknowledge,
}: {
  onAcknowledge?: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISCLAIMER_ACK_KEY) !== "1") setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  function acknowledge() {
    try {
      sessionStorage.setItem(DISCLAIMER_ACK_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
    onAcknowledge?.();
  }

  return (
    // Controlled + ignore outside/escape dismissal — only "I understand" closes it.
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-amber-500" />
            Confidential — please read
          </DialogTitle>
          <DialogDescription>
            These datasets are the confidential property of{" "}
            <span className="font-medium text-foreground">
              @NEUROSCAPE IMAGING PVT LTD.
            </span>{" "}
            and are provided strictly for authorized use.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            All content displayed here is{" "}
            <span className="font-medium text-foreground">watermarked</span> and
            access is logged.
          </p>
          <p>
            Do not scrape, copy, record, redistribute, or otherwise use these
            datasets without prior written permission. Unauthorized access or
            use is prohibited and may be unlawful.
          </p>
        </div>

        <DialogFooter>
          <Button onClick={acknowledge}>I understand</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
