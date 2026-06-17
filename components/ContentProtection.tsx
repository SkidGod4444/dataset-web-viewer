"use client";

import { useEffect } from "react";

/**
 * Deters MANUAL extraction of file content: blocks copy, cut, drag, and the
 * right-click menu everywhere except inside form fields (so the filter and
 * login inputs keep working). Combined with `user-select: none` in globals.css.
 *
 * NOTE: this does NOT stop browser automation (Playwright/Puppeteer/Selenium)
 * or a determined user — they read the DOM and the network response directly,
 * which no client-side trick can prevent for a viewer that renders the data.
 */
export function ContentProtection() {
  useEffect(() => {
    const isFormField = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };

    const block = (e: Event) => {
      if (isFormField(e.target)) return;
      e.preventDefault();
    };

    document.addEventListener("copy", block);
    document.addEventListener("cut", block);
    document.addEventListener("dragstart", block);
    document.addEventListener("contextmenu", block);

    return () => {
      document.removeEventListener("copy", block);
      document.removeEventListener("cut", block);
      document.removeEventListener("dragstart", block);
      document.removeEventListener("contextmenu", block);
    };
  }, []);

  return null;
}
