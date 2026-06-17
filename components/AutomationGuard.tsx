"use client";

import { useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { detectAutomation } from "@/lib/detect-automation";

/**
 * Blocks default browser-automation (Selenium / Puppeteer / Playwright /
 * PhantomJS / Nightmare / Cypress) by gating rendering: if automation
 * fingerprints are present, the app (and its data fetches) never mount and a
 * denial screen is shown instead. Also best-effort revokes the session.
 *
 * NOTE: stealth-patched automation (puppeteer-extra-stealth,
 * undetected-chromedriver, playwright-stealth) is designed to hide these
 * signals and can still get through. This stops naive/default automation, not
 * a determined evader.
 */
export function AutomationGuard({ children }: { children: React.ReactNode }) {
  const [blocked, setBlocked] = useState<boolean | null>(null);

  useEffect(() => {
    const signals = detectAutomation();
    if (signals.length > 0) {
      setBlocked(true);
      // Revoke any existing session so the data APIs are denied too.
      try {
        fetch("/api/auth/logout", { method: "POST", keepalive: true });
      } catch {
        // ignore
      }
    } else {
      setBlocked(false);
    }
  }, []);

  // While checking, render nothing — content must not load under automation.
  if (blocked === null) return null;

  if (blocked) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
        <Ban className="size-10 text-destructive" />
        <h1 className="text-lg font-semibold">Automated access blocked</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This application can&apos;t be accessed with browser automation or
          headless tools.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
