/**
 * Schema validation tests for Parliament database tables
 * Tests table structure using information_schema (does not require data)
 */

import { expect, test } from "@playwright/test";
import { sql } from "drizzle-orm";

import { testDb } from "./utils";

/**
 * Helper to check if a table exists in the parliament schema
 */
async function tableExists(tableName: string): Promise<boolean> {
  const result = await testDb.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'parliament' AND table_name = ${tableName}
    ) as exists
  `);
  return result[0]?.exists === true;
}

/**
 * Helper to get column information for a table
 */
async function getColumns(
  tableName: string
): Promise<
  Array<{ column_name: string; data_type: string; is_nullable: string }>
> {
  const result = await testDb.execute(sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'parliament' AND table_name = ${tableName}
    ORDER BY ordinal_position
  `);
  return result as unknown as Array<{
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>;
}

test.describe("Parliament Schema - Table Structure Validation", () => {
  test.describe("Bills Tables", () => {
    test("bills_bill table exists with required columns", async () => {
      expect(await tableExists("bills_bill")).toBe(true);

      const columns = await getColumns("bills_bill");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("name_en");
      expect(columnNames).toContain("name_fr");
      expect(columnNames).toContain("number");
      expect(columnNames).toContain("number_only");
      expect(columnNames).toContain("session_id");
      expect(columnNames).toContain("status_code");
      expect(columnNames).toContain("short_title_en");
      expect(columnNames).toContain("short_title_fr");
      expect(columnNames).toContain("added");
      expect(columnNames).toContain("institution");
      expect(columnNames).toContain("library_summary_available");
      expect(columnNames).toContain("sponsor_member_id");
      expect(columnNames).toContain("status_date");
      expect(columnNames).toContain("introduced");
      expect(columnNames).toContain("legisinfo_id");
    });

    test("bills_bill has correct column types", async () => {
      const columns = await getColumns("bills_bill");
      const columnMap = new Map(columns.map((c) => [c.column_name, c]));

      expect(columnMap.get("id")?.data_type).toBe("integer");
      expect(["text", "character varying"]).toContain(
        columnMap.get("name_en")?.data_type
      );
      expect(["text", "character varying"]).toContain(
        columnMap.get("name_fr")?.data_type
      );
      expect(["text", "character varying"]).toContain(
        columnMap.get("number")?.data_type
      );
      expect(["integer", "smallint"]).toContain(
        columnMap.get("number_only")?.data_type
      );
      expect(["character", "character varying"]).toContain(
        columnMap.get("session_id")?.data_type
      );
      expect(["date", "timestamp with time zone"]).toContain(
        columnMap.get("added")?.data_type
      );
      expect(columnMap.get("library_summary_available")?.data_type).toBe(
        "boolean"
      );
    });

    test("bills_billtext table exists with required columns", async () => {
      expect(await tableExists("bills_billtext")).toBe(true);

      const columns = await getColumns("bills_billtext");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("bill_id");
      expect(columnNames).toContain("docid");
      expect(columnNames).toContain("text_en");
      expect(columnNames).toContain("text_fr");
      expect(columnNames).toContain("summary_en");
    });

    test("bills_membervote table exists with required columns", async () => {
      expect(await tableExists("bills_membervote")).toBe(true);

      const columns = await getColumns("bills_membervote");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("member_id");
      expect(columnNames).toContain("politician_id");
      expect(columnNames).toContain("votequestion_id");
      expect(columnNames).toContain("vote");
      expect(columnNames).toContain("dissent");
    });

    test("bills_partyvote table exists with required columns", async () => {
      expect(await tableExists("bills_partyvote")).toBe(true);

      const columns = await getColumns("bills_partyvote");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("party_id");
      expect(columnNames).toContain("votequestion_id");
      expect(columnNames).toContain("vote");
    });

    test("bills_votequestion table exists with required columns", async () => {
      expect(await tableExists("bills_votequestion")).toBe(true);

      const columns = await getColumns("bills_votequestion");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("date");
      expect(columnNames).toContain("yea_total");
      expect(columnNames).toContain("nay_total");
      expect(columnNames).toContain("paired_total");
      expect(columnNames).toContain("result");
      expect(columnNames).toContain("number");
    });

    test("bills_votequestion has correct column types for vote totals", async () => {
      const columns = await getColumns("bills_votequestion");
      const columnMap = new Map(columns.map((c) => [c.column_name, c]));

      expect(["integer", "smallint"]).toContain(
        columnMap.get("yea_total")?.data_type
      );
      expect(["integer", "smallint"]).toContain(
        columnMap.get("nay_total")?.data_type
      );
      expect(["integer", "smallint"]).toContain(
        columnMap.get("paired_total")?.data_type
      );
      expect(columnMap.get("date")?.data_type).toBe("date");
    });
  });

  test.describe("Committees Tables", () => {
    test("committees_committee table exists with required columns", async () => {
      expect(await tableExists("committees_committee")).toBe(true);

      const columns = await getColumns("committees_committee");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("name_en");
      expect(columnNames).toContain("name_fr");
      expect(columnNames).toContain("slug");
      expect(columnNames).toContain("display");
      expect(columnNames).toContain("parent_id");
    });

    test("committees_committeeactivity table exists with required columns", async () => {
      expect(await tableExists("committees_committeeactivity")).toBe(true);

      const columns = await getColumns("committees_committeeactivity");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("committee_id");
      expect(columnNames).toContain("name_en");
      expect(columnNames).toContain("name_fr");
      expect(columnNames).toContain("study");
    });

    test("committees_committeeactivityinsession table exists with required columns", async () => {
      expect(await tableExists("committees_committeeactivityinsession")).toBe(
        true
      );

      const columns = await getColumns("committees_committeeactivityinsession");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("activity_id");
      expect(columnNames).toContain("session_id");
      expect(columnNames).toContain("source_id");
    });

    test("committees_committeeinsession table exists with required columns", async () => {
      expect(await tableExists("committees_committeeinsession")).toBe(true);

      const columns = await getColumns("committees_committeeinsession");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("committee_id");
      expect(columnNames).toContain("session_id");
      expect(columnNames).toContain("acronym");
    });

    test("committees_committeemeeting table exists with required columns", async () => {
      expect(await tableExists("committees_committeemeeting")).toBe(true);

      const columns = await getColumns("committees_committeemeeting");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("date");
      expect(columnNames).toContain("start_time");
      expect(columnNames).toContain("committee_id");
      expect(columnNames).toContain("session_id");
      expect(columnNames).toContain("evidence_id");
    });

    test("committees_committeemeeting_activities junction table exists", async () => {
      expect(await tableExists("committees_committeemeeting_activities")).toBe(
        true
      );

      const columns = await getColumns(
        "committees_committeemeeting_activities"
      );
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("committeemeeting_id");
      expect(columnNames).toContain("committeeactivity_id");
    });

    test("committees_committeereport table exists with required columns", async () => {
      expect(await tableExists("committees_committeereport")).toBe(true);

      const columns = await getColumns("committees_committeereport");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("committee_id");
      expect(columnNames).toContain("session_id");
      expect(columnNames).toContain("name_en");
      expect(columnNames).toContain("name_fr");
      expect(columnNames).toContain("adopted_date");
      expect(columnNames).toContain("presented_date");
    });
  });

  test.describe("Core Tables", () => {
    test("core_politician table exists with required columns", async () => {
      expect(await tableExists("core_politician")).toBe(true);

      const columns = await getColumns("core_politician");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("name");
      expect(columnNames).toContain("name_given");
      expect(columnNames).toContain("name_family");
      expect(columnNames).toContain("slug");
      expect(columnNames).toContain("gender");
    });

    test("core_electedmember table exists with required columns", async () => {
      expect(await tableExists("core_electedmember")).toBe(true);

      const columns = await getColumns("core_electedmember");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("politician_id");
      expect(columnNames).toContain("riding_id");
      expect(columnNames).toContain("party_id");
      expect(columnNames).toContain("start_date");
      expect(columnNames).toContain("end_date");
    });

    test("core_electedmember_sessions junction table exists", async () => {
      expect(await tableExists("core_electedmember_sessions")).toBe(true);

      const columns = await getColumns("core_electedmember_sessions");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("electedmember_id");
      expect(columnNames).toContain("session_id");
    });

    test("core_party table exists with required columns", async () => {
      expect(await tableExists("core_party")).toBe(true);

      const columns = await getColumns("core_party");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("name_en");
      expect(columnNames).toContain("name_fr");
      expect(columnNames).toContain("short_name_en");
      expect(columnNames).toContain("short_name_fr");
      expect(columnNames).toContain("slug");
    });

    test("core_partyalternatename table exists with required columns", async () => {
      expect(await tableExists("core_partyalternatename")).toBe(true);

      const columns = await getColumns("core_partyalternatename");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("name");
      expect(columnNames).toContain("party_id");
    });

    test("core_riding table exists with required columns", async () => {
      expect(await tableExists("core_riding")).toBe(true);

      const columns = await getColumns("core_riding");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("name_en");
      expect(columnNames).toContain("name_fr");
      expect(columnNames).toContain("province");
      expect(columnNames).toContain("slug");
      expect(columnNames).toContain("current");
    });

    test("core_session table exists with required columns", async () => {
      expect(await tableExists("core_session")).toBe(true);

      const columns = await getColumns("core_session");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("name");
      expect(columnNames).toContain("start");
      expect(columnNames).toContain("end");
    });

    test("core_politicianinfo table exists with required columns", async () => {
      expect(await tableExists("core_politicianinfo")).toBe(true);

      const columns = await getColumns("core_politicianinfo");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("politician_id");
      expect(columnNames).toContain("schema");
      expect(columnNames).toContain("value");
    });
  });

  test.describe("Elections Tables", () => {
    test("elections_election table exists with required columns", async () => {
      expect(await tableExists("elections_election")).toBe(true);

      const columns = await getColumns("elections_election");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("date");
      expect(columnNames).toContain("byelection");
    });

    test("elections_candidacy table exists with required columns", async () => {
      expect(await tableExists("elections_candidacy")).toBe(true);

      const columns = await getColumns("elections_candidacy");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("candidate_id");
      expect(columnNames).toContain("riding_id");
      expect(columnNames).toContain("party_id");
      expect(columnNames).toContain("election_id");
      expect(columnNames).toContain("votetotal");
      expect(columnNames).toContain("votepercent");
      expect(columnNames).toContain("elected");
    });
  });

  test.describe("Hansards Tables", () => {
    test("hansards_document table exists with required columns", async () => {
      expect(await tableExists("hansards_document")).toBe(true);

      const columns = await getColumns("hansards_document");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("number");
      expect(columnNames).toContain("session_id");
      expect(columnNames).toContain("document_type");
      expect(columnNames).toContain("source_id");
      expect(columnNames).toContain("multilingual");
      expect(columnNames).toContain("public");
      expect(columnNames).toContain("downloaded");
    });

    test("hansards_statement table exists with required columns", async () => {
      expect(await tableExists("hansards_statement")).toBe(true);

      const columns = await getColumns("hansards_statement");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("document_id");
      expect(columnNames).toContain("time");
      expect(columnNames).toContain("sequence");
      expect(columnNames).toContain("wordcount");
      expect(columnNames).toContain("content_en");
      expect(columnNames).toContain("content_fr");
      expect(columnNames).toContain("h1_en");
      expect(columnNames).toContain("h2_en");
      expect(columnNames).toContain("h3_en");
      expect(columnNames).toContain("h1_fr");
      expect(columnNames).toContain("h2_fr");
      expect(columnNames).toContain("h3_fr");
      expect(columnNames).toContain("slug");
    });

    test("hansards_statement_bills junction table exists", async () => {
      expect(await tableExists("hansards_statement_bills")).toBe(true);

      const columns = await getColumns("hansards_statement_bills");
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("statement_id");
      expect(columnNames).toContain("bill_id");
    });

    test("hansards_statement_mentioned_politicians junction table exists", async () => {
      expect(
        await tableExists("hansards_statement_mentioned_politicians")
      ).toBe(true);

      const columns = await getColumns(
        "hansards_statement_mentioned_politicians"
      );
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("statement_id");
      expect(columnNames).toContain("politician_id");
    });
  });
});
