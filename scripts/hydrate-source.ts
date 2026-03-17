/**
 * Hydrate Source - Preview parliament data as formatted Markdown
 *
 * This script fetches data from the parliament database and formats it as
 * readable Markdown. Use it to preview how source data will appear when
 * hydrated for the RAG system.
 *
 * ============================================================================
 * INVOCATION
 * ============================================================================
 *
 *   npx tsx scripts/hydrate-source.ts --source=<type> [options] --lang=<en|fr>
 *
 * ============================================================================
 * REQUIRED FLAGS
 * ============================================================================
 *
 *   --source=<type>   The type of source to hydrate (see SOURCE TYPES below)
 *   --lang=<en|fr>    Language preference (default: en)
 *
 * ============================================================================
 * SOURCE TYPES AND THEIR REQUIRED OPTIONS
 * ============================================================================
 *
 * bill - Full bill text and metadata
 *   Required: --bill=<number> --parliament=<num> --session=<num>
 *   Example:  --source=bill --bill=C-35 --parliament=44 --session=1
 *
 * hansard - Single Hansard statement (debate transcript)
 *   Required: --id=<statement_id>
 *   Example:  --source=hansard --id=12345
 *
 * vote_question - A vote question with party breakdown
 *   Required: --id=<vote_question_id>
 *   Example:  --source=vote_question --id=456
 *
 * vote_party - How a party voted on a specific vote
 *   Required: --id=<party_vote_id>
 *   Example:  --source=vote_party --id=789
 *
 * vote_member - How an individual MP voted
 *   Required: --id=<member_vote_id>
 *   Example:  --source=vote_member --id=101
 *
 * politician - Politician profile with roles
 *   Required: --id=<politician_id> OR --slug=<slug>
 *   Example:  --source=politician --slug=justin-trudeau
 *   Example:  --source=politician --id=2345
 *
 * party - Political party info
 *   Required: --id=<party_id> OR --slug=<slug>
 *   Example:  --source=party --slug=liberal
 *
 * riding - Electoral riding with current/past MPs
 *   Required: --id=<riding_id> OR --slug=<slug>
 *   Example:  --source=riding --slug=ottawa-centre
 *
 * session - Parliamentary session overview
 *   Required: --session-id=<id> (format: parliament-session, e.g., 44-1)
 *   Example:  --source=session --session-id=44-1
 *
 * committee - Committee info with recent reports/meetings
 *   Required: --id=<committee_id> OR --slug=<slug>
 *   Example:  --source=committee --slug=FINA
 *
 * committee_report - Individual committee report
 *   Required: --id=<report_id>
 *   Example:  --source=committee_report --id=234
 *
 * committee_meeting - Individual committee meeting
 *   Required: --id=<meeting_id>
 *   Example:  --source=committee_meeting --id=567
 *
 * election - Election results
 *   Required: --id=<election_id>
 *   Example:  --source=election --id=89
 *
 * candidacy - Individual election candidacy
 *   Required: --id=<candidacy_id>
 *   Example:  --source=candidacy --id=1234
 *
 * ============================================================================
 * FULL EXAMPLES
 * ============================================================================
 *
 *   # Preview Bill C-35 from 44th Parliament, 1st Session in English
 *   npx tsx scripts/hydrate-source.ts --source=bill --bill=C-35 --parliament=44 --session=1 --lang=en
 *
 *   # Preview a politician by slug in French
 *   npx tsx scripts/hydrate-source.ts --source=politician --slug=justin-trudeau --lang=fr
 *
 *   # Preview session 44-1
 *   npx tsx scripts/hydrate-source.ts --source=session --session-id=44-1
 *
 *   # Preview a committee by slug
 *   npx tsx scripts/hydrate-source.ts --source=committee --slug=FINA
 *
 * ============================================================================
 * OUTPUT
 * ============================================================================
 *
 * The script outputs:
 *   1. Source type and language being used
 *   2. Any notes about language fallback
 *   3. A preview of the first 2000 characters of the generated Markdown
 *
 * Exit codes:
 *   0 - Success
 *   1 - Error (missing flags, not found, etc.)
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { getHydratedBillMarkdown } from "@/lib/rag/parliament/sources/bills/hydrate";
import {
  getHydratedCommitteeInfo,
  getHydratedCommitteeMeeting,
  getHydratedCommitteeReport,
} from "@/lib/rag/parliament/sources/committees/hydrate";
import {
  getHydratedCandidacy,
  getHydratedElectionResults,
} from "@/lib/rag/parliament/sources/elections/hydrate";
import { getHydratedHansardStatement } from "@/lib/rag/parliament/sources/hansard/hydrate";
import { getHydratedPartyInfo } from "@/lib/rag/parliament/sources/parties/hydrate";
import { getHydratedPoliticianProfile } from "@/lib/rag/parliament/sources/politicians/hydrate";
import { getHydratedRidingInfo } from "@/lib/rag/parliament/sources/ridings/hydrate";
import { getHydratedSessionOverview } from "@/lib/rag/parliament/sources/sessions/hydrate";
import {
  getHydratedMemberVote,
  getHydratedPartyVote,
  getHydratedVoteQuestion,
} from "@/lib/rag/parliament/sources/votes/hydrate";

const SOURCE_TYPES = [
  "bill",
  "hansard",
  "vote_question",
  "vote_party",
  "vote_member",
  "politician",
  "party",
  "riding",
  "session",
  "committee",
  "committee_report",
  "committee_meeting",
  "election",
  "candidacy",
] as const;

type SourceType = (typeof SOURCE_TYPES)[number];

const args = process.argv.slice(2);

function readOptValue(name: string): string | undefined {
  const withEq = args.find((a) => a.startsWith(`--${name}=`));
  if (withEq) {
    return withEq.split("=")[1];
  }
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length) {
    const val = args[idx + 1];
    if (!val.startsWith("-")) {
      return val;
    }
  }
  return;
}

function printUsage(): void {
  console.log(`
Usage: npx tsx scripts/hydrate-source.ts --source=<type> [options]

Required:
  --source=<type>   Source type (see below)
  --lang=<en|fr>    Language preference (default: en)

Source types and their options:

  bill              Bill text and metadata
    --bill=<number>       Bill number (e.g., C-2)
    --parliament=<num>    Parliament number (e.g., 44)
    --session=<num>       Session number (e.g., 1)

  hansard           Hansard statement
    --id=<id>             Statement ID

  vote_question     Vote question with party breakdown
    --id=<id>             Vote question ID

  vote_party        Party vote on a vote question
    --id=<id>             Party vote ID

  vote_member       Individual MP vote
    --id=<id>             Member vote ID

  politician        Politician profile
    --id=<id>             Politician ID
    --slug=<slug>         Or politician slug

  party             Party info
    --id=<id>             Party ID
    --slug=<slug>         Or party slug

  riding            Riding info with MPs
    --id=<id>             Riding ID
    --slug=<slug>         Or riding slug

  session           Session overview
    --session-id=<id>     Session ID (e.g., 44-1)

  committee         Committee info
    --id=<id>             Committee ID
    --slug=<slug>         Or committee slug

  committee_report  Committee report
    --id=<id>             Report ID

  committee_meeting Committee meeting
    --id=<id>             Meeting ID

  election          Election results
    --id=<id>             Election ID

  candidacy         Election candidacy
    --id=<id>             Candidacy ID
`);
}

async function hydrateBill(lang: "en" | "fr"): Promise<string> {
  const bill = readOptValue("bill");
  const parliamentStr = readOptValue("parliament");
  const sessionStr = readOptValue("session");

  if (!bill) {
    throw new Error("Missing required --bill (e.g., --bill=C-2)");
  }
  if (!parliamentStr) {
    throw new Error("Missing required --parliament (e.g., --parliament=44)");
  }
  if (!sessionStr) {
    throw new Error("Missing required --session (e.g., --session=1)");
  }

  const parliament = Number.parseInt(parliamentStr, 10);
  const session = Number.parseInt(sessionStr, 10);

  if (!Number.isFinite(parliament)) {
    throw new Error("Invalid --parliament value");
  }
  if (!Number.isFinite(session)) {
    throw new Error("Invalid --session value");
  }

  console.log(`Bill: ${bill}, Parliament: ${parliament}, Session: ${session}`);

  const result = await getHydratedBillMarkdown({
    billNumber: bill,
    parliament,
    session,
    language: lang,
  });

  if (result.note) {
    console.log(`Note: ${result.note}`);
  }
  console.log(`Resolved language: ${result.languageUsed}`);

  return result.markdown;
}

async function hydrateHansard(lang: "en" | "fr"): Promise<string> {
  const idStr = readOptValue("id");

  if (!idStr) {
    throw new Error("Missing required --id");
  }

  const statementId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(statementId)) {
    throw new Error("Invalid --id value");
  }

  console.log(`Statement ID: ${statementId}`);

  const result = await getHydratedHansardStatement({
    statementId,
    language: lang,
  });

  if (!result) {
    throw new Error(`Hansard statement ${statementId} not found`);
  }

  console.log(`Language used: ${result.languageUsed}`);
  return result.markdown;
}

async function hydrateVoteQuestion(lang: "en" | "fr"): Promise<string> {
  const idStr = readOptValue("id");

  if (!idStr) {
    throw new Error("Missing required --id");
  }

  const voteQuestionId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(voteQuestionId)) {
    throw new Error("Invalid --id value");
  }

  console.log(`Vote Question ID: ${voteQuestionId}`);

  const result = await getHydratedVoteQuestion({
    voteQuestionId,
    language: lang,
  });

  if (!result) {
    throw new Error(`Vote question ${voteQuestionId} not found`);
  }

  console.log(`Language used: ${result.languageUsed}`);
  return result.markdown;
}

async function hydrateVoteParty(lang: "en" | "fr"): Promise<string> {
  const idStr = readOptValue("id");

  if (!idStr) {
    throw new Error("Missing required --id");
  }

  const partyVoteId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(partyVoteId)) {
    throw new Error("Invalid --id value");
  }

  console.log(`Party Vote ID: ${partyVoteId}`);

  const result = await getHydratedPartyVote({
    partyVoteId,
    language: lang,
  });

  if (!result) {
    throw new Error(`Party vote ${partyVoteId} not found`);
  }

  console.log(`Language used: ${result.languageUsed}`);
  return result.markdown;
}

async function hydrateVoteMember(lang: "en" | "fr"): Promise<string> {
  const idStr = readOptValue("id");

  if (!idStr) {
    throw new Error("Missing required --id");
  }

  const memberVoteId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(memberVoteId)) {
    throw new Error("Invalid --id value");
  }

  console.log(`Member Vote ID: ${memberVoteId}`);

  const result = await getHydratedMemberVote({
    memberVoteId,
    language: lang,
  });

  if (!result) {
    throw new Error(`Member vote ${memberVoteId} not found`);
  }

  console.log(`Language used: ${result.languageUsed}`);
  return result.markdown;
}

async function hydratePolitician(lang: "en" | "fr"): Promise<string> {
  const idStr = readOptValue("id");
  const slug = readOptValue("slug");

  if (!idStr && !slug) {
    throw new Error("Requires --id or --slug");
  }

  const politicianId = idStr ? Number.parseInt(idStr, 10) : undefined;

  console.log(
    politicianId ? `Politician ID: ${politicianId}` : `Slug: ${slug}`
  );

  const result = await getHydratedPoliticianProfile({
    politicianId,
    slug,
    language: lang,
  });

  if (!result) {
    throw new Error("Politician not found");
  }

  console.log(`Language used: ${result.languageUsed}`);
  return result.markdown;
}

async function hydrateParty(lang: "en" | "fr"): Promise<string> {
  const idStr = readOptValue("id");
  const slug = readOptValue("slug");

  if (!idStr && !slug) {
    throw new Error("Requires --id or --slug");
  }

  const partyId = idStr ? Number.parseInt(idStr, 10) : undefined;

  console.log(partyId ? `Party ID: ${partyId}` : `Slug: ${slug}`);

  const result = await getHydratedPartyInfo({
    partyId,
    slug,
    language: lang,
  });

  if (!result) {
    throw new Error("Party not found");
  }

  console.log(`Language used: ${result.languageUsed}`);
  return result.markdown;
}

async function hydrateRiding(lang: "en" | "fr"): Promise<string> {
  const idStr = readOptValue("id");
  const slug = readOptValue("slug");

  if (!idStr && !slug) {
    throw new Error("Requires --id or --slug");
  }

  const ridingId = idStr ? Number.parseInt(idStr, 10) : undefined;

  console.log(ridingId ? `Riding ID: ${ridingId}` : `Slug: ${slug}`);

  const result = await getHydratedRidingInfo({
    ridingId,
    slug,
    language: lang,
  });

  if (!result) {
    throw new Error("Riding not found");
  }

  console.log(`Language used: ${result.languageUsed}`);
  return result.markdown;
}

async function hydrateSession(lang: "en" | "fr"): Promise<string> {
  const sessionId = readOptValue("session-id");

  if (!sessionId) {
    throw new Error("Missing required --session-id (e.g., --session-id=44-1)");
  }

  console.log(`Session ID: ${sessionId}`);

  const result = await getHydratedSessionOverview({
    sessionId,
    language: lang,
  });

  if (!result) {
    throw new Error(`Session ${sessionId} not found`);
  }

  console.log(`Language used: ${result.languageUsed}`);
  return result.markdown;
}

async function hydrateCommittee(lang: "en" | "fr"): Promise<string> {
  const idStr = readOptValue("id");
  const slug = readOptValue("slug");

  if (!idStr && !slug) {
    throw new Error("Requires --id or --slug");
  }

  const committeeId = idStr ? Number.parseInt(idStr, 10) : undefined;

  console.log(committeeId ? `Committee ID: ${committeeId}` : `Slug: ${slug}`);

  const result = await getHydratedCommitteeInfo({
    committeeId,
    slug,
    language: lang,
  });

  if (!result) {
    throw new Error("Committee not found");
  }

  console.log(`Language used: ${result.languageUsed}`);
  return result.markdown;
}

async function hydrateCommitteeReport(lang: "en" | "fr"): Promise<string> {
  const idStr = readOptValue("id");

  if (!idStr) {
    throw new Error("Missing required --id");
  }

  const reportId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(reportId)) {
    throw new Error("Invalid --id value");
  }

  console.log(`Report ID: ${reportId}`);

  const result = await getHydratedCommitteeReport({
    reportId,
    language: lang,
  });

  if (!result) {
    throw new Error(`Committee report ${reportId} not found`);
  }

  console.log(`Language used: ${result.languageUsed}`);
  return result.markdown;
}

async function hydrateCommitteeMeeting(lang: "en" | "fr"): Promise<string> {
  const idStr = readOptValue("id");

  if (!idStr) {
    throw new Error("Missing required --id");
  }

  const meetingId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(meetingId)) {
    throw new Error("Invalid --id value");
  }

  console.log(`Meeting ID: ${meetingId}`);

  const result = await getHydratedCommitteeMeeting({
    meetingId,
    language: lang,
  });

  if (!result) {
    throw new Error(`Committee meeting ${meetingId} not found`);
  }

  console.log(`Language used: ${result.languageUsed}`);
  return result.markdown;
}

async function hydrateElection(lang: "en" | "fr"): Promise<string> {
  const idStr = readOptValue("id");

  if (!idStr) {
    throw new Error("Missing required --id");
  }

  const electionId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(electionId)) {
    throw new Error("Invalid --id value");
  }

  console.log(`Election ID: ${electionId}`);

  const result = await getHydratedElectionResults({
    electionId,
    language: lang,
  });

  if (!result) {
    throw new Error(`Election ${electionId} not found`);
  }

  console.log(`Language used: ${result.languageUsed}`);
  return result.markdown;
}

async function hydrateCandidacy(lang: "en" | "fr"): Promise<string> {
  const idStr = readOptValue("id");

  if (!idStr) {
    throw new Error("Missing required --id");
  }

  const candidacyId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(candidacyId)) {
    throw new Error("Invalid --id value");
  }

  console.log(`Candidacy ID: ${candidacyId}`);

  const result = await getHydratedCandidacy({
    candidacyId,
    language: lang,
  });

  if (!result) {
    throw new Error(`Candidacy ${candidacyId} not found`);
  }

  console.log(`Language used: ${result.languageUsed}`);
  return result.markdown;
}

async function main() {
  try {
    const sourceType = readOptValue("source") as SourceType | undefined;
    const lang = (readOptValue("lang") as "en" | "fr") || "en";

    if (!sourceType) {
      console.error("Error: Missing required --source flag\n");
      printUsage();
      process.exit(1);
    }

    if (!SOURCE_TYPES.includes(sourceType)) {
      console.error(`Error: Invalid source type "${sourceType}"`);
      console.error(`Valid types: ${SOURCE_TYPES.join(", ")}\n`);
      printUsage();
      process.exit(1);
    }

    console.log("\n🏛️  Source Hydration Preview");
    console.log(`Source: ${sourceType}`);
    console.log(`Language preference: ${lang}`);
    console.log("");

    let markdown: string;

    switch (sourceType) {
      case "bill":
        markdown = await hydrateBill(lang);
        break;
      case "hansard":
        markdown = await hydrateHansard(lang);
        break;
      case "vote_question":
        markdown = await hydrateVoteQuestion(lang);
        break;
      case "vote_party":
        markdown = await hydrateVoteParty(lang);
        break;
      case "vote_member":
        markdown = await hydrateVoteMember(lang);
        break;
      case "politician":
        markdown = await hydratePolitician(lang);
        break;
      case "party":
        markdown = await hydrateParty(lang);
        break;
      case "riding":
        markdown = await hydrateRiding(lang);
        break;
      case "session":
        markdown = await hydrateSession(lang);
        break;
      case "committee":
        markdown = await hydrateCommittee(lang);
        break;
      case "committee_report":
        markdown = await hydrateCommitteeReport(lang);
        break;
      case "committee_meeting":
        markdown = await hydrateCommitteeMeeting(lang);
        break;
      case "election":
        markdown = await hydrateElection(lang);
        break;
      case "candidacy":
        markdown = await hydrateCandidacy(lang);
        break;
      default:
        throw new Error(`Unhandled source type: ${sourceType}`);
    }

    // Print a safe preview, not the entire content to avoid flooding the console
    const preview = markdown.slice(0, 2000);
    console.log("\n──────── Markdown Preview (first 2000 chars) ────────\n");
    console.log(preview);
    if (markdown.length > 2000) {
      console.log(`\n... (${markdown.length - 2000} more characters)`);
    }
    console.log("\n────────────────────────────────────────────────────");

    process.exit(0);
  } catch (err) {
    console.error("\n❌ Error:", err);
    process.exit(1);
  }
}

main();
