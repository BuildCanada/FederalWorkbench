/**
 * Constraint validation tests
 * Tests unique constraints, check constraints, and not-null constraints
 */

import { expect, test } from "@playwright/test";
import {
  billsBill,
  billsBilltext,
  billsVotequestion,
  committeesCommittee,
  committeesCommitteeactivityinsession,
  committeesCommitteeinsession,
  committeesCommitteemeeting,
  committeesCommitteemeetingActivities,
  coreElectedmember,
  coreElectedmemberSessions,
  corePolitician,
  coreRiding,
  coreSession,
  hansardsDocument,
  hansardsStatement,
  hansardsStatementBills,
  hansardsStatementMentionedPoliticians,
} from "@/lib/db/parliament/schema";
import { getSampleRecord } from "./utils";

test.describe("Parliament Schema - Constraints Validation", () => {
  test.describe("Unique Constraints", () => {
    test("should have unique docid constraint in billsBilltext", async () => {
      const samples = await getSampleRecord(billsBilltext, 100);
      const docids = samples.map((bt) => bt.docid);
      const uniqueDocids = new Set(docids);
      expect(docids.length).toBe(uniqueDocids.size);
    });

    test("should have unique slug constraint in committeesCommittee", async () => {
      const samples = await getSampleRecord(committeesCommittee, 100);
      const slugs = samples.map((c) => c.slug);
      const uniqueSlugs = new Set(slugs);
      expect(slugs.length).toBe(uniqueSlugs.size);
    });

    test("should have unique acronym per session in committeesCommitteeinsession", async () => {
      const samples = await getSampleRecord(committeesCommitteeinsession, 100);
      const combinations = samples.map((c) => `${c.acronym}-${c.sessionId}`);
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });

    test("should have unique sessionId and committeeId combination in committeesCommitteeinsession", async () => {
      const samples = await getSampleRecord(committeesCommitteeinsession, 100);
      const combinations = samples.map(
        (c) => `${c.sessionId}-${c.committeeId}`
      );
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });

    test("should have unique sessionId, number, and committeeId combination in committeesCommitteemeeting", async () => {
      const samples = await getSampleRecord(committeesCommitteemeeting, 100);
      const combinations = samples.map(
        (m) => `${m.sessionId}-${m.number}-${m.committeeId}`
      );
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });

    test("should have unique activityId and sessionId combination in committeesCommitteeactivityinsession", async () => {
      const samples = await getSampleRecord(
        committeesCommitteeactivityinsession,
        100
      );
      const combinations = samples.map((a) => `${a.activityId}-${a.sessionId}`);
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });

    test("should have unique committeemeetingId and committeeactivityId combination in committeesCommitteemeetingActivities", async () => {
      const samples = await getSampleRecord(
        committeesCommitteemeetingActivities,
        100
      );
      const combinations = samples.map(
        (j) => `${j.committeemeetingId}-${j.committeeactivityId}`
      );
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });

    test("should have unique electedmemberId and sessionId combination in coreElectedmemberSessions", async () => {
      const samples = await getSampleRecord(coreElectedmemberSessions, 100);
      const combinations = samples.map(
        (s) => `${s.electedmemberId}-${s.sessionId}`
      );
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });

    // Note: coreParty.slug and corePolitician.slug do NOT have unique constraints in the database

    test("should have unique slug constraint in coreRiding", async () => {
      const samples = await getSampleRecord(coreRiding, 100);
      const slugs = samples.map((r) => r.slug);
      const uniqueSlugs = new Set(slugs);
      expect(slugs.length).toBe(uniqueSlugs.size);
    });

    test("should have unique sourceId constraint in hansardsDocument", async () => {
      const samples = await getSampleRecord(hansardsDocument, 100);
      const sourceIds = samples.map((d) => d.sourceId);
      const uniqueSourceIds = new Set(sourceIds);
      expect(sourceIds.length).toBe(uniqueSourceIds.size);
    });

    test("should have unique documentId and slug combination in hansardsStatement", async () => {
      const samples = await getSampleRecord(hansardsStatement, 100);
      const combinations = samples.map((s) => `${s.documentId}-${s.slug}`);
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });

    test("should have unique statementId and billId combination in hansardsStatementBills", async () => {
      const samples = await getSampleRecord(hansardsStatementBills, 100);
      const combinations = samples.map((j) => `${j.statementId}-${j.billId}`);
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });

    test("should have unique statementId and politicianId combination in hansardsStatementMentionedPoliticians", async () => {
      const samples = await getSampleRecord(
        hansardsStatementMentionedPoliticians,
        100
      );
      const combinations = samples.map(
        (j) => `${j.statementId}-${j.politicianId}`
      );
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });
  });

  test.describe("Check Constraints", () => {
    test("should enforce legisinfoId >= 0 check constraint in billsBill", async () => {
      const samples = await getSampleRecord(billsBill, 100);
      for (const bill of samples) {
        if (bill.legisinfoId !== null) {
          expect(bill.legisinfoId).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test("should enforce docid >= 0 check constraint in billsBilltext", async () => {
      const samples = await getSampleRecord(billsBilltext, 100);
      for (const billtext of samples) {
        expect(billtext.docid).toBeGreaterThanOrEqual(0);
      }
    });

    test("should enforce number >= 0 check constraint in billsVotequestion", async () => {
      const samples = await getSampleRecord(billsVotequestion, 100);
      for (const question of samples) {
        expect(question.number).toBeGreaterThanOrEqual(0);
      }
    });

    test("should enforce whoHocid >= 0 check constraint in hansardsStatement", async () => {
      const samples = await getSampleRecord(hansardsStatement, 100);
      for (const statement of samples) {
        if (statement.whoHocid !== null) {
          expect(statement.whoHocid).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test("should enforce wordcountEn >= 0 check constraint in hansardsStatement", async () => {
      const samples = await getSampleRecord(hansardsStatement, 100);
      for (const statement of samples) {
        if (statement.wordcountEn !== null) {
          expect(statement.wordcountEn).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  test.describe("Not Null Constraints", () => {
    test("should enforce not null constraint on billsBill required fields", async () => {
      const samples = await getSampleRecord(billsBill, 10);
      for (const bill of samples) {
        expect(bill.id).not.toBeNull();
        expect(bill.nameEn).not.toBeNull();
        expect(bill.nameFr).not.toBeNull();
        expect(bill.number).not.toBeNull();
        expect(bill.numberOnly).not.toBeNull();
        expect(bill.sessionId).not.toBeNull();
        expect(bill.statusCode).not.toBeNull();
        expect(bill.added).not.toBeNull();
        expect(bill.institution).not.toBeNull();
        expect(bill.shortTitleEn).not.toBeNull();
        expect(bill.shortTitleFr).not.toBeNull();
        expect(bill.librarySummaryAvailable).not.toBeNull();
      }
    });

    test("should enforce not null constraint on billsBilltext required fields", async () => {
      const samples = await getSampleRecord(billsBilltext, 10);
      for (const billtext of samples) {
        expect(billtext.id).not.toBeNull();
        expect(billtext.billId).not.toBeNull();
        expect(billtext.docid).not.toBeNull();
        expect(billtext.textEn).not.toBeNull();
        expect(billtext.textFr).not.toBeNull();
        expect(billtext.summaryEn).not.toBeNull();
        expect(billtext.created).not.toBeNull();
      }
    });

    test("should enforce not null constraint on corePolitician required fields", async () => {
      const samples = await getSampleRecord(corePolitician, 10);
      for (const politician of samples) {
        expect(politician.id).not.toBeNull();
        expect(politician.name).not.toBeNull();
        expect(politician.nameGiven).not.toBeNull();
        expect(politician.nameFamily).not.toBeNull();
        expect(politician.slug).not.toBeNull();
        expect(politician.gender).not.toBeNull();
      }
    });

    test("should enforce not null constraint on coreElectedmember required fields", async () => {
      const samples = await getSampleRecord(coreElectedmember, 10);
      for (const member of samples) {
        expect(member.id).not.toBeNull();
        expect(member.politicianId).not.toBeNull();
        expect(member.ridingId).not.toBeNull();
        expect(member.partyId).not.toBeNull();
        expect(member.startDate).not.toBeNull();
      }
    });

    test("should enforce not null constraint on coreSession required fields", async () => {
      const samples = await getSampleRecord(coreSession, 10);
      for (const session of samples) {
        expect(session.id).not.toBeNull();
        expect(session.name).not.toBeNull();
        expect(session.start).not.toBeNull();
      }
    });

    test("should enforce not null constraint on hansardsStatement required fields", async () => {
      const samples = await getSampleRecord(hansardsStatement, 10);
      for (const statement of samples) {
        expect(statement.id).not.toBeNull();
        expect(statement.documentId).not.toBeNull();
        expect(statement.time).not.toBeNull();
        expect(statement.sequence).not.toBeNull();
        expect(statement.wordcount).not.toBeNull();
        expect(statement.contentEn).not.toBeNull();
        expect(statement.contentFr).not.toBeNull();
        expect(statement.procedural).not.toBeNull();
      }
    });
  });
});
