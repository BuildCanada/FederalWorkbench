import debugLib from "debug";

/**
 * Shared RAG debug logger with unified timer.
 *
 * Uses separate namespaces for parliament (rag:parl) and legislation (rag:leg).
 * Sub-namespaces are shown as prefixes in the message.
 *
 * Usage:
 *   import { ragDebug, resetRagTimer } from "@/lib/rag/parliament/debug";
 *   const dbg = ragDebug("parl:search");
 *   dbg("found %d results", 10);  // outputs: rag:parl [search] found 10 results +5ms
 *
 * To reset timer at request start:
 *   resetRagTimer();
 */

// Separate loggers for each RAG system
const ragParl = debugLib("rag:parl");
const ragLeg = debugLib("rag:leg");
const ragRoute = debugLib("rag:route");

/**
 * Create a prefixed debug function.
 * @param namespace - Namespace in format "system:component" (e.g., "parl:search", "leg:retrieve")
 */
export function ragDebug(
  namespace: string
): (formatter: string, ...args: unknown[]) => void {
  // Parse namespace to determine which logger to use
  const [system, ...rest] = namespace.split(":");
  const component = rest.join(":") || system;

  let logger: debugLib.Debugger;
  if (system === "parl") {
    logger = ragParl;
  } else if (system === "leg") {
    logger = ragLeg;
  } else {
    // For non-prefixed namespaces like "route", use route logger
    logger = ragRoute;
  }

  const prefix = `[${component}]`;
  return (formatter: string, ...args: unknown[]) => {
    logger(`${prefix} ${formatter}`, ...args);
  };
}

/**
 * Reset the timer for all rag logs.
 * Call at the start of each request for accurate elapsed times.
 */
export function resetRagTimer(): void {
  ragRoute("--- request start ---");
}
