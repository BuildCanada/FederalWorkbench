import {
  Building2,
  ChevronDown,
  ExternalLink,
  Languages,
  Scale,
  Sparkles,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { FadeIn } from "@/components/fade-in";
import heroEn from "@/docs/images/readme-hero-en.png";
import heroFr from "@/docs/images/readme-hero-fr.png";

const features = [
  {
    Icon: Building2,
    title: "Parliament Records",
    description:
      "Access Hansard transcripts, committee reports, voting records, and bills from the House of Commons and Senate.",
  },
  {
    Icon: Scale,
    title: "Federal Legislation",
    description:
      "Browse and search federal acts and regulations with full-text content and structured navigation.",
  },
  {
    Icon: Sparkles,
    title: "AI-Powered Search",
    description:
      "Retrieval augmented generation delivers accurate, sourced answers from parliamentary and legislative data.",
  },
  {
    Icon: Languages,
    title: "Bilingual",
    description:
      "Full English and French language support reflecting Canada's official bilingual commitment.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh">
      {/* Hero */}
      <section className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          <div className="-right-32 -top-32 absolute h-[600px] w-[600px] rounded-full bg-red-500/5 blur-[100px] dark:bg-red-500/10" />
          <div className="-bottom-32 -left-32 absolute h-[500px] w-[500px] rounded-full bg-blue-900/5 blur-[100px] dark:bg-blue-400/5" />
        </div>

        <div className="relative z-10 flex max-w-4xl flex-col items-center text-center">
          <FadeIn>
            <h1 className="font-bold text-3xl leading-[1.1] tracking-tight sm:text-5xl lg:text-7xl">
              Federal Parliament
              <br />
              <span className="amp text-red-600 dark:text-red-500">&</span>{" "}
              Legislation Workbench
            </h1>
          </FadeIn>

          <FadeIn delay={0.15}>
            <p className="mt-8 max-w-xl text-lg text-muted-foreground leading-relaxed">
              AI-powered search across Canadian parliamentary records and
              federal legislation. Accurate, sourced, bilingual.
            </p>
          </FadeIn>

          <FadeIn delay={0.3}>
            <div className="mt-10">
              <Link
                className="inline-flex h-14 items-center rounded-lg bg-foreground px-12 font-semibold text-background text-base transition-opacity hover:opacity-90"
                href="/workbench"
              >
                Open Workbench
              </Link>
            </div>
          </FadeIn>
        </div>

        <div className="absolute bottom-8 animate-bounce text-muted-foreground">
          <ChevronDown className="h-5 w-5" />
        </div>
      </section>

      {/* Features */}
      <section className="border-border border-t px-6 py-24 lg:py-32">
        <div className="mx-auto max-w-6xl">
          <FadeIn>
            <h2 className="mb-4 text-center font-bold text-3xl tracking-tight sm:text-4xl">
              Built for Canadian civic data
            </h2>
          </FadeIn>

          <FadeIn delay={0.1}>
            <p className="mx-auto mb-16 max-w-2xl text-center text-muted-foreground">
              Two comprehensive RAG systems provide intelligent access to
              parliamentary proceedings and federal legislation.
            </p>
          </FadeIn>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ Icon, title, description }, i) => (
              <FadeIn className="h-full" delay={i * 0.1} key={title}>
                <div className="group h-full rounded-xl border border-border bg-card p-6 transition-all hover:border-red-500/30 hover:shadow-lg hover:shadow-red-500/5">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-400">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mb-2 font-semibold">{title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {description}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Preview */}
      <section className="border-border border-t bg-muted/40 px-6 py-24 lg:py-32">
        <div className="mx-auto max-w-6xl">
          <FadeIn>
            <h2 className="mb-4 text-center font-bold text-3xl tracking-tight sm:text-4xl">
              See it in action
            </h2>
          </FadeIn>

          <FadeIn delay={0.1}>
            <p className="mx-auto mb-16 max-w-2xl text-center text-muted-foreground">
              A chat-driven workbench with an integrated legislation viewer,
              available in English and French.
            </p>
          </FadeIn>

          <div className="grid gap-8 md:grid-cols-2">
            <FadeIn delay={0.1} direction="left">
              <div className="overflow-hidden rounded-xl border border-border shadow-2xl shadow-black/5 dark:shadow-black/20">
                <Image
                  alt="Workbench interface showing legislation viewer and AI chat in English"
                  className="w-full"
                  placeholder="blur"
                  sizes="(max-width: 768px) 100vw, 50vw"
                  src={heroEn}
                />
              </div>
              <p className="mt-3 text-center text-muted-foreground text-sm">
                English
              </p>
            </FadeIn>

            <FadeIn delay={0.2} direction="right">
              <div className="overflow-hidden rounded-xl border border-border shadow-2xl shadow-black/5 dark:shadow-black/20">
                <Image
                  alt="Interface du workbench montrant le visualiseur de législation et le chat IA en français"
                  className="w-full"
                  placeholder="blur"
                  sizes="(max-width: 768px) 100vw, 50vw"
                  src={heroFr}
                />
              </div>
              <p className="mt-3 text-center text-muted-foreground text-sm">
                Français
              </p>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Data Sources */}
      <section className="border-border border-t px-6 py-24 lg:py-32">
        <div className="mx-auto max-w-4xl">
          <FadeIn>
            <h2 className="mb-4 text-center font-bold text-3xl tracking-tight sm:text-4xl">
              Powered by open data
            </h2>
          </FadeIn>

          <FadeIn delay={0.1}>
            <p className="mx-auto mb-12 max-w-2xl text-center text-muted-foreground">
              Built on publicly available Canadian government data sources.
            </p>
          </FadeIn>

          <div className="grid gap-6 sm:grid-cols-2">
            <FadeIn delay={0.1}>
              <a
                className="group flex flex-col rounded-xl border border-border p-6 transition-all hover:border-foreground/20 hover:shadow-lg"
                href="https://openparliament.ca/data-download/"
                rel="noopener noreferrer"
                target="_blank"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">Open Parliament</h3>
                  <ExternalLink className="group-hover:-translate-y-0.5 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Hansard transcripts, votes, bills, committees, and politician
                  data from the Canadian House of Commons.
                </p>
              </a>
            </FadeIn>

            <FadeIn delay={0.2}>
              <a
                className="group flex flex-col rounded-xl border border-border p-6 transition-all hover:border-foreground/20 hover:shadow-lg"
                href="https://github.com/justicecanada/laws-lois-xml"
                rel="noopener noreferrer"
                target="_blank"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">Justice Canada</h3>
                  <ExternalLink className="group-hover:-translate-y-0.5 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Federal acts and regulations in XML format from the Department
                  of Justice Canada.
                </p>
              </a>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-border border-t px-6 py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 text-center text-muted-foreground text-sm">
          <p>
            A{" "}
            <a
              className="underline underline-offset-4 transition-colors hover:text-foreground"
              href="https://shawnprice.com"
              rel="noopener noreferrer"
              target="_blank"
            >
              Shawn Price
            </a>{" "}
            <span className="amp">&</span>{" "}
            <a
              className="underline underline-offset-4 transition-colors hover:text-foreground"
              href="https://buildcanada.com"
              rel="noopener noreferrer"
              target="_blank"
            >
              Build Canada
            </a>{" "}
            joint
          </p>
          <p className="text-xs">
            Submitted to the{" "}
            <a
              className="underline underline-offset-4 transition-colors hover:text-foreground"
              href="https://impact.canada.ca/en/challenges/g7-govAI"
              rel="noopener noreferrer"
              target="_blank"
            >
              G7 GovAI Grand Challenge
            </a>{" "}
            · December 2, 2025
          </p>
        </div>
      </footer>
    </div>
  );
}
