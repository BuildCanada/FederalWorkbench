"use client";

import { XIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SystemStatusNotice() {
  const [dismissed, setDismissed] = useState(false);

  const showStatus = process.env.NEXT_PUBLIC_SHOW_SYSTEM_STATUS;

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
          onClick={() => setDismissed(true)}
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
