import { describe, expect, it } from "vitest";

async function loadIconModule() {
  const modulePath = "./ui/icons";
  return import(/* @vite-ignore */ modulePath).catch(() => null);
}

describe("shared web icon system", () => {
  it("uses the pinned Heroicons outline ellipsis bubble", async () => {
    const iconModule = await loadIconModule();
    expect(iconModule).not.toBeNull();
    if (!iconModule) return;

    expect(iconModule.icons.chat).toContain('data-icon-system="heroicons-outline-24-v2.2.0"');
    expect(iconModule.icons.chat).toContain("M8.625 12a.375.375");
    expect(iconModule.icons.chat).toContain("M21 12c0 4.556");
  });
});
