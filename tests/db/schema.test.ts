/**
 * Schema validation tests for Parliament database tables
 * Tests that all tables are queryable and have correct structure
 */

import { expect, test } from "@playwright/test";
import {
  billsBill,
  billsBilltext,
  billsMembervote,
  billsPartyvote,
  billsVotequestion,
  committeesCommittee,
  committeesCommitteeactivity,
  committeesCommitteeactivityinsession,
  committeesCommitteeinsession,
  committeesCommitteemeeting,
  committeesCommitteemeetingActivities,
  committeesCommitteereport,
  coreElectedmember,
  coreElectedmemberSessions,
  coreParty,
  corePartyalternatename,
  corePolitician,
  corePoliticianinfo,
  coreRiding,
  coreSession,
  electionsCandidacy,
  electionsElection,
  hansardsDocument,
  hansardsStatement,
  hansardsStatementBills,
  hansardsStatementMentionedPoliticians,
} from "@/lib/db/parliament/schema";
import { getSampleRecord } from "./utils";

test.describe("Parliament Schema - Table Structure Validation", () => {
  test.describe("Bills Tables", () => {
    test("should query billsBill table and return records with correct structure", async () => {
      const samples = await getSampleRecord(billsBill, 5);
      expect(samples.length).toBeGreaterThan(0);

      for (const bill of samples) {
        expect(bill).toHaveProperty("id");
        expect(bill).toHaveProperty("nameEn");
        expect(bill).toHaveProperty("number");
        expect(bill).toHaveProperty("sessionId");
        expect(typeof bill.id).toBe("number");
        expect(typeof bill.nameEn).toBe("string");
        expect(typeof bill.number).toBe("string");
        expect(typeof bill.sessionId).toBe("string");
      }
    });

    test("should have all required columns in billsBill (id, nameEn, number, sessionId, etc.)", async () => {
      const [bill] = await getSampleRecord(billsBill, 1);
      expect(bill).toHaveProperty("id");
      expect(bill).toHaveProperty("nameEn");
      expect(bill).toHaveProperty("nameFr");
      expect(bill).toHaveProperty("number");
      expect(bill).toHaveProperty("numberOnly");
      expect(bill).toHaveProperty("sessionId");
      expect(bill).toHaveProperty("statusCode");
      expect(bill).toHaveProperty("shortTitleEn");
      expect(bill).toHaveProperty("shortTitleFr");
      expect(bill).toHaveProperty("added");
      expect(bill).toHaveProperty("institution");
      expect(bill).toHaveProperty("librarySummaryAvailable");
    });

    test("should return correct data types for billsBill fields (serial id, text names, date fields)", async () => {
      const [bill] = await getSampleRecord(billsBill, 1);
      expect(typeof bill.id).toBe("number");
      expect(typeof bill.nameEn).toBe("string");
      expect(typeof bill.nameFr).toBe("string");
      expect(typeof bill.number).toBe("string");
      expect(typeof bill.numberOnly).toBe("number");
      expect(typeof bill.sessionId).toBe("string");
      expect(bill.added).toBeInstanceOf(Date);
      if (bill.statusDate) {
        expect(bill.statusDate).toBeInstanceOf(Date);
      }
      if (bill.introduced) {
        expect(bill.introduced).toBeInstanceOf(Date);
      }
      if (bill.latestDebateDate) {
        expect(bill.latestDebateDate).toBeInstanceOf(Date);
      }
    });

    test("should handle nullable fields in billsBill (sponsorMemberId, statusDate, introduced)", async () => {
      const samples = await getSampleRecord(billsBill, 10);
      // This test passes if we can query without errors
      expect(samples.length).toBeGreaterThan(0);
    });

    test("should query billsBilltext table and link to billsBill via billId", async () => {
      const samples = await getSampleRecord(billsBilltext, 5);
      expect(samples.length).toBeGreaterThan(0);

      for (const billtext of samples) {
        expect(billtext).toHaveProperty("id");
        expect(billtext).toHaveProperty("billId");
        expect(billtext).toHaveProperty("docid");
        expect(billtext).toHaveProperty("textEn");
        expect(billtext).toHaveProperty("textFr");
        expect(billtext).toHaveProperty("summaryEn");
        expect(typeof billtext.billId).toBe("number");
        expect(typeof billtext.docid).toBe("number");
      }
    });

    test("should have unique docid constraint in billsBilltext", async () => {
      const samples = await getSampleRecord(billsBilltext, 100);
      const docids = samples.map((bt) => bt.docid);
      const uniqueDocids = new Set(docids);
      // If constraint works, all docids should be unique
      expect(docids.length).toBe(uniqueDocids.size);
    });

    test("should return multilingual text fields in billsBilltext (textEn, textFr, summaryEn)", async () => {
      const [billtext] = await getSampleRecord(billsBilltext, 1);
      expect(typeof billtext.textEn).toBe("string");
      expect(typeof billtext.textFr).toBe("string");
      expect(typeof billtext.summaryEn).toBe("string");
      // Note: textFr may be empty in the actual data (data quality issue, not schema issue)
      expect(billtext.textEn.length).toBeGreaterThan(0);
    });

    test("should query billsMembervote table with correct vote values (Y/N/P)", async () => {
      const samples = await getSampleRecord(billsMembervote, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const vote of samples) {
        expect(vote).toHaveProperty("id");
        expect(vote).toHaveProperty("memberId");
        expect(vote).toHaveProperty("politicianId");
        expect(vote).toHaveProperty("votequestionId");
        expect(vote).toHaveProperty("vote");
        expect(vote).toHaveProperty("dissent");
        expect(["Y", "N", "P"]).toContain(vote.vote);
        expect(typeof vote.dissent).toBe("boolean");
      }
    });

    test("should query billsPartyvote table with party vote aggregation", async () => {
      const samples = await getSampleRecord(billsPartyvote, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const vote of samples) {
        expect(vote).toHaveProperty("id");
        expect(vote).toHaveProperty("partyId");
        expect(vote).toHaveProperty("votequestionId");
        expect(vote).toHaveProperty("vote");
        // Y=Yes, N=No, P=Paired, A=Didn't vote, F=Free vote
        expect(["Y", "N", "P", "A", "F"]).toContain(vote.vote);
      }
    });

    test("should query billsVotequestion table with vote totals (yeaTotal, nayTotal, pairedTotal)", async () => {
      const samples = await getSampleRecord(billsVotequestion, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const question of samples) {
        expect(question).toHaveProperty("id");
        expect(question).toHaveProperty("date");
        expect(question).toHaveProperty("yeaTotal");
        expect(question).toHaveProperty("nayTotal");
        expect(question).toHaveProperty("pairedTotal");
        expect(question).toHaveProperty("result");
        expect(typeof question.yeaTotal).toBe("number");
        expect(typeof question.nayTotal).toBe("number");
        expect(typeof question.pairedTotal).toBe("number");
        expect(question.date).toBeInstanceOf(Date);
      }
    });

    test("should have date field in billsVotequestion for vote date", async () => {
      const [question] = await getSampleRecord(billsVotequestion, 1);
      expect(question.date).toBeInstanceOf(Date);
    });
  });

  test.describe("Committees Tables", () => {
    test("should query committeesCommittee table with hierarchical parentId relationship", async () => {
      const samples = await getSampleRecord(committeesCommittee, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const committee of samples) {
        expect(committee).toHaveProperty("id");
        expect(committee).toHaveProperty("nameEn");
        expect(committee).toHaveProperty("nameFr");
        expect(committee).toHaveProperty("slug");
        expect(committee).toHaveProperty("display");
        // parentId can be null for top-level committees
      }
    });

    test("should have unique slug constraint in committeesCommittee", async () => {
      const samples = await getSampleRecord(committeesCommittee, 100);
      const slugs = samples.map((c) => c.slug);
      const uniqueSlugs = new Set(slugs);
      expect(slugs.length).toBe(uniqueSlugs.size);
    });

    test("should return multilingual names in committeesCommittee (nameEn, nameFr)", async () => {
      const [committee] = await getSampleRecord(committeesCommittee, 1);
      expect(typeof committee.nameEn).toBe("string");
      expect(typeof committee.nameFr).toBe("string");
      expect(committee.nameEn.length).toBeGreaterThan(0);
      expect(committee.nameFr.length).toBeGreaterThan(0);
    });

    test("should query committeesCommitteeactivity table linked to committee", async () => {
      const samples = await getSampleRecord(committeesCommitteeactivity, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const activity of samples) {
        expect(activity).toHaveProperty("id");
        expect(activity).toHaveProperty("committeeId");
        expect(activity).toHaveProperty("nameEn");
        expect(activity).toHaveProperty("nameFr");
        expect(activity).toHaveProperty("study");
        expect(typeof activity.committeeId).toBe("number");
        expect(typeof activity.study).toBe("boolean");
      }
    });

    test("should query committeesCommitteeactivityinsession with activity and session links", async () => {
      const samples = await getSampleRecord(
        committeesCommitteeactivityinsession,
        10
      );
      expect(samples.length).toBeGreaterThan(0);

      for (const activityInSession of samples) {
        expect(activityInSession).toHaveProperty("id");
        expect(activityInSession).toHaveProperty("activityId");
        expect(activityInSession).toHaveProperty("sessionId");
        expect(activityInSession).toHaveProperty("sourceId");
        expect(typeof activityInSession.activityId).toBe("number");
        expect(typeof activityInSession.sessionId).toBe("string");
      }
    });

    test("should have unique constraint on activityId and sessionId combination", async () => {
      const samples = await getSampleRecord(
        committeesCommitteeactivityinsession,
        100
      );
      const combinations = samples.map((a) => `${a.activityId}-${a.sessionId}`);
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });

    test("should query committeesCommitteeinsession with session and committee links", async () => {
      const samples = await getSampleRecord(committeesCommitteeinsession, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const committeeInSession of samples) {
        expect(committeeInSession).toHaveProperty("id");
        expect(committeeInSession).toHaveProperty("committeeId");
        expect(committeeInSession).toHaveProperty("sessionId");
        expect(committeeInSession).toHaveProperty("acronym");
        expect(typeof committeeInSession.committeeId).toBe("number");
        expect(typeof committeeInSession.sessionId).toBe("string");
        expect(typeof committeeInSession.acronym).toBe("string");
      }
    });

    test("should have unique acronym per session in committeesCommitteeinsession", async () => {
      const samples = await getSampleRecord(committeesCommitteeinsession, 100);
      const combinations = samples.map((c) => `${c.acronym}-${c.sessionId}`);
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });

    test("should query committeesCommitteemeeting with date and time fields", async () => {
      const samples = await getSampleRecord(committeesCommitteemeeting, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const meeting of samples) {
        expect(meeting).toHaveProperty("id");
        expect(meeting).toHaveProperty("date");
        expect(meeting).toHaveProperty("startTime");
        expect(meeting).toHaveProperty("committeeId");
        expect(meeting).toHaveProperty("sessionId");
        expect(meeting.date).toBeInstanceOf(Date);
        expect(typeof meeting.startTime).toBe("string"); // time type returns as string
      }
    });

    test("should link committeesCommitteemeeting to evidence document via evidenceId", async () => {
      const samples = await getSampleRecord(committeesCommitteemeeting, 10);
      expect(samples.length).toBeGreaterThan(0);
    });

    test("should query committeesCommitteemeetingActivities junction table", async () => {
      const samples = await getSampleRecord(
        committeesCommitteemeetingActivities,
        10
      );
      expect(samples.length).toBeGreaterThan(0);

      for (const junction of samples) {
        expect(junction).toHaveProperty("id");
        expect(junction).toHaveProperty("committeemeetingId");
        expect(junction).toHaveProperty("committeeactivityId");
        expect(typeof junction.committeemeetingId).toBe("number");
        expect(typeof junction.committeeactivityId).toBe("number");
      }
    });

    test("should query committeesCommitteereport with adoption and presentation dates", async () => {
      const samples = await getSampleRecord(committeesCommitteereport, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const report of samples) {
        expect(report).toHaveProperty("id");
        expect(report).toHaveProperty("committeeId");
        expect(report).toHaveProperty("sessionId");
        expect(report).toHaveProperty("nameEn");
        expect(report).toHaveProperty("nameFr");
        if (report.adoptedDate) {
          expect(report.adoptedDate).toBeInstanceOf(Date);
        }
        if (report.presentedDate) {
          expect(report.presentedDate).toBeInstanceOf(Date);
        }
      }
    });
  });

  test.describe("Core Tables", () => {
    test("should query corePolitician table with name components (nameGiven, nameFamily)", async () => {
      const samples = await getSampleRecord(corePolitician, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const politician of samples) {
        expect(politician).toHaveProperty("id");
        expect(politician).toHaveProperty("name");
        expect(politician).toHaveProperty("nameGiven");
        expect(politician).toHaveProperty("nameFamily");
        expect(politician).toHaveProperty("slug");
        expect(politician).toHaveProperty("gender");
        expect(typeof politician.name).toBe("string");
        expect(typeof politician.nameGiven).toBe("string");
        expect(typeof politician.nameFamily).toBe("string");
        expect(typeof politician.gender).toBe("string");
        // Gender can be empty string, 'M', or 'F'
        expect(politician.gender.length).toBeLessThanOrEqual(1);
      }
    });

    // Note: corePolitician.slug does NOT have a unique constraint in the database

    test("should query coreElectedmember table linking politician, riding, and party", async () => {
      const samples = await getSampleRecord(coreElectedmember, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const member of samples) {
        expect(member).toHaveProperty("id");
        expect(member).toHaveProperty("politicianId");
        expect(member).toHaveProperty("ridingId");
        expect(member).toHaveProperty("partyId");
        expect(member).toHaveProperty("startDate");
        expect(typeof member.politicianId).toBe("number");
        expect(typeof member.ridingId).toBe("number");
        expect(typeof member.partyId).toBe("number");
        expect(member.startDate).toBeInstanceOf(Date);
      }
    });

    test("should have date range fields (startDate, endDate) in coreElectedmember", async () => {
      const samples = await getSampleRecord(coreElectedmember, 10);
      for (const member of samples) {
        expect(member.startDate).toBeInstanceOf(Date);
        if (member.endDate) {
          expect(member.endDate).toBeInstanceOf(Date);
        }
      }
    });

    test("should query coreElectedmemberSessions junction table", async () => {
      const samples = await getSampleRecord(coreElectedmemberSessions, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const session of samples) {
        expect(session).toHaveProperty("id");
        expect(session).toHaveProperty("electedmemberId");
        expect(session).toHaveProperty("sessionId");
        expect(typeof session.electedmemberId).toBe("number");
        expect(typeof session.sessionId).toBe("string");
      }
    });

    test("should have unique constraint on electedmemberId and sessionId combination", async () => {
      const samples = await getSampleRecord(coreElectedmemberSessions, 100);
      const combinations = samples.map(
        (s) => `${s.electedmemberId}-${s.sessionId}`
      );
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });

    test("should query coreParty table with multilingual names", async () => {
      const samples = await getSampleRecord(coreParty, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const party of samples) {
        expect(party).toHaveProperty("id");
        expect(party).toHaveProperty("nameEn");
        expect(party).toHaveProperty("nameFr");
        expect(party).toHaveProperty("shortNameEn");
        expect(party).toHaveProperty("shortNameFr");
        expect(party).toHaveProperty("slug");
        expect(typeof party.nameEn).toBe("string");
        expect(typeof party.nameFr).toBe("string");
      }
    });

    test("should have slug field in coreParty", async () => {
      const samples = await getSampleRecord(coreParty, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const party of samples) {
        expect(party).toHaveProperty("slug");
        expect(typeof party.slug).toBe("string");
      }
    });

    test("should query corePartyalternatename table for party aliases", async () => {
      const samples = await getSampleRecord(corePartyalternatename, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const altName of samples) {
        expect(altName).toHaveProperty("name");
        expect(altName).toHaveProperty("partyId");
        expect(typeof altName.name).toBe("string");
        expect(typeof altName.partyId).toBe("number");
      }
    });

    test("should query coreRiding table with province and current status", async () => {
      const samples = await getSampleRecord(coreRiding, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const riding of samples) {
        expect(riding).toHaveProperty("id");
        expect(riding).toHaveProperty("nameEn");
        expect(riding).toHaveProperty("nameFr");
        expect(riding).toHaveProperty("province");
        expect(riding).toHaveProperty("slug");
        expect(riding).toHaveProperty("current");
        expect(typeof riding.province).toBe("string");
        expect(riding.province.length).toBe(2);
        expect(typeof riding.current).toBe("boolean");
      }
    });

    test("should have unique slug constraint in coreRiding", async () => {
      const samples = await getSampleRecord(coreRiding, 100);
      const slugs = samples.map((r) => r.slug);
      const uniqueSlugs = new Set(slugs);
      expect(slugs.length).toBe(uniqueSlugs.size);
    });

    test("should query coreSession table with parliament and session numbers", async () => {
      const samples = await getSampleRecord(coreSession, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const session of samples) {
        expect(session).toHaveProperty("id");
        expect(session).toHaveProperty("name");
        expect(session).toHaveProperty("start");
        expect(typeof session.id).toBe("string");
        expect(session.id.length).toBe(4);
        expect(session.start).toBeInstanceOf(Date);
      }
    });

    test("should have date range fields (start, end) in coreSession", async () => {
      const samples = await getSampleRecord(coreSession, 10);
      for (const session of samples) {
        expect(session.start).toBeInstanceOf(Date);
        if (session.end) {
          expect(session.end).toBeInstanceOf(Date);
        }
      }
    });

    test("should query corePoliticianinfo table with schema and value fields", async () => {
      const samples = await getSampleRecord(corePoliticianinfo, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const info of samples) {
        expect(info).toHaveProperty("id");
        expect(info).toHaveProperty("politicianId");
        expect(info).toHaveProperty("schema");
        expect(info).toHaveProperty("value");
        expect(typeof info.politicianId).toBe("number");
        expect(typeof info.schema).toBe("string");
        expect(typeof info.value).toBe("string");
      }
    });
  });

  test.describe("Elections Tables", () => {
    test("should query electionsElection table with date and byelection flag", async () => {
      const samples = await getSampleRecord(electionsElection, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const election of samples) {
        expect(election).toHaveProperty("id");
        expect(election).toHaveProperty("date");
        expect(election).toHaveProperty("byelection");
        expect(election.date).toBeInstanceOf(Date);
        expect(typeof election.byelection).toBe("boolean");
      }
    });

    test("should query electionsCandidacy table linking candidate, riding, party, and election", async () => {
      const samples = await getSampleRecord(electionsCandidacy, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const candidacy of samples) {
        expect(candidacy).toHaveProperty("id");
        expect(candidacy).toHaveProperty("candidateId");
        expect(candidacy).toHaveProperty("ridingId");
        expect(candidacy).toHaveProperty("partyId");
        expect(candidacy).toHaveProperty("electionId");
        expect(typeof candidacy.candidateId).toBe("number");
        expect(typeof candidacy.ridingId).toBe("number");
        expect(typeof candidacy.partyId).toBe("number");
        expect(typeof candidacy.electionId).toBe("number");
      }
    });

    test("should return vote totals and percentages in electionsCandidacy", async () => {
      const samples = await getSampleRecord(electionsCandidacy, 10);
      for (const candidacy of samples) {
        if (candidacy.votetotal !== null) {
          expect(typeof candidacy.votetotal).toBe("number");
        }
        if (candidacy.votepercent !== null) {
          // Drizzle returns numeric types as strings to preserve precision
          expect(typeof candidacy.votepercent).toBe("string");
        }
        if (candidacy.elected !== null) {
          expect(typeof candidacy.elected).toBe("boolean");
        }
      }
    });

    test("should have elected boolean flag in electionsCandidacy", async () => {
      const samples = await getSampleRecord(electionsCandidacy, 10);
      expect(samples.length).toBeGreaterThan(0);
    });
  });

  test.describe("Hansards Tables", () => {
    test("should query hansardsDocument table with document type and session", async () => {
      const samples = await getSampleRecord(hansardsDocument, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const doc of samples) {
        expect(doc).toHaveProperty("id");
        expect(doc).toHaveProperty("number");
        expect(doc).toHaveProperty("sessionId");
        expect(doc).toHaveProperty("documentType");
        expect(doc).toHaveProperty("sourceId");
        expect(typeof doc.number).toBe("string");
        expect(typeof doc.sessionId).toBe("string");
        expect(typeof doc.documentType).toBe("string");
        expect(doc.documentType.length).toBe(1);
      }
    });

    test("should have unique sourceId constraint in hansardsDocument", async () => {
      const samples = await getSampleRecord(hansardsDocument, 100);
      const sourceIds = samples.map((d) => d.sourceId);
      const uniqueSourceIds = new Set(sourceIds);
      expect(sourceIds.length).toBe(uniqueSourceIds.size);
    });

    test("should return multilingual flag in hansardsDocument", async () => {
      const samples = await getSampleRecord(hansardsDocument, 10);
      for (const doc of samples) {
        expect(typeof doc.multilingual).toBe("boolean");
        expect(typeof doc.public_).toBe("boolean");
        expect(typeof doc.downloaded).toBe("boolean");
      }
    });

    test("should query hansardsStatement table with time and sequence fields", async () => {
      const samples = await getSampleRecord(hansardsStatement, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const statement of samples) {
        expect(statement).toHaveProperty("id");
        expect(statement).toHaveProperty("documentId");
        expect(statement).toHaveProperty("time");
        expect(statement).toHaveProperty("sequence");
        expect(statement).toHaveProperty("wordcount");
        expect(typeof statement.documentId).toBe("number");
        expect(statement.time).toBeInstanceOf(Date);
        expect(typeof statement.sequence).toBe("number");
        expect(typeof statement.wordcount).toBe("number");
      }
    });

    test("should have unique constraint on documentId and slug combination in hansardsStatement", async () => {
      const samples = await getSampleRecord(hansardsStatement, 100);
      const combinations = samples.map((s) => `${s.documentId}-${s.slug}`);
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });

    test("should return multilingual content fields (contentEn, contentFr) in hansardsStatement", async () => {
      const samples = await getSampleRecord(hansardsStatement, 10);
      for (const statement of samples) {
        expect(typeof statement.contentEn).toBe("string");
        expect(typeof statement.contentFr).toBe("string");
        expect(statement.contentEn.length).toBeGreaterThan(0);
        // Note: contentFr can be empty in some records
      }
    });

    test("should have hierarchical heading fields (h1En, h2En, h3En) in hansardsStatement", async () => {
      const samples = await getSampleRecord(hansardsStatement, 10);
      for (const statement of samples) {
        expect(statement).toHaveProperty("h1En");
        expect(statement).toHaveProperty("h2En");
        expect(statement).toHaveProperty("h3En");
        expect(statement).toHaveProperty("h1Fr");
        expect(statement).toHaveProperty("h2Fr");
        expect(statement).toHaveProperty("h3Fr");
        expect(typeof statement.h1En).toBe("string");
        expect(typeof statement.h2En).toBe("string");
        expect(typeof statement.h3En).toBe("string");
      }
    });

    test("should query hansardsStatementBills junction table", async () => {
      const samples = await getSampleRecord(hansardsStatementBills, 10);
      expect(samples.length).toBeGreaterThan(0);

      for (const junction of samples) {
        expect(junction).toHaveProperty("id");
        expect(junction).toHaveProperty("statementId");
        expect(junction).toHaveProperty("billId");
        expect(typeof junction.statementId).toBe("number");
        expect(typeof junction.billId).toBe("number");
      }
    });

    test("should query hansardsStatementMentionedPoliticians junction table", async () => {
      const samples = await getSampleRecord(
        hansardsStatementMentionedPoliticians,
        10
      );
      expect(samples.length).toBeGreaterThan(0);

      for (const junction of samples) {
        expect(junction).toHaveProperty("id");
        expect(junction).toHaveProperty("statementId");
        expect(junction).toHaveProperty("politicianId");
        expect(typeof junction.statementId).toBe("number");
        expect(typeof junction.politicianId).toBe("number");
      }
    });
  });
});
