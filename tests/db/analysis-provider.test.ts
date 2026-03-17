import { expect, test } from "@playwright/test";
import { generateText } from "ai";
import { myProvider } from "@/lib/ai/providers";

test.describe("Analysis Provider Mapping", () => {
  test("myProvider exposes analysis-model and can be called", async () => {
    const model = myProvider.languageModel("analysis-model");
    expect(model).toBeTruthy();

    const { text } = await generateText({ model, prompt: "Say hello" });
    expect(text).toBe("Hello, world!");
  });
});
