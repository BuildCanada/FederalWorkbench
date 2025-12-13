import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex flex-col items-center gap-10">
        <h1 className="font-medium text-2xl">
          🇨🇦 Federal Parliament <span className="amp">&</span> Legislation
          Workbench
        </h1>
        <Link
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          href="/workbench"
        >
          Use Workbench
        </Link>
      </div>
    </div>
  );
}
