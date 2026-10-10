import { describe, expect, it } from "vitest";

import { kindOfHeading, splitReleaseSections } from "./release-sections";

describe("kindOfHeading", () => {
  it("recognises the release-please English and the Vietnamese headings", () => {
    expect(["Added", "Features", "Thêm", "Tính năng mới"].map(kindOfHeading)).toEqual([
      "features",
      "features",
      "features",
      "features",
    ]);
    expect(["Changed", "Thay đổi", "Cải thiện"].map(kindOfHeading)).toEqual([
      "improvements",
      "improvements",
      "improvements",
    ]);
    expect(["Fixed", "Bug fixes", "Sửa lỗi"].map(kindOfHeading)).toEqual([
      "fixes",
      "fixes",
      "fixes",
    ]);
    expect(["Security", "Removed", ""].map(kindOfHeading)).toEqual(["other", "other", "other"]);
  });
});

describe("splitReleaseSections", () => {
  it("splits at ### headings, keeps each heading and gives back the notes when joined", () => {
    const notes = "### Added\n\n- A\n- B\n\n### Fixed\n\n- C\n\n### Security\n\n- D";
    const sections = splitReleaseSections(notes);
    expect(sections.map((section) => section.kind)).toEqual(["features", "fixes", "other"]);
    expect(sections[0]!.markdown.startsWith("### Added")).toBe(true);
    expect(sections.map((section) => section.markdown).join("\n")).toBe(notes);
  });

  it("puts text before the first heading in 'other' and ignores empty input", () => {
    expect(splitReleaseSections("Giới thiệu\n\n### Thêm\n\n- A").map((s) => s.kind)).toEqual([
      "other",
      "features",
    ]);
    expect(splitReleaseSections("  \n")).toEqual([]);
  });

  it("does not split inside a code fence", () => {
    const notes = "### Added\n\n```md\n### Fixed\n```\n";
    expect(splitReleaseSections(notes).map((section) => section.kind)).toEqual(["features"]);
  });
});
