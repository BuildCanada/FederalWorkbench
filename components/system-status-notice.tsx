"use client";

import { XIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "system-status-dismissed";

export function SystemStatusNotice() {
  const [dismissed, setDismissed] = useState(true); // Start hidden to avoid flash

  const showStatus = process.env.NEXT_PUBLIC_SHOW_SYSTEM_STATUS;

  useEffect(() => {
    const wasDismissed = localStorage.getItem(STORAGE_KEY) === "true";
    setDismissed(wasDismissed);
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setDismissed(true);
  };

  if (!showStatus || dismissed) {
    return null;
  }

  return (
    <div className="sticky top-0 z-50 rounded-none border-x-0 border-t-0 border-b bg-red-100/80 py-2 dark:bg-red-950/60">
      <div className="flex items-center justify-center">
        <Link
          className="text-center font-medium text-sm hover:underline"
          href="/status"
        >
          System Status
        </Link>
        <Button
          className="absolute right-2 size-6"
          onClick={handleDismiss}
          size="icon"
          variant="ghost"
        >
          <XIcon className="size-4" />
          <span className="sr-only">Dismiss</span>
        </Button>
      </div>
    </div>
  );
}
