"use client";

import { useEffect, useState } from "react";
import { Database, Loader2, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "in" | "out">("loading");
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((j) => setStatus(j.authed ? "in" : "out"))
      .catch(() => setStatus("out"));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(false);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (r.ok) {
        setStatus("in");
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (status === "in") return <>{children}</>;

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
      >
        <div className="mb-1 flex items-center gap-2">
          <Database className="size-5 text-muted-foreground" />
          <h1 className="text-base font-semibold">Dataset Viewer</h1>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Enter the password to access the datasets.
        </p>
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
          <p className="mt-2 text-sm text-destructive">Incorrect password.</p>
        )}
        <Button
          type="submit"
          disabled={submitting || !pw}
          className="mt-4 w-full"
        >
          {submitting ? <Loader2 className="animate-spin" /> : <Lock />}
          Unlock
        </Button>
      </form>
    </div>
  );
}
