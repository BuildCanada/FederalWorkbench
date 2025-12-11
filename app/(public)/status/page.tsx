import { Streamdown } from "streamdown";
import { WorkbenchHeader } from "@/components/workbench-header";

type StatusLevel = "operational" | "degraded" | "outage";

type StatusEntry = {
  date: string;
  message: string;
  level: StatusLevel;
};

/**
 * Status entry
 */
const STATUS_ENTRIES: StatusEntry[] = [
  {
    date: "2025-12-10",
    message: `
* ✅ Legislation system enabled
* ⚠️ Parliament system disabled and under active development
`,
    level: "operational",
  },
];

const STATUS_CONFIG: Record<
  StatusLevel,
  { label: string; color: string; bg: string; border: string }
> = {
  operational: {
    label: "Operational",
    color: "text-emerald-700 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "border-emerald-200 dark:border-emerald-800",
  },
  degraded: {
    label: "Degraded",
    color: "text-amber-700 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
  },
  outage: {
    label: "Outage",
    color: "text-red-700 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-200 dark:border-red-800",
  },
};

function StatusIndicator({ level }: { level: StatusLevel }) {
  const config = STATUS_CONFIG[level];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium text-xs ${config.bg} ${config.color}`}
    >
      <span
        className={`size-1.5 rounded-full ${
          level === "operational"
            ? "bg-emerald-500"
            : level === "degraded"
              ? "bg-amber-500"
              : "bg-red-500"
        }`}
      />
      {config.label}
    </span>
  );
}

export default function StatusPage() {
  const currentStatus = STATUS_ENTRIES[0];

  return (
    <div className="min-h-dvh bg-zinc-50 dark:bg-zinc-950">
      <div className="border-b bg-background px-4 py-3">
        <WorkbenchHeader />
      </div>
      <div className="mx-auto max-w-2xl px-4 py-16">
        <header className="mb-12 text-center">
          <h1 className="font-semibold text-3xl text-zinc-900 dark:text-zinc-100">
            System Status
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Current status of Federal Workbench
          </p>
        </header>

        {currentStatus && (
          <div
            className={`mb-8 rounded-lg border p-6 ${STATUS_CONFIG[currentStatus.level].bg} ${STATUS_CONFIG[currentStatus.level].border}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                Current Status
              </span>
              <StatusIndicator level={currentStatus.level} />
            </div>
            <div className="mt-2 text-zinc-700 dark:text-zinc-300">
              <Streamdown>{currentStatus.message}</Streamdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
