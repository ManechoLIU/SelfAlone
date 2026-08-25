import type { Sql } from "postgres";

export type TrialQuotaStatus = { status: "unclaimed" | "claimed" };

export class TrialQuotaStore {
  constructor(private readonly sql: Sql) {}

  async getStatus(accountId: string): Promise<TrialQuotaStatus> {
    assertAccountId(accountId);
    const [grant] = await this.sql<{ status: "claimed" }[]>`
      SELECT status
      FROM trial_grants
      WHERE account_id = ${accountId}
    `;
    return grant ? { status: "claimed" } : { status: "unclaimed" };
  }

  async claim(accountId: string): Promise<TrialQuotaStatus> {
    assertAccountId(accountId);
    await this.sql`
      INSERT INTO trial_grants (account_id, status)
      VALUES (${accountId}, 'claimed')
      ON CONFLICT (account_id) DO NOTHING
    `;
    return { status: "claimed" };
  }
}

function assertAccountId(accountId: string) {
  if (!accountId.trim()) throw new Error("ACCOUNT_REQUIRED");
}
