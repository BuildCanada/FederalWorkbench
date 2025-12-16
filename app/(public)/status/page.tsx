import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WorkbenchHeader } from "@/components/workbench-header";
import {
  type ActWithRegulationCount,
  getLegislationStats,
} from "@/lib/db/legislation/queries";

function StatCard({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-background to-muted/30 p-6">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-muted-foreground text-sm">
          {label}
        </span>
        <span className="font-bold text-4xl tabular-nums tracking-tight">
          {value.toLocaleString()}
        </span>
        <span className="text-muted-foreground text-xs">{description}</span>
      </div>
      <div className="-translate-y-8 absolute top-0 right-0 h-24 w-24 translate-x-8 rounded-full bg-primary/5" />
    </div>
  );
}

function ActCard({ act }: { act: ActWithRegulationCount }) {
  const statusColors = {
    "in-force":
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    repealed: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
    "not-in-force":
      "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  };

  const statusColor =
    statusColors[act.status as keyof typeof statusColors] ??
    statusColors["in-force"];

  const query = encodeURIComponent(`Tell me about the ${act.title}`);

  return (
    <Link href={`/workbench?query=${query}`}>
      <Card className="group h-full transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <Badge className="shrink-0 font-mono text-xs" variant="outline">
              {act.consolidatedNumber}
            </Badge>
            <Badge
              className={`shrink-0 text-xs ${statusColor}`}
              variant="outline"
            >
              {act.status === "in-force" ? "In Force" : act.status}
            </Badge>
          </div>
          <CardTitle className="line-clamp-2 text-base leading-snug transition-colors group-hover:text-primary">
            {act.title}
          </CardTitle>
          {act.runningHead && act.runningHead !== act.title && (
            <CardDescription className="line-clamp-1 text-xs">
              {act.runningHead}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-sm">
            <div className="flex items-center gap-1.5">
              <svg
                className="size-4 text-muted-foreground/70"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="tabular-nums">
                {act.sectionCount.toLocaleString()} sections
              </span>
            </div>
            {act.regulationCount > 0 && (
              <div className="flex items-center gap-1.5">
                <svg
                  className="size-4 text-muted-foreground/70"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="tabular-nums">
                  {act.regulationCount} regulation
                  {act.regulationCount !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function LegislationStatusBanner() {
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/5 via-emerald-500/10 to-emerald-500/5 p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
          <div className="size-3 animate-pulse rounded-full bg-emerald-500" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              Legislation System Operational
            </span>
          </div>
          <p className="text-muted-foreground text-sm">
            A subset of acts and supporting regulations are available for use
            during development.
          </p>
        </div>
      </div>
    </div>
  );
}

function ParliamentStatusBanner() {
  return (
    <div className="rounded-xl border border-amber-500/20 bg-gradient-to-r from-amber-500/5 via-amber-500/10 to-amber-500/5 p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
          <div className="size-3 rounded-full bg-amber-500" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-amber-700 dark:text-amber-400">
              Parliament System Under Development
            </span>
          </div>
          <p className="text-muted-foreground text-sm">
            Parliament data is not yet available. This feature is under active
            development.
          </p>
        </div>
      </div>
    </div>
  );
}

export default async function StatusPage() {
  const stats = await getLegislationStats();

  return (
    <div className="min-h-dvh bg-zinc-50 dark:bg-zinc-950">
      <div className="border-b bg-background px-4 py-3">
        <WorkbenchHeader />
      </div>

      <div className="mx-auto max-w-6xl px-4 py-12">
        {/* Hero Section */}
        <header className="mb-12">
          <div className="mb-8 text-center">
            <h1 className="mb-3 font-bold text-4xl text-zinc-900 tracking-tight sm:text-5xl dark:text-zinc-100">
              System Status
            </h1>
          </div>

          <div className="flex flex-col gap-3">
            <LegislationStatusBanner />
            <ParliamentStatusBanner />
          </div>
        </header>

        {/* Statistics Grid */}
        <section className="mb-12">
          <h2 className="mb-4 font-semibold text-lg text-zinc-900 dark:text-zinc-100">
            Coverage Overview
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              description="Primary legislation"
              label="Federal Acts"
              value={stats.totalActs}
            />
            <StatCard
              description="Supporting regulations"
              label="Regulations"
              value={stats.totalRegulations}
            />
            <StatCard
              description="Searchable provisions"
              label="Total Sections"
              value={stats.totalSections}
            />
          </div>
        </section>

        {/* Acts Grid */}
        <section>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
                Available Legislation
              </h2>
              <p className="text-muted-foreground text-sm">
                Click any act to view its full text and supporting regulations
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stats.acts.map((act) => (
              <ActCard act={act} key={act.actId} />
            ))}
          </div>
        </section>

        {/* Footer Note */}
        <footer className="mt-16 border-t pt-8 text-center">
          <p className="text-muted-foreground text-sm">
            Data sourced from{" "}
            <a
              className="underline underline-offset-2 transition-colors hover:text-foreground"
              href="https://github.com/justicecanada/laws-lois-xml"
              rel="noopener noreferrer"
              target="_blank"
            >
              Justice Canada GitHub
            </a>
            . Consolidated versions as of December 2025.
          </p>
        </footer>
      </div>
    </div>
  );
}
