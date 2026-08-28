import { describe, expect, it } from "vitest";
import { createDevelopmentAnnotationsClient } from "./development-annotations";

describe("development annotations QA adapter", () => {
  it("hydrates two deterministic notes for a development book", async () => {
    const client = createDevelopmentAnnotationsClient({ retryDelayMs: 10 });

    const first = await client.getAnnotations("dev-local-ink");
    const second = await client.getAnnotations("dev-local-ink");

    expect(first.notes).toHaveLength(2);
    expect(first.notes.map((note) => note.id)).toEqual([
      "dev-note-dev-local-ink-primary",
      "dev-note-dev-local-ink-follow-up",
    ]);
    expect(second).toEqual(first);
  });

  it("fails the first delete, keeps the row pending for retry, and reaches an empty list exactly once", async () => {
    const client = createDevelopmentAnnotationsClient({ retryDelayMs: 20 });
    const bookId = "dev-local-ink";
    const initial = await client.getAnnotations(bookId);
    const firstNote = initial.notes[0]!;

    await expect(client.deleteNote(bookId, firstNote.id, { expectedVersion: firstNote.version }))
      .resolves.toMatchObject({ status: "failed", id: firstNote.id });
    expect((await client.getAnnotations(bookId)).notes).toHaveLength(2);

    let settled = false;
    const retry = client.deleteNote(bookId, firstNote.id, { expectedVersion: firstNote.version });
    void retry.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await expect(retry).resolves.toEqual({ status: "deleted", id: firstNote.id });
    expect((await client.getAnnotations(bookId)).notes).toHaveLength(1);

    await expect(client.deleteNote(bookId, firstNote.id, { expectedVersion: firstNote.version }))
      .resolves.toMatchObject({ status: "failed", id: firstNote.id });

    const lastNote = (await client.getAnnotations(bookId)).notes[0]!;
    await expect(client.deleteNote(bookId, lastNote.id, { expectedVersion: lastNote.version }))
      .resolves.toMatchObject({ status: "failed", id: lastNote.id });
    await expect(client.deleteNote(bookId, lastNote.id, { expectedVersion: lastNote.version }))
      .resolves.toEqual({ status: "deleted", id: lastNote.id });
    expect((await client.getAnnotations(bookId)).notes).toEqual([]);
  });
});
