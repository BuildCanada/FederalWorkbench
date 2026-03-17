import { groq } from "@ai-sdk/groq";
import { openai } from "@ai-sdk/openai";
import { customProvider } from "ai";
import { isTestEnvironment } from "../constants";

export const myProvider = isTestEnvironment
  ? (() => {
      const {
        artifactModel,
        chatModel,
        reasoningModel,
        analysisModel,
        smallModel,
        smallModelStructured,
      } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "chat-model-reasoning": reasoningModel,
          "artifact-model": artifactModel,
          "analysis-model": analysisModel,
          "small-model": smallModel,
          "small-model-structured": smallModelStructured,
        },
      });
    })()
  : customProvider({
      languageModels: {
        // Primary chat model
        "chat-model": openai("gpt-5.1"),
        // Reasoning model - use .responses() to get reasoning parts
        "chat-model-reasoning": openai.responses("gpt-5.1"),
        // Fast
        "small-model": openai("gpt-5-nano"),
        // Fast structured output model
        "small-model-structured": openai("gpt-5-nano"),
        // Medium
        "medium-model": openai("gpt-5-mini"),
        // Artifact generation
        "artifact-model": groq("moonshotai/kimi-k2-instruct"),
        // Analysis model
        "analysis-model": groq("moonshotai/kimi-k2-instruct"),
      },
    });
