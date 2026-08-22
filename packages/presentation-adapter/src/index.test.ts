import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateDevelopmentPptx } from "./index";

describe("development presentation adapter", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
    temporaryDirectories.length = 0;
  });

  it("writes a native widescreen PPTX for every requested page", async () => {
    const directory = await mkdtemp(join(tmpdir(), "selfalone-pptx-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "result.pptx");

    const result = await generateDevelopmentPptx(
      {
        title: "《长安的荔枝》读书分享",
        pages: [
          { title: "千里转运", body: "一颗荔枝如何穿越盛唐" },
          { title: "制度之困", body: "把不可能任务拆成可验证问题" },
          { title: "普通人的选择", body: "在限制中保留善意与担当" },
        ],
      },
      outputPath,
    );

    const file = await readFile(outputPath);
    expect(file.subarray(0, 2).toString()).toBe("PK");
    expect((await stat(outputPath)).size).toBeGreaterThan(10_000);
    expect(result).toEqual({ outputPath, pageCount: 3, aspectRatio: "16:9" });
  });
});
