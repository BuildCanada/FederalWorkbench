/**
 * Foreign key relationship validation tests
 * Tests that all foreign key relationships resolve correctly
 */

import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
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
} from "@/lib/db/parliament/schema";
import { checkForeignKey, getSampleRecord, testDb } from "./utils";

test.describe("Parliament Schema - Foreign Key Relationships", () => {
  test.describe("Bills Relationships", () => {
    test("should resolve billsBill.sponsorMemberId to valid coreElectedmember.id", async () => {
      const samples = await getSampleRecord(billsBill, 20);
      const billsWithSponsor = samples.filter(
        (b) => b.sponsorMemberId !== null
      );

      if (billsWithSponsor.length === 0) {
        test.skip();
        return;
      }

      for (const bill of billsWithSponsor.slice(0, 10)) {
        const isValid = await checkForeignKey({
          fkValue: bill.sponsorMemberId,
          referencedTable: coreElectedmember,
          referencedColumn: coreElectedmember.id,
        });
        expect(isValid).toBe(true);
      }
    });

    test("should resolve billsBill.sponsorPoliticianId to valid corePolitician.id", async () => {
      const samples = await getSampleRecord(billsBill, 20);
      const billsWithSponsor = samples.filter(
        (b) => b.sponsorPoliticianId !== null
      );

      if (billsWithSponsor.length === 0) {
        test.skip();
        return;
      }

      for (const bill of billsWithSponsor.slice(0, 10)) {
        const isValid = await checkForeignKey({
          fkValue: bill.sponsorPoliticianId,
          referencedTable: corePolitician,
          referencedColumn: corePolitician.id,
        });
        expect(isValid).toBe(true);
      }
    });

    test("should resolve billsBill.sessionId to valid coreSession.id", async () => {
      const samples = await getSampleRecord(billsBill, 10);
      for (const bill of samples) {
        const sessions = await testDb
          .select()
          .from(coreSession)
          .where(eq(coreSession.id, bill.sessionId))
          .limit(1);
        expect(sessions.length).toBe(1);
        expect(sessions[0]?.id).toBe(bill.sessionId);
      }
    });

    test("should resolve billsBilltext.billId to valid billsBill.id", async () => {
      const samples = await getSampleRecord(billsBilltext, 10);
      for (const billtext of samples) {
        const bills = await testDb
          .select()
          .from(billsBill)
          .where(eq(billsBill.id, billtext.billId))
          .limit(1);
        expect(bills.length).toBe(1);
        expect(bills[0]?.id).toBe(billtext.billId);
      }
    });

    test("should resolve billsMembervote.memberId to valid coreElectedmember.id", async () => {
      const samples = await getSampleRecord(billsMembervote, 10);
      for (const vote of samples) {
        const members = await testDb
          .select()
          .from(coreElectedmember)
          .where(eq(coreElectedmember.id, vote.memberId))
          .limit(1);
        expect(members.length).toBe(1);
        expect(members[0]?.id).toBe(vote.memberId);
      }
    });

    test("should resolve billsMembervote.politicianId to valid corePolitician.id", async () => {
      const samples = await getSampleRecord(billsMembervote, 10);
      for (const vote of samples) {
        const politicians = await testDb
          .select()
          .from(corePolitician)
          .where(eq(corePolitician.id, vote.politicianId))
          .limit(1);
        expect(politicians.length).toBe(1);
        expect(politicians[0]?.id).toBe(vote.politicianId);
      }
    });

    test("should resolve billsMembervote.votequestionId to valid billsVotequestion.id", async () => {
      const samples = await getSampleRecord(billsMembervote, 10);
      for (const vote of samples) {
        const questions = await testDb
          .select()
          .from(billsVotequestion)
          .where(eq(billsVotequestion.id, vote.votequestionId))
          .limit(1);
        expect(questions.length).toBe(1);
        expect(questions[0]?.id).toBe(vote.votequestionId);
      }
    });

    test("should resolve billsPartyvote.partyId to valid coreParty.id", async () => {
      const samples = await getSampleRecord(billsPartyvote, 10);
      for (const vote of samples) {
        const parties = await testDb
          .select()
          .from(coreParty)
          .where(eq(coreParty.id, vote.partyId))
          .limit(1);
        expect(parties.length).toBe(1);
        expect(parties[0]?.id).toBe(vote.partyId);
      }
    });

    test("should resolve billsPartyvote.votequestionId to valid billsVotequestion.id", async () => {
      const samples = await getSampleRecord(billsPartyvote, 10);
      for (const vote of samples) {
        const questions = await testDb
          .select()
          .from(billsVotequestion)
          .where(eq(billsVotequestion.id, vote.votequestionId))
          .limit(1);
        expect(questions.length).toBe(1);
        expect(questions[0]?.id).toBe(vote.votequestionId);
      }
    });

    test("should resolve billsVotequestion.billId to valid billsBill.id when present", async () => {
      const samples = await getSampleRecord(billsVotequestion, 20);
      const questionsWithBill = samples.filter((q) => q.billId !== null);

      if (questionsWithBill.length === 0) {
        test.skip();
        return;
      }

      for (const question of questionsWithBill.slice(0, 10)) {
        if (question.billId) {
          const bills = await testDb
            .select()
            .from(billsBill)
            .where(eq(billsBill.id, question.billId))
            .limit(1);
          expect(bills.length).toBe(1);
          expect(bills[0]?.id).toBe(question.billId);
        }
      }
    });

    test("should resolve billsVotequestion.sessionId to valid coreSession.id", async () => {
      const samples = await getSampleRecord(billsVotequestion, 10);
      for (const question of samples) {
        const sessions = await testDb
          .select()
          .from(coreSession)
          .where(eq(coreSession.id, question.sessionId))
          .limit(1);
        expect(sessions.length).toBe(1);
        expect(sessions[0]?.id).toBe(question.sessionId);
      }
    });

    test("should resolve billsVotequestion.contextStatementId to valid hansardsStatement.id when present", async () => {
      const samples = await getSampleRecord(billsVotequestion, 20);
      const questionsWithStatement = samples.filter(
        (q) => q.contextStatementId !== null
      );

      if (questionsWithStatement.length === 0) {
        test.skip();
        return;
      }

      for (const question of questionsWithStatement.slice(0, 10)) {
        if (question.contextStatementId) {
          const statements = await testDb
            .select()
            .from(hansardsStatement)
            .where(eq(hansardsStatement.id, question.contextStatementId))
            .limit(1);
          expect(statements.length).toBe(1);
          expect(statements[0]?.id).toBe(question.contextStatementId);
        }
      }
    });
  });

  test.describe("Committees Relationships", () => {
    test("should resolve committeesCommittee.parentId to valid committeesCommittee.id when present", async () => {
      const samples = await getSampleRecord(committeesCommittee, 20);
      const committeesWithParent = samples.filter((c) => c.parentId !== null);

      if (committeesWithParent.length === 0) {
        test.skip();
        return;
      }

      for (const committee of committeesWithParent.slice(0, 10)) {
        if (committee.parentId) {
          const parents = await testDb
            .select()
            .from(committeesCommittee)
            .where(eq(committeesCommittee.id, committee.parentId))
            .limit(1);
          expect(parents.length).toBe(1);
          expect(parents[0]?.id).toBe(committee.parentId);
        }
      }
    });

    test("should resolve committeesCommitteeactivity.committeeId to valid committeesCommittee.id", async () => {
      const samples = await getSampleRecord(committeesCommitteeactivity, 10);
      for (const activity of samples) {
        const committees = await testDb
          .select()
          .from(committeesCommittee)
          .where(eq(committeesCommittee.id, activity.committeeId))
          .limit(1);
        expect(committees.length).toBe(1);
        expect(committees[0]?.id).toBe(activity.committeeId);
      }
    });

    test("should resolve committeesCommitteeactivityinsession.activityId to valid committeesCommitteeactivity.id", async () => {
      const samples = await getSampleRecord(
        committeesCommitteeactivityinsession,
        10
      );
      for (const activityInSession of samples) {
        const activities = await testDb
          .select()
          .from(committeesCommitteeactivity)
          .where(
            eq(committeesCommitteeactivity.id, activityInSession.activityId)
          )
          .limit(1);
        expect(activities.length).toBe(1);
        expect(activities[0]?.id).toBe(activityInSession.activityId);
      }
    });

    test("should resolve committeesCommitteeactivityinsession.sessionId to valid coreSession.id", async () => {
      const samples = await getSampleRecord(
        committeesCommitteeactivityinsession,
        10
      );
      for (const activityInSession of samples) {
        const sessions = await testDb
          .select()
          .from(coreSession)
          .where(eq(coreSession.id, activityInSession.sessionId))
          .limit(1);
        expect(sessions.length).toBe(1);
        expect(sessions[0]?.id).toBe(activityInSession.sessionId);
      }
    });

    test("should resolve committeesCommitteeinsession.committeeId to valid committeesCommittee.id", async () => {
      const samples = await getSampleRecord(committeesCommitteeinsession, 10);
      for (const committeeInSession of samples) {
        const committees = await testDb
          .select()
          .from(committeesCommittee)
          .where(eq(committeesCommittee.id, committeeInSession.committeeId))
          .limit(1);
        expect(committees.length).toBe(1);
        expect(committees[0]?.id).toBe(committeeInSession.committeeId);
      }
    });

    test("should resolve committeesCommitteeinsession.sessionId to valid coreSession.id", async () => {
      const samples = await getSampleRecord(committeesCommitteeinsession, 10);
      for (const committeeInSession of samples) {
        const sessions = await testDb
          .select()
          .from(coreSession)
          .where(eq(coreSession.id, committeeInSession.sessionId))
          .limit(1);
        expect(sessions.length).toBe(1);
        expect(sessions[0]?.id).toBe(committeeInSession.sessionId);
      }
    });

    test("should resolve committeesCommitteemeeting.committeeId to valid committeesCommittee.id", async () => {
      const samples = await getSampleRecord(committeesCommitteemeeting, 10);
      for (const meeting of samples) {
        const committees = await testDb
          .select()
          .from(committeesCommittee)
          .where(eq(committeesCommittee.id, meeting.committeeId))
          .limit(1);
        expect(committees.length).toBe(1);
        expect(committees[0]?.id).toBe(meeting.committeeId);
      }
    });

    test("should resolve committeesCommitteemeeting.sessionId to valid coreSession.id", async () => {
      const samples = await getSampleRecord(committeesCommitteemeeting, 10);
      for (const meeting of samples) {
        const sessions = await testDb
          .select()
          .from(coreSession)
          .where(eq(coreSession.id, meeting.sessionId))
          .limit(1);
        expect(sessions.length).toBe(1);
        expect(sessions[0]?.id).toBe(meeting.sessionId);
      }
    });

    test("should resolve committeesCommitteemeeting.evidenceId to valid hansardsDocument.id when present", async () => {
      const samples = await getSampleRecord(committeesCommitteemeeting, 20);
      const meetingsWithEvidence = samples.filter((m) => m.evidenceId !== null);

      if (meetingsWithEvidence.length === 0) {
        test.skip();
        return;
      }

      for (const meeting of meetingsWithEvidence.slice(0, 10)) {
        if (meeting.evidenceId) {
          const documents = await testDb
            .select()
            .from(hansardsDocument)
            .where(eq(hansardsDocument.id, meeting.evidenceId))
            .limit(1);
          expect(documents.length).toBe(1);
          expect(documents[0]?.id).toBe(meeting.evidenceId);
        }
      }
    });

    test("should resolve committeesCommitteemeetingActivities.committemeetingId to valid committeesCommitteemeeting.id", async () => {
      const samples = await getSampleRecord(
        committeesCommitteemeetingActivities,
        10
      );
      for (const junction of samples) {
        const meetings = await testDb
          .select()
          .from(committeesCommitteemeeting)
          .where(eq(committeesCommitteemeeting.id, junction.committeemeetingId))
          .limit(1);
        expect(meetings.length).toBe(1);
        expect(meetings[0]?.id).toBe(junction.committeemeetingId);
      }
    });

    test("should resolve committeesCommitteemeetingActivities.committeeactivityId to valid committeesCommitteeactivity.id", async () => {
      const samples = await getSampleRecord(
        committeesCommitteemeetingActivities,
        10
      );
      for (const junction of samples) {
        const activities = await testDb
          .select()
          .from(committeesCommitteeactivity)
          .where(
            eq(committeesCommitteeactivity.id, junction.committeeactivityId)
          )
          .limit(1);
        expect(activities.length).toBe(1);
        expect(activities[0]?.id).toBe(junction.committeeactivityId);
      }
    });

    test("should resolve committeesCommitteereport.committeeId to valid committeesCommittee.id", async () => {
      const samples = await getSampleRecord(committeesCommitteereport, 10);
      for (const report of samples) {
        const committees = await testDb
          .select()
          .from(committeesCommittee)
          .where(eq(committeesCommittee.id, report.committeeId))
          .limit(1);
        expect(committees.length).toBe(1);
        expect(committees[0]?.id).toBe(report.committeeId);
      }
    });

    test("should resolve committeesCommitteereport.sessionId to valid coreSession.id", async () => {
      const samples = await getSampleRecord(committeesCommitteereport, 10);
      for (const report of samples) {
        const sessions = await testDb
          .select()
          .from(coreSession)
          .where(eq(coreSession.id, report.sessionId))
          .limit(1);
        expect(sessions.length).toBe(1);
        expect(sessions[0]?.id).toBe(report.sessionId);
      }
    });
  });

  test.describe("Core Relationships", () => {
    test("should resolve coreElectedmember.politicianId to valid corePolitician.id", async () => {
      const samples = await getSampleRecord(coreElectedmember, 10);
      for (const member of samples) {
        const politicians = await testDb
          .select()
          .from(corePolitician)
          .where(eq(corePolitician.id, member.politicianId))
          .limit(1);
        expect(politicians.length).toBe(1);
        expect(politicians[0]?.id).toBe(member.politicianId);
      }
    });

    test("should resolve coreElectedmember.ridingId to valid coreRiding.id", async () => {
      const samples = await getSampleRecord(coreElectedmember, 10);
      for (const member of samples) {
        const ridings = await testDb
          .select()
          .from(coreRiding)
          .where(eq(coreRiding.id, member.ridingId))
          .limit(1);
        expect(ridings.length).toBe(1);
        expect(ridings[0]?.id).toBe(member.ridingId);
      }
    });

    test("should resolve coreElectedmember.partyId to valid coreParty.id", async () => {
      const samples = await getSampleRecord(coreElectedmember, 10);
      for (const member of samples) {
        const parties = await testDb
          .select()
          .from(coreParty)
          .where(eq(coreParty.id, member.partyId))
          .limit(1);
        expect(parties.length).toBe(1);
        expect(parties[0]?.id).toBe(member.partyId);
      }
    });

    test("should resolve coreElectedmemberSessions.electedmemberId to valid coreElectedmember.id", async () => {
      const samples = await getSampleRecord(coreElectedmemberSessions, 10);
      for (const session of samples) {
        const members = await testDb
          .select()
          .from(coreElectedmember)
          .where(eq(coreElectedmember.id, session.electedmemberId))
          .limit(1);
        expect(members.length).toBe(1);
        expect(members[0]?.id).toBe(session.electedmemberId);
      }
    });

    test("should resolve coreElectedmemberSessions.sessionId to valid coreSession.id", async () => {
      const samples = await getSampleRecord(coreElectedmemberSessions, 10);
      for (const session of samples) {
        const sessions = await testDb
          .select()
          .from(coreSession)
          .where(eq(coreSession.id, session.sessionId))
          .limit(1);
        expect(sessions.length).toBe(1);
        expect(sessions[0]?.id).toBe(session.sessionId);
      }
    });

    test("should resolve corePartyalternatename.partyId to valid coreParty.id", async () => {
      const samples = await getSampleRecord(corePartyalternatename, 10);
      for (const altName of samples) {
        const parties = await testDb
          .select()
          .from(coreParty)
          .where(eq(coreParty.id, altName.partyId))
          .limit(1);
        expect(parties.length).toBe(1);
        expect(parties[0]?.id).toBe(altName.partyId);
      }
    });

    test("should resolve corePoliticianinfo.politicianId to valid corePolitician.id", async () => {
      const samples = await getSampleRecord(corePoliticianinfo, 10);
      for (const info of samples) {
        const politicians = await testDb
          .select()
          .from(corePolitician)
          .where(eq(corePolitician.id, info.politicianId))
          .limit(1);
        expect(politicians.length).toBe(1);
        expect(politicians[0]?.id).toBe(info.politicianId);
      }
    });
  });

  test.describe("Elections Relationships", () => {
    test("should resolve electionsCandidacy.candidateId to valid corePolitician.id", async () => {
      const samples = await getSampleRecord(electionsCandidacy, 10);
      for (const candidacy of samples) {
        const politicians = await testDb
          .select()
          .from(corePolitician)
          .where(eq(corePolitician.id, candidacy.candidateId))
          .limit(1);
        expect(politicians.length).toBe(1);
        expect(politicians[0]?.id).toBe(candidacy.candidateId);
      }
    });

    test("should resolve electionsCandidacy.ridingId to valid coreRiding.id", async () => {
      const samples = await getSampleRecord(electionsCandidacy, 10);
      for (const candidacy of samples) {
        const ridings = await testDb
          .select()
          .from(coreRiding)
          .where(eq(coreRiding.id, candidacy.ridingId))
          .limit(1);
        expect(ridings.length).toBe(1);
        expect(ridings[0]?.id).toBe(candidacy.ridingId);
      }
    });

    test("should resolve electionsCandidacy.partyId to valid coreParty.id", async () => {
      const samples = await getSampleRecord(electionsCandidacy, 10);
      for (const candidacy of samples) {
        const parties = await testDb
          .select()
          .from(coreParty)
          .where(eq(coreParty.id, candidacy.partyId))
          .limit(1);
        expect(parties.length).toBe(1);
        expect(parties[0]?.id).toBe(candidacy.partyId);
      }
    });

    test("should resolve electionsCandidacy.electionId to valid electionsElection.id", async () => {
      const samples = await getSampleRecord(electionsCandidacy, 10);
      for (const candidacy of samples) {
        const elections = await testDb
          .select()
          .from(electionsElection)
          .where(eq(electionsElection.id, candidacy.electionId))
          .limit(1);
        expect(elections.length).toBe(1);
        expect(elections[0]?.id).toBe(candidacy.electionId);
      }
    });
  });

  test.describe("Hansards Relationships", () => {
    test("should resolve hansardsStatement.documentId to valid hansardsDocument.id", async () => {
      const samples = await getSampleRecord(hansardsStatement, 10);
      for (const statement of samples) {
        const documents = await testDb
          .select()
          .from(hansardsDocument)
          .where(eq(hansardsDocument.id, statement.documentId))
          .limit(1);
        expect(documents.length).toBe(1);
        expect(documents[0]?.id).toBe(statement.documentId);
      }
    });

    test("should resolve hansardsStatement.memberId to valid coreElectedmember.id when present", async () => {
      const samples = await getSampleRecord(hansardsStatement, 20);
      const statementsWithMember = samples.filter((s) => s.memberId !== null);

      if (statementsWithMember.length === 0) {
        test.skip();
        return;
      }

      for (const statement of statementsWithMember.slice(0, 10)) {
        if (statement.memberId) {
          const members = await testDb
            .select()
            .from(coreElectedmember)
            .where(eq(coreElectedmember.id, statement.memberId))
            .limit(1);
          expect(members.length).toBe(1);
          expect(members[0]?.id).toBe(statement.memberId);
        }
      }
    });

    test("should resolve hansardsStatement.politicianId to valid corePolitician.id when present", async () => {
      const samples = await getSampleRecord(hansardsStatement, 20);
      const statementsWithPolitician = samples.filter(
        (s) => s.politicianId !== null
      );

      if (statementsWithPolitician.length === 0) {
        test.skip();
        return;
      }

      for (const statement of statementsWithPolitician.slice(0, 10)) {
        if (statement.politicianId) {
          const politicians = await testDb
            .select()
            .from(corePolitician)
            .where(eq(corePolitician.id, statement.politicianId))
            .limit(1);
          expect(politicians.length).toBe(1);
          expect(politicians[0]?.id).toBe(statement.politicianId);
        }
      }
    });

    test("should resolve hansardsStatement.billDebatedId to valid billsBill.id when present", async () => {
      const samples = await getSampleRecord(hansardsStatement, 20);
      const statementsWithBill = samples.filter(
        (s) => s.billDebatedId !== null
      );

      if (statementsWithBill.length === 0) {
        test.skip();
        return;
      }

      for (const statement of statementsWithBill.slice(0, 10)) {
        if (statement.billDebatedId) {
          const bills = await testDb
            .select()
            .from(billsBill)
            .where(eq(billsBill.id, statement.billDebatedId))
            .limit(1);
          expect(bills.length).toBe(1);
          expect(bills[0]?.id).toBe(statement.billDebatedId);
        }
      }
    });

    test("should resolve hansardsDocument.sessionId to valid coreSession.id", async () => {
      const samples = await getSampleRecord(hansardsDocument, 10);
      for (const doc of samples) {
        const sessions = await testDb
          .select()
          .from(coreSession)
          .where(eq(coreSession.id, doc.sessionId))
          .limit(1);
        expect(sessions.length).toBe(1);
        expect(sessions[0]?.id).toBe(doc.sessionId);
      }
    });
  });
});
