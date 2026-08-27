export type PptDraftStage = "requirements" | "outline" | "template" | "submitted";

export type PptTaskStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export type PptTaskSnapshot = {
  id: string;
  status: PptTaskStatus;
  completedPages: number;
  totalPages: number;
  version: number;
  artifactId?: string;
};

export type LocalBookFormat = "epub" | "txt" | "pdf";

export type BookParseStatus = "processing" | "ready_text" | "ready_pages" | "failed";

export type LibraryBookSummary = {
  id: string;
  title: string;
  author: string | null;
  format: LocalBookFormat;
  sourceLabel: "本地";
  parseStatus: BookParseStatus;
  errorCode: string | null;
  sectionCount: number;
  pageCount: number | null;
  createdAt: string;
};

export type LibrarySnapshot = {
  books: LibraryBookSummary[];
};

/** Account ownership is resolved from the authenticated session, never inferred from a resource. */
export type AccountOwner = {
  accountId: string;
};

export type TextLocator = {
  kind: "text";
  fileVersion: number;
  sectionId: string;
  offset: number;
};

export type PdfLocator = {
  kind: "pdf";
  fileVersion: number;
  pageNumber: number;
};

export type ReadingLocator = TextLocator | PdfLocator;

export type ReaderBackground = "light" | "dark";

export type ReadingPosition<TLocator extends ReadingLocator = ReadingLocator> = {
  locator: TLocator;
  background: ReaderBackground;
  version: number;
};

export type TextReaderSection = {
  sectionId: string;
  title: string;
  order: number;
  text: string;
};

export type TextReading = {
  bookId: string;
  title: string;
  author: string | null;
  contentMode: "text";
  fileVersion: number;
  position: ReadingPosition<TextLocator> | null;
};

export type TextReaderSections = {
  fileVersion: number;
  sections: TextReaderSection[];
};

export type SaveTextPositionRequest = {
  expectedVersion: number;
  locator: TextLocator;
  background: ReaderBackground;
};

/** A text-only citation shared by highlights and anchored manual notes. */
export type TextAnnotationSource = {
  locator: TextLocator;
  endOffset: number;
  quote: string;
};

export type TextHighlight = TextAnnotationSource & {
  id: string;
  bookId: string;
  thought: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TextNote = {
  id: string;
  bookId: string;
  body: string;
  source: TextAnnotationSource | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TextAnnotationList = {
  fileVersion: number;
  highlights: TextHighlight[];
  notes: TextNote[];
};

export type CreateTextHighlightRequest = {
  idempotencyKey: string;
  locator: TextLocator;
  endOffset: number;
  quote?: string;
  thought?: string | null;
};

export type UpdateTextHighlightRequest = {
  expectedVersion: number;
  thought: string | null;
};

export type CreateTextNoteRequest = {
  idempotencyKey: string;
  body: string;
  source?: TextAnnotationSource | null;
};

export type UpdateTextNoteRequest = {
  expectedVersion: number;
  body: string;
  /** Optional client echo is only a draft fallback and never the source of truth. */
  source?: TextAnnotationSource | null;
};

export type DeleteTextAnnotationRequest = {
  expectedVersion: number;
};

export type SavedTextHighlightResponse = { status: "saved"; highlight: TextHighlight };
export type SavedTextNoteResponse = { status: "saved"; note: TextNote };
export type DeletedTextAnnotationResponse = { status: "deleted"; id: string };

export type TextAnnotationSaveErrorCode =
  | "HIGHLIGHT_SAVE_FAILED"
  | "HIGHLIGHT_DELETE_FAILED"
  | "NOTE_SAVE_FAILED"
  | "NOTE_DELETE_FAILED"
  | "NOTE_SOURCE_UNVERIFIED";

export type TextAnnotationErrorCode =
  | TextAnnotationSaveErrorCode
  | "VALIDATION_FAILED"
  | "ACCOUNT_REQUIRED"
  | "ACCOUNT_FORBIDDEN"
  | "BOOK_NOT_FOUND"
  | "TEXT_CONTENT_UNAVAILABLE"
  | "STALE_VERSION"
  | "SECTION_NOT_FOUND"
  | "INVALID_VERSION"
  | "INVALID_FILE_VERSION"
  | "INVALID_LOCATOR"
  | "INVALID_HIGHLIGHT_RANGE"
  | "INVALID_HIGHLIGHT_QUOTE"
  | "NOTE_BODY_REQUIRED"
  | "TEXT_TOO_LONG"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_TOO_LONG"
  | "IDEMPOTENCY_KEY_REUSED"
  | "HIGHLIGHT_NOT_FOUND"
  | "NOTE_NOT_FOUND"
  | "INTERNAL_ERROR";

export type TextAnnotationError = { code: TextAnnotationErrorCode };

export type AuthAccount = {
  id: string;
  email: string | null;
};

/** An account returned to a provider-only client may not have an email identity. */
export type WechatMiniappAccount = {
  id: string;
  email: string | null;
};

export type WechatMiniappAuthRequest = {
  code: string;
};

export type WechatMiniappAuthResponse = {
  account: WechatMiniappAccount;
  sessionToken: string;
  expiresAt: string;
};

export type EmailAuthCredentials = {
  email: string;
  password: string;
};

export type RegisterEmailRequest = EmailAuthCredentials;
export type LoginEmailRequest = EmailAuthCredentials;

export type AuthAccountResponse = {
  account: AuthAccount;
};

export type AuthErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_AMBIGUOUS"
  | "WECHAT_LOGIN_UNAVAILABLE"
  | "INVALID_CREDENTIALS"
  | "INVALID_EMAIL"
  | "INVALID_PASSWORD"
  | "EMAIL_ALREADY_REGISTERED"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR";

export type TrialQuotaStatus = {
  status: "unclaimed" | "claimed";
};

export type TextModelProvider = "deepseek" | "kimi" | "glm" | "qwen";

export type TextModelCredentialRequest = {
  provider: TextModelProvider;
  apiKey: string;
  workspaceId?: string;
};

export type TextModelConfigurationStatus = "verified";

export type TextModelCredentialStatus = {
  status: TextModelConfigurationStatus;
  provider: TextModelProvider;
  maskedApiKey: string;
  workspaceId?: string;
  verifiedAt: string;
  catalogVersion: string;
};

export type TextModelCredentialResponse = TextModelCredentialStatus | null;

export type TextModelCredentialErrorCode =
  | "MODEL_CREDENTIALS_INVALID_REQUEST"
  | "MODEL_CREDENTIAL_VALIDATION_FAILED"
  | "MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE"
  | "MODEL_ENCRYPTION_KEY_REQUIRED"
  | "STALE_VERSION";
