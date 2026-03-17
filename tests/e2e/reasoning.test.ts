import { expect, test } from "../fixtures";
import { ChatPage } from "../pages/chat";

test.describe("chat activity with reasoning", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ curieContext }) => {
    chatPage = new ChatPage(curieContext.page);
    await chatPage.createNewChat();
  });

  test.skip("Curie can send message and generate response with reasoning", async () => {
    // Verify the reasoning model is selected
    await expect(chatPage.getSelectedModel()).resolves.toEqual(
      "Reasoning model"
    );

    await chatPage.sendUserMessage("Why is the sky blue?");
    await chatPage.isGenerationComplete();

    const assistantMessage = await chatPage.getRecentAssistantMessage();
    expect(assistantMessage.content).toBe("It's just blue duh!");

    expect(assistantMessage.reasoning).toBe(
      "The sky is blue because of rayleigh scattering!"
    );
  });

  test.skip("Curie can toggle reasoning visibility", async () => {
    // Verify the reasoning model is selected
    await expect(chatPage.getSelectedModel()).resolves.toEqual(
      "Reasoning model"
    );

    await chatPage.sendUserMessage("Why is the sky blue?");
    await chatPage.isGenerationComplete();

    const assistantMessage = await chatPage.getRecentAssistantMessage();
    const reasoningContentElement = assistantMessage.element.getByTestId(
      "message-reasoning-content"
    );
    expect(reasoningContentElement).toBeVisible();

    await assistantMessage.toggleReasoningVisibility();
    await expect(reasoningContentElement).not.toBeVisible();

    await assistantMessage.toggleReasoningVisibility();
    await expect(reasoningContentElement).toBeVisible();
  });

  test.skip("Curie can edit message and resubmit", async () => {
    // Verify the reasoning model is selected
    await expect(chatPage.getSelectedModel()).resolves.toEqual(
      "Reasoning model"
    );

    await chatPage.sendUserMessage("Why is the sky blue?");
    await chatPage.isGenerationComplete();

    const assistantMessage = await chatPage.getRecentAssistantMessage();
    const reasoningElement =
      assistantMessage.element.getByTestId("message-reasoning");
    expect(reasoningElement).toBeVisible();

    const userMessage = await chatPage.getRecentUserMessage();

    const generationCompletePromise = chatPage.isGenerationComplete();
    await userMessage.edit("Why is grass green?");
    await generationCompletePromise;

    const updatedAssistantMessage = await chatPage.getRecentAssistantMessage();

    expect(updatedAssistantMessage.content).toBe("It's just green duh!");

    expect(updatedAssistantMessage.reasoning).toBe(
      "Grass is green because of chlorophyll absorption!"
    );
  });
});
