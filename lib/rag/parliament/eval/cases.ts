/**
 * RAG Evaluation Test Cases
 *
 * Each case defines a query and describes what the retrieved context
 * should contain. The LLM judge evaluates whether the context would
 * allow correctly answering the query.
 */

export type EvalCase = {
  /** Unique identifier for the test case */
  id: string;
  /** The user query to test */
  query: string;
  /** Description of what the retrieved context should contain */
  expectedOutput: string;
  /** Optional: expected source types in results */
  expectedSources?: string[];
  /** Optional: specific terms that should appear in context */
  mustMention?: string[];
  /** Optional: language of the query */
  language?: "en" | "fr";
};

/**
 * Evaluation test cases covering different source types and query patterns
 */
export const evalCases: EvalCase[] = [
  // Bills
  {
    id: "bill-c11-about",
    query: "What is Bill C-11 about?",
    expectedOutput:
      "Should mention online streaming, broadcasting, CRTC regulation, digital platforms",
    expectedSources: ["bill"],
    mustMention: ["C-11"],
  },
  {
    id: "bill-c35-childcare",
    query: "What does Bill C-35 do for childcare?",
    expectedOutput:
      "Should mention Canada-wide childcare, affordability, early learning, provincial agreements",
    expectedSources: ["bill"],
    mustMention: ["C-35", "childcare"],
  },

  // Hansard / Debates
  {
    id: "hansard-carbon-tax",
    query: "What have MPs said about the carbon tax in debates?",
    expectedOutput:
      "Should include debate excerpts, MP names, arguments for/against carbon pricing",
    expectedSources: ["hansard"],
  },
  {
    id: "hansard-housing",
    query: "What has been debated about housing affordability?",
    expectedOutput:
      "Should include housing crisis discussion, policy proposals, MP speeches",
    expectedSources: ["hansard"],
  },

  // Votes
  {
    id: "votes-bill-c11",
    query: "How did MPs vote on Bill C-11?",
    expectedOutput:
      "Should include vote results, party positions, yeas/nays, vote date",
    expectedSources: ["vote_question", "vote_party"],
    mustMention: ["C-11"],
  },
  {
    id: "votes-conservative-position",
    query: "How have Conservatives voted on environmental bills?",
    expectedOutput:
      "Should include Conservative voting patterns on environmental legislation",
    expectedSources: ["vote_party", "vote_member"],
  },

  // Politicians
  {
    id: "politician-trudeau",
    query: "Who is Justin Trudeau?",
    expectedOutput:
      "Should include role as PM, party affiliation (Liberal), riding (Papineau), time in office",
    expectedSources: ["politician"],
    mustMention: ["Trudeau", "Liberal"],
  },
  {
    id: "politician-poilievre",
    query: "What is Pierre Poilievre's role in parliament?",
    expectedOutput:
      "Should include role as Conservative leader, Opposition leader, riding",
    expectedSources: ["politician"],
    mustMention: ["Poilievre", "Conservative"],
  },

  // Committees
  {
    id: "committee-finance",
    query: "What does the Finance Committee do?",
    expectedOutput:
      "Should describe committee mandate, recent work, membership or chair",
    expectedSources: ["committee", "committee_report", "committee_meeting"],
  },

  // Parties
  {
    id: "party-ndp",
    query: "What is the NDP's position in parliament?",
    expectedOutput:
      "Should include party status, leader (Jagmeet Singh), seat count, key policies",
    expectedSources: ["party", "politician"],
    mustMention: ["NDP"],
  },

  // Elections
  {
    id: "election-2021",
    query: "What happened in the 2021 federal election?",
    expectedOutput:
      "Should include election date, results, winning party, seat distribution",
    expectedSources: ["election", "candidacy"],
    mustMention: ["2021"],
  },

  // Ridings
  {
    id: "riding-papineau",
    query: "Who represents Papineau?",
    expectedOutput:
      "Should identify the MP for Papineau, party affiliation, basic riding info",
    expectedSources: ["riding", "politician"],
    mustMention: ["Papineau"],
  },

  // Sessions
  {
    id: "session-current",
    query: "When did the current parliamentary session start?",
    expectedOutput:
      "Should include session number (e.g., 44-1), start date, parliament number",
    expectedSources: ["session"],
  },

  // French queries
  {
    id: "french-bill-c11",
    query: "Qu'est-ce que le projet de loi C-11?",
    expectedOutput:
      "Devrait mentionner la diffusion en ligne, la radiodiffusion, le CRTC",
    expectedSources: ["bill"],
    mustMention: ["C-11"],
    language: "fr",
  },
  {
    id: "french-pm",
    query: "Qui est le premier ministre du Canada?",
    expectedOutput:
      "Devrait identifier le premier ministre, son parti, sa circonscription",
    expectedSources: ["politician"],
    language: "fr",
  },

  // Complex queries (multiple sources)
  {
    id: "complex-climate-policy",
    query:
      "What legislation has parliament passed on climate change and how did parties vote?",
    expectedOutput:
      "Should include climate-related bills, voting records by party, debate highlights",
    expectedSources: ["bill", "vote_question", "hansard"],
  },
];

/**
 * Get a subset of cases by source type
 */
export function getCasesBySource(sourceType: string): EvalCase[] {
  return evalCases.filter((c) => c.expectedSources?.includes(sourceType));
}

/**
 * Get a specific case by ID
 */
export function getCaseById(id: string): EvalCase | undefined {
  return evalCases.find((c) => c.id === id);
}
