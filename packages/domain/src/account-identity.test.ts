import { describe, expect, it } from "vitest";
import { planIdentityAssociation } from "./account-identity";

describe("account identity association", () => {
  it("creates an independent account when a new identity skips binding", () => {
    expect(
      planIdentityAssociation({
        newAccountId: "account-wechat-new",
        reverified: false,
      }),
    ).toEqual({
      kind: "create_independent_account",
      accountId: "account-wechat-new",
    });
  });

  it("retires only the empty identity account after explicit reverification", () => {
    expect(
      planIdentityAssociation({
        identityAccount: { id: "account-wechat-empty", hasData: false },
        requestedAccount: { id: "account-email-with-data", hasData: true },
        newAccountId: "unused",
        reverified: true,
      }),
    ).toEqual({
      kind: "retire_empty_account",
      accountId: "account-email-with-data",
      retiredAccountId: "account-wechat-empty",
    });
  });

  it("requires reverification before associating different accounts", () => {
    expect(() =>
      planIdentityAssociation({
        identityAccount: { id: "account-wechat-empty", hasData: false },
        requestedAccount: { id: "account-email-with-data", hasData: true },
        newAccountId: "unused",
        reverified: false,
      }),
    ).toThrow("REAUTHENTICATION_REQUIRED");
  });

  it("rejects association when both existing accounts contain data", () => {
    expect(() =>
      planIdentityAssociation({
        identityAccount: { id: "account-wechat-with-data", hasData: true },
        requestedAccount: { id: "account-email-with-data", hasData: true },
        newAccountId: "unused",
        reverified: true,
      }),
    ).toThrow("ACCOUNT_DATA_MERGE_NOT_SUPPORTED");
  });

  it("treats an already-associated identity as an idempotent no-op", () => {
    expect(
      planIdentityAssociation({
        identityAccount: { id: "account-existing", hasData: true },
        requestedAccount: { id: "account-existing", hasData: true },
        newAccountId: "unused",
        reverified: false,
      }),
    ).toEqual({
      kind: "use_existing_account",
      accountId: "account-existing",
    });
  });
});
