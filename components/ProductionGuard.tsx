"use client";

import { useEffect } from "react";

/**
 * Best-effort deterrents against casual inspection, active only in production.
 *
 * NOTE: These cannot truly prevent DevTools or hide network traffic — a
 * determined user can disable JavaScript, use a proxy (mitmproxy/Charles), or
 * call the API with curl. The real protection is that no secrets are ever sent
 * to the client (R2 credentials stay server-side). Treat this as friction, not
 * security.
 */
export function ProductionGuard() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const blocked =
        e.key === "F12" || // DevTools
        ((e.ctrlKey || e.metaKey) &&
          e.shiftKey &&
          (k === "i" || k === "j" || k === "c")) || // DevTools / inspect / console
        ((e.ctrlKey || e.metaKey) && k === "u"); // view-source
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown, true);

    // Self-XSS style warning for anyone who opens the console anyway.
    try {
      console.log(
        "%cStop!",
        "color:#dc2626;font-size:32px;font-weight:bold;",
      );
      console.log(
        "%cThis is a browser feature intended for developers. Content here is not meant to be inspected.",
        "font-size:14px;",
      );
    } catch {
      // ignore
    }

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return null;
}
