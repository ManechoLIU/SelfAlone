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
