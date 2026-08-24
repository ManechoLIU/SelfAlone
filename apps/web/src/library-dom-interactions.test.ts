import { describe, expect, it, vi } from "vitest";
import {
  bindLibrarySearchInteractions,
  createLibraryPollingScheduler,
  createLatestLibraryRequest,
} from "./library-state";
import type { LibraryLoadState } from "./library-state";

class SearchInput extends EventTarget {
  value = "";
  focusCount = 0;

  focus() {
    this.focusCount += 1;
  }
}

function keyboardEvent(key: string) {
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperty(event, "key", { value: key });
  return event as Event & { key: string };
}

describe("library search DOM interactions", () => {
  it("debounces input for 300ms but lets Enter submit the latest query immediately", () => {
    vi.useFakeTimers();
    const form = new EventTarget();
    const input = new SearchInput();
    const searches: string[] = [];
    const unbind = bindLibrarySearchInteractions({
      form,
      input,
      debounceMs: 300,
      onSearch: (query) => searches.push(query),
    });

    input.value = "  山河  ";
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(299);
    expect(searches).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(searches).toEqual(["山河"]);

    input.value = "远山";
    input.dispatchEvent(new Event("input"));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(searches).toEqual(["山河", "远山"]);
    vi.advanceTimersByTime(300);
    expect(searches).toEqual(["山河", "远山"]);

    unbind();
    vi.useRealTimers();
  });

  it("requests an empty query immediately for native clear and Escape", () => {
    vi.useFakeTimers();
    const form = new EventTarget();
    const input = new SearchInput();
    const searches: string[] = [];
    const unbind = bindLibrarySearchInteractions({
      form,
      input,
      debounceMs: 300,
      onSearch: (query) => searches.push(query),
    });

    input.value = "山";
    input.dispatchEvent(new Event("input"));
    input.value = "";
    input.dispatchEvent(new Event("search"));
    expect(searches).toEqual([""]);

    input.value = "水";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(keyboardEvent("Escape"));
    expect(input.value).toBe("");
    expect(searches).toEqual(["", ""]);
    vi.advanceTimersByTime(300);
    expect(searches).toEqual(["", ""]);

    unbind();
    vi.useRealTimers();
  });

  it("aborts the previous request and rejects its result after a newer query starts", () => {
    const latest = createLatestLibraryRequest();
    const first = latest.begin();
    const second = latest.begin();

    expect(first.signal.aborted).toBe(true);
    expect(latest.isCurrent(first.id)).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(latest.isCurrent(second.id)).toBe(true);
  });

  it("stops a processing poll before a search can be preempted and restarts after the search result", () => {
    vi.useFakeTimers();
    try {
      const onPoll = vi.fn();
      const polling = createLibraryPollingScheduler(onPoll, 700);
      const processingBooks: LibraryLoadState["books"] = [{
        id: "processing-book",
        title: "正在解析的书",
        author: null,
        format: "txt",
        sourceLabel: "本地",
        parseStatus: "processing",
        errorCode: null,
        sectionCount: 0,
        pageCount: null,
        createdAt: "2026-08-25T00:00:00.000Z",
      }];

      polling.sync({ searching: false, searchError: "", books: processingBooks });
      vi.advanceTimersByTime(699);
      polling.stop();
      vi.advanceTimersByTime(1);
      expect(onPoll).not.toHaveBeenCalled();

      polling.sync({ searching: false, searchError: "", books: processingBooks });
      vi.advanceTimersByTime(700);
      expect(onPoll).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
