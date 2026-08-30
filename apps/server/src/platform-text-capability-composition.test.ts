import { describe, expect, it } from "vitest";
import {
  createConversationResponder,
  type ChatResponderPort,
  type ConversationResponder,
} from "./conversation-responder";

describe("platform text capability composition", () => {
  it("uses the eligible platform capability when no configured user model is available", async () => {
    let platformCalls = 0;
    const platformCapability: ChatResponderPort = {
      async chat(input) {
        platformCalls += 1;
        expect(input).toEqual({
          accountId: "account-a",
          text: "继续当前问题",
          context: [
            {
              id: "request-a:user",
              role: "user",
              text: "继续当前问题",
              requestId: "request-a",
            },
          ],
        });
        return { text: "平台体验回答" };
      },
    };
    const composeResponder = createConversationResponder as unknown as (
      configuredUserModel: ChatResponderPort | undefined,
      eligiblePlatformCapability: ChatResponderPort,
    ) => ConversationResponder;
    const responder = composeResponder(undefined, platformCapability);

    await expect(responder("account-a", "继续当前问题", [
      {
        id: "request-a:user",
        role: "user",
        text: "继续当前问题",
        requestId: "request-a",
      },
    ])).resolves.toBe("平台体验回答");
    expect(platformCalls).toBe(1);
  });
});
