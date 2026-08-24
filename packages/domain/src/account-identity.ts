export type AccountState = {
  id: string;
  hasData: boolean;
};

export type IdentityAssociationPlan =
  | { kind: "create_independent_account"; accountId: string }
  | { kind: "use_existing_account"; accountId: string }
  | { kind: "attach_identity"; accountId: string }
  | { kind: "retire_empty_account"; accountId: string; retiredAccountId: string };

export type IdentityAssociationInput = {
  identityAccount?: AccountState;
  requestedAccount?: AccountState;
  newAccountId: string;
  reverified: boolean;
};

export function planIdentityAssociation(
  input: IdentityAssociationInput,
): IdentityAssociationPlan {
  const { identityAccount, requestedAccount } = input;

  if (!identityAccount && !requestedAccount) {
    return {
      kind: "create_independent_account",
      accountId: input.newAccountId,
    };
  }

  if (identityAccount && (!requestedAccount || identityAccount.id === requestedAccount.id)) {
    return {
      kind: "use_existing_account",
      accountId: identityAccount.id,
    };
  }

  if (!input.reverified) {
    throw new Error("REAUTHENTICATION_REQUIRED");
  }

  if (!identityAccount && requestedAccount) {
    return {
      kind: "attach_identity",
      accountId: requestedAccount.id,
    };
  }

  if (!identityAccount || !requestedAccount) {
    throw new Error("INVALID_IDENTITY_ASSOCIATION");
  }

  if (identityAccount.hasData && requestedAccount.hasData) {
    throw new Error("ACCOUNT_DATA_MERGE_NOT_SUPPORTED");
  }

  if (identityAccount.hasData) {
    return {
      kind: "retire_empty_account",
      accountId: identityAccount.id,
      retiredAccountId: requestedAccount.id,
    };
  }

  return {
    kind: "retire_empty_account",
    accountId: requestedAccount.id,
    retiredAccountId: identityAccount.id,
  };
}
