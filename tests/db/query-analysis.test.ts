import { expect, test } from "@playwright/test";
import {
  analyzeQuery,
  detectLanguage,
} from "@/lib/rag/parliament/query-analysis";

test.describe("Query Analysis", () => {
  test("detectLanguage returns English for English text", () => {
    const result = detectLanguage("What is the parliament bill?");
    expect(result.language).toBe("en");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test("detectLanguage returns French for French text", () => {
    const result = detectLanguage("Qu'est-ce que le projet de loi ?");
    expect(result.language).toBe("fr");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test("detectLanguage defaults to English for empty text", () => {
    const result = detectLanguage("");
    expect(result.language).toBe("en");
    expect(result.confidence).toBe(0);
  });

  test("analyzeQuery returns structured result with bill number and reformulations (EN)", async () => {
    const query = "What is Bill C-11?";
    const result = await analyzeQuery(query);
    expect(result.originalQuery).toBe(query);
    expect(result.language).toBe("en");
    expect(result.languageConfidence).toBeDefined();
    expect(Array.isArray(result.reformulatedQueries)).toBe(true);
    expect(result.reformulatedQueries.length).toBeGreaterThan(0);
    expect(result.entities.billNumbers?.includes("C-11")).toBe(true);
  });

  test("analyzeQuery returns structured result with bill number and reformulations (FR)", async () => {
    const query = "Qu'est-ce que le projet de loi C-11 ?";
    const result = await analyzeQuery(query);
    expect(result.originalQuery).toBe(query);
    expect(result.language).toBe("fr");
    expect(result.languageConfidence).toBeDefined();
    expect(Array.isArray(result.reformulatedQueries)).toBe(true);
    expect(result.reformulatedQueries.length).toBeGreaterThan(0);
    expect(result.entities.billNumbers?.includes("C-11")).toBe(true);
  });
});
