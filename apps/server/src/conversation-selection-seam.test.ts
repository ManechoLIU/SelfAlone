import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";

const appSource = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("conversation selection shared seam", () => {
  it("registers selection routes in the real app composition between conversation and trial", async () => {
    const listQuestions = vi.fn(async (accountId: string, conversationId: string) => {
      expect(accountId).toBe("account-a");
      expect(conversationId).toBe("conversation-a");
      return [];
    });
    const app = createApp({
      readiness: async () => true,
      auth: {
        isProductionEnvironment: () => false,
        getAccount: async (token: string | undefined) => (
          token === "session-a" ? { id: "account-a" } : null
        ),
      },
      conversation: {
        listSessions: async () => [],
        createSession: async (_accountId: string, id: string) => ({
          id,
          revision: 1,
          draft: null,
          context: [],
          activeRun: null,
          tasks: [],
          works: [],
          deleted: false,
        }),
        getSession: async () => null,
        sendText: async () => {
          throw new Error("unused");
        },
      },
      selection: {
        listQuestions,
        getQuestion: async () => null,
        createQuestion: async () => {
          throw new Error("unused");
        },
        answerQuestion: async () => {
          throw new Error("unused");
        },
      },
      trialQuota: {
        getStatus: async () => ({ status: "claimed", claimedAt: null }),
        claim: async () => ({ status: "claimed", claimedAt: null }),
      },
    } as never);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/conversations/conversation-a/selection-questions",
        headers: {
          cookie: "selfalone_session=session-a",
          "x-selfalone-account": "attacker-selected-account",
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ questions: [] });
      expect(listQuestions).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("keeps the route and migration order explicit at the composition seam", () => {
    expect(appSource.indexOf("registerConversationRoutes")).toBeLessThan(
      appSource.indexOf("registerConversationSelectionRoutes"),
    );
    expect(appSource.indexOf("registerConversationSelectionRoutes")).toBeLessThan(
      appSource.indexOf("registerTrialQuotaRoutes"),
    );
    expect(indexSource.indexOf("migrateConversationSchema")).toBeLessThan(
      indexSource.indexOf("migrateConversationSelectionSchema"),
    );
    expect(indexSource.indexOf("migrateConversationSelectionSchema")).toBeLessThan(
      indexSource.indexOf("migrateTrialQuotaSchema"),
    );
  });
});
