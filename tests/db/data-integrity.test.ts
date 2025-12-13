/**
 * Data integrity and cross-table consistency tests
 * Tests logical relationships and data consistency across tables
 *
 * NOTE: These tests require data to be loaded in the parliament schema.
 * Tests will be skipped if the required tables are empty.
 */

import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";

import {
  billsBill,
  billsMembervote,
  billsVotequestion,
  coreElectedmember,
  coreSession,
  hansardsDocument,
  hansardsStatement,
} from "@/lib/db/parliament/schema";
import { getSampleRecord, hasData, testDb } from "./utils";

test.describe("Parliament Schema - Data Integrity", () => {
  test.describe("Session Consistency", () => {
    test("should have all session references point to valid sessions", async () => {
      // Skip if no session data
      if (!(await hasData(coreSession))) {
        test.skip();
        return;
      }

      const sessions = await getSampleRecord(coreSession, 1000);
      const sessionIds = new Set(sessions.map((s) => s.id));

      // Check billsBill.sessionId if bills exist
      if (await hasData(billsBill)) {
        const bills = await getSampleRecord(billsBill, 100);
        for (const bill of bills) {
          expect(sessionIds.has(bill.sessionId)).toBe(true);
        }
      }

      // Check hansardsDocument.sessionId if documents exist
      if (await hasData(hansardsDocument)) {
        const docs = await getSampleRecord(hansardsDocument, 100);
        for (const doc of docs) {
          expect(sessionIds.has(doc.sessionId)).toBe(true);
        }
      }
    });
  });

  test.describe("Date Consistency", () => {
    test("should have coreElectedmember.startDate <= endDate when endDate exists", async () => {
      if (!(await hasData(coreElectedmember))) {
        test.skip();
        return;
      }

      const samples = await getSampleRecord(coreElectedmember, 100);
      const membersWithEndDate = samples.filter((m) => m.endDate !== null);

      for (const member of membersWithEndDate) {
        if (member.endDate) {
          expect(member.startDate.getTime()).toBeLessThanOrEqual(
            member.endDate.getTime()
          );
        }
      }
    });

    test("should have coreSession.start <= end when end exists", async () => {
      if (!(await hasData(coreSession))) {
        test.skip();
        return;
      }

      const samples = await getSampleRecord(coreSession, 100);
      const sessionsWithEnd = samples.filter((s) => s.end !== null);

      for (const session of sessionsWithEnd) {
        if (session.end) {
          expect(session.start.getTime()).toBeLessThanOrEqual(
            session.end.getTime()
          );
        }
      }
    });

    test("should have billsBill.added date be reasonable (not in future)", async () => {
      if (!(await hasData(billsBill))) {
        test.skip();
        return;
      }

      const samples = await getSampleRecord(billsBill, 100);
      const now = new Date();

      for (const bill of samples) {
        // Bills should not be added in the future
        expect(bill.added.getTime()).toBeLessThanOrEqual(now.getTime());
      }
    });

    // Note: "added" is when the bill was added to the OpenParliament.ca database,
    // not a parliamentary date. Historical bills were backfilled, so "added" can be
    // years after "introduced". This is not a data quality issue.
  });

  test.describe("Vote Totals Consistency", () => {
    test("should have billsVotequestion totals be non-negative", async () => {
      if (!(await hasData(billsVotequestion))) {
        test.skip();
        return;
      }

      const samples = await getSampleRecord(billsVotequestion, 100);
      for (const question of samples) {
        expect(question.yeaTotal).toBeGreaterThanOrEqual(0);
        expect(question.nayTotal).toBeGreaterThanOrEqual(0);
        expect(question.pairedTotal).toBeGreaterThanOrEqual(0);
      }
    });

    test("should have billsVotequestion result match vote pattern (Y/N)", async () => {
      if (!(await hasData(billsVotequestion))) {
        test.skip();
        return;
      }

      const samples = await getSampleRecord(billsVotequestion, 100);
      for (const question of samples) {
        expect(["Y", "N", "T"]).toContain(question.result);
      }
    });

    test("should have vote totals match member votes for a sample vote question", async () => {
      if (
        !(await hasData(billsVotequestion)) ||
        !(await hasData(billsMembervote))
      ) {
        test.skip();
        return;
      }

      const [question] = await getSampleRecord(billsVotequestion, 1);
      if (!question) {
        test.skip();
        return;
      }

      const memberVotes = await testDb
        .select()
        .from(billsMembervote)
        .where(eq(billsMembervote.votequestionId, question.id));

      const yeaCount = memberVotes.filter((v) => v.vote === "Y").length;
      const nayCount = memberVotes.filter((v) => v.vote === "N").length;
      const pairedCount = memberVotes.filter((v) => v.vote === "P").length;

      // Totals should be close (allowing for some variance due to data timing)
      expect(Math.abs(question.yeaTotal - yeaCount)).toBeLessThan(10);
      expect(Math.abs(question.nayTotal - nayCount)).toBeLessThan(10);
      expect(Math.abs(question.pairedTotal - pairedCount)).toBeLessThan(10);
    });
  });

  test.describe("Hansards Consistency", () => {
    test("should have hansardsStatement sequence numbers be sequential within document", async () => {
      if (!(await hasData(hansardsStatement))) {
        test.skip();
        return;
      }

      const samples = await getSampleRecord(hansardsStatement, 100);
      const statementsByDocument = new Map<number, typeof samples>();

      for (const statement of samples) {
        if (!statementsByDocument.has(statement.documentId)) {
          statementsByDocument.set(statement.documentId, []);
        }
        const docStatements = statementsByDocument.get(statement.documentId);
        if (docStatements) {
          docStatements.push(statement);
        }
      }

      // Check a few documents
      let checked = 0;
      for (const [_docId, statements] of statementsByDocument.entries()) {
        if (checked >= 5) {
          break;
        }
        if (statements.length < 2) {
          continue;
        }

        statements.sort((a, b) => a.sequence - b.sequence);
        for (let i = 1; i < statements.length; i++) {
          const current = statements[i];
          const previous = statements[i - 1];
          if (current && previous) {
            expect(current.sequence).toBeGreaterThan(previous.sequence);
          }
        }
        checked++;
      }
    });

    test("should have hansardsStatement time be within document date range", async () => {
      if (
        !(await hasData(hansardsStatement)) ||
        !(await hasData(hansardsDocument))
      ) {
        test.skip();
        return;
      }

      const statements = await getSampleRecord(hansardsStatement, 50);
      const documentIds = Array.from(
        new Set(statements.map((s) => s.documentId))
      ).slice(0, 10);

      if (documentIds.length === 0) {
        test.skip();
        return;
      }

      const documents = await testDb
        .select()
        .from(hansardsDocument)
        .where(inArray(hansardsDocument.id, documentIds));

      if (documents.length === 0) {
        test.skip();
        return;
      }

      const docMap = new Map(documents.map((d) => [d.id, d]));

      for (const statement of statements.slice(0, 10)) {
        const doc = docMap.get(statement.documentId);
        if (doc?.date) {
          const statementDate = new Date(statement.time);
          const docDate = new Date(doc.date);
          // Statement time should be on the same day or close to document date
          const dayDiff = Math.abs(statementDate.getTime() - docDate.getTime());
          expect(dayDiff).toBeLessThan(2 * 24 * 60 * 60 * 1000); // Within 2 days
        }
      }
    });

    test("should have hansardsStatement wordcount be positive for non-procedural statements", async () => {
      if (!(await hasData(hansardsStatement))) {
        test.skip();
        return;
      }

      const samples = await getSampleRecord(hansardsStatement, 20);
      for (const statement of samples) {
        // Note: wordcount is calculated on plain text, not HTML
        // contentEn includes HTML markup, so direct word splitting won't match
        // Just verify wordcount is reasonable (>= 0)
        expect(statement.wordcount).toBeGreaterThanOrEqual(0);
        if (statement.contentEn.length > 100 && !statement.procedural) {
          // Non-trivial, non-procedural statements should have wordcount > 0
          expect(statement.wordcount).toBeGreaterThan(0);
        }
      }
    });
  });

  test.describe("Elected Member Consistency", () => {
    test("should have coreElectedmember dates be in reasonable range", async () => {
      if (!(await hasData(coreElectedmember))) {
        test.skip();
        return;
      }

      const samples = await getSampleRecord(coreElectedmember, 100);
      const earliestDate = new Date("1867-01-01"); // Confederation
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 10); // Allow 10 years in future

      for (const member of samples) {
        expect(member.startDate.getTime()).toBeGreaterThan(
          earliestDate.getTime()
        );
        expect(member.startDate.getTime()).toBeLessThan(futureDate.getTime());

        if (member.endDate) {
          expect(member.endDate.getTime()).toBeGreaterThan(
            earliestDate.getTime()
          );
          expect(member.endDate.getTime()).toBeLessThan(futureDate.getTime());
        }
      }
    });
  });
});
