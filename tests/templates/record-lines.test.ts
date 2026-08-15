import { describe, expect, it } from "vitest";

import {
  parseDetailsLine,
  parseDetailsSection,
  parseRecordLine,
  parseRecordSection,
  parseTerm,
  renderDetailsLine,
  renderDetailsSection,
  renderRecordLine,
  renderRecordSection,
  renderTerm,
  type RecordLine,
} from "../../src/templates/record-lines";

const label = (heading: string, display = heading) => ({
  path: "Novel/60_Worldbuilding/Relationship",
  heading,
  display,
});

const link = (path: string, name?: string) =>
  ({ kind: "link", path, name: name ?? path.split("/").pop() ?? path }) as const;

const text = (value: string) => ({ kind: "text", text: value }) as const;

describe("record lines", () => {
  it("renders every clause in canonical order and reads them back", () => {
    const record: RecordLine = {
      label: label("Member"),
      target: link("Novel/60_Worldbuilding/63_Item/Adventurer Guild", "Guild"),
      location: link("Novel/60_Worldbuilding/62_Location/Royal Capital"),
      time: {
        kind: "span",
        start: link("Novel/60_Worldbuilding/61_Time/Year 1023"),
        end: link("Novel/60_Worldbuilding/61_Time/Year 1025"),
      },
    };
    const line = renderRecordLine("en", record);
    expect(line).toBe(
      "- [[Novel/60_Worldbuilding/Relationship#Member|Member]] -> [[Novel/60_Worldbuilding/63_Item/Adventurer Guild|Guild]] at [[Novel/60_Worldbuilding/62_Location/Royal Capital]] from [[Novel/60_Worldbuilding/61_Time/Year 1023]] to [[Novel/60_Worldbuilding/61_Time/Year 1025]]",
    );
    expect(parseRecordLine("en", line)).toEqual(record);
  });

  it("round-trips a when clause and a bare label", () => {
    const injured: RecordLine = {
      label: { path: "P/World_Status", heading: "Injured", display: "Injured" },
      target: null,
      location: null,
      time: { kind: "when", at: link("P/61_Time/Battle of Red Valley") },
    };
    const missing: RecordLine = {
      label: { path: "P/World_Status", heading: "Missing", display: "Missing" },
      target: null,
      location: null,
      time: null,
    };
    for (const record of [injured, missing]) {
      const line = renderRecordLine("en", record);
      expect(parseRecordLine("en", line)).toEqual(record);
    }
  });

  it("round-trips the Chinese connectors", () => {
    const record: RecordLine = {
      label: { path: "小说/60_世界观/关系", heading: "盟友", display: "盟友" },
      target: link("小说/60_世界观/63_物品/精灵王国", "精灵王国"),
      location: link("小说/60_世界观/62_地点/皇都", "皇都"),
      time: {
        kind: "span",
        start: link("小说/60_世界观/61_时间/1023年", "1023年"),
        end: link("小说/60_世界观/61_时间/1025年", "1025年"),
      },
    };
    const line = renderRecordLine("zh-CN", record);
    expect(line).toContain(" 在 ");
    expect(line).toContain(" 从 ");
    expect(line).toContain(" 至 ");
    expect(parseRecordLine("zh-CN", line)).toEqual(record);
  });

  it("does not split on connector words inside a link", () => {
    const record: RecordLine = {
      label: label("Injured"),
      target: null,
      location: null,
      time: { kind: "when", at: link("P/61_Time/Battle at Red Valley") },
    };
    const line = renderRecordLine("en", record);
    expect(parseRecordLine("en", line)).toEqual(record);
  });

  it("treats clauses out of canonical order as not the grammar", () => {
    expect(
      parseRecordLine(
        "en",
        "- [[P/Relationship#Ally|Ally]] at [[P/Capital]] -> [[P/Kingdom]]",
      ),
    ).toBeNull();
    expect(
      parseRecordLine(
        "en",
        "- [[P/Relationship#Ally|Ally]] from [[P/1023]] to [[P/1024]] at [[P/Capital]]",
      ),
    ).toBeNull();
  });

  it("rejects a period missing its end", () => {
    expect(
      parseRecordLine("en", "- [[P/Relationship#Ally|Ally]] from [[P/1023]]"),
    ).toBeNull();
  });

  it("rejects loose text between the label and the first connector", () => {
    expect(
      parseRecordLine(
        "en",
        "- [[P/Relationship#Ally|Ally]] indeed -> [[P/Kingdom]]",
      ),
    ).toBeNull();
  });
});

describe("details lines", () => {
  it("round-trips a plain value, a linked value, and their time clauses", () => {
    const cases = [
      { property: "age" as const, value: text("23"), location: null, time: null },
      {
        property: "age" as const,
        value: text("23"),
        location: null,
        time: { kind: "when" as const, at: link("P/61_Time/Year 1003") },
      },
      {
        property: "owner" as const,
        value: link("P/20_Character/Aria", "Aria"),
        location: null,
        time: {
          kind: "span" as const,
          start: link("P/61_Time/Year 1020"),
          end: link("P/61_Time/Year 1022"),
        },
      },
    ];
    for (const details of cases) {
      const line = renderDetailsLine("en", details);
      expect(parseDetailsLine("en", line)).toEqual(details);
    }
  });

  it("uses the localized bold label and separator", () => {
    const line = renderDetailsLine("zh-CN", {
      property: "age",
      value: text("23"),
      location: null,
      time: null,
    });
    expect(line).toBe("- **年龄**：23");
    expect(parseDetailsLine("zh-CN", line)).toEqual({
      property: "age",
      value: text("23"),
      location: null,
      time: null,
    });
  });

  it("refuses an arrow clause on a details line", () => {
    expect(parseDetailsLine("en", "- **Age**: 23 -> [[P/Somewhere]]")).toBeNull();
  });
});

describe("record sections", () => {
  it("keeps unrecognized lines verbatim after the records", () => {
    const content = [
      "- [[P/World_Status#Injured|Injured]] when [[P/Battle]]",
      "a stray note someone typed",
      "- [[P/World_Status#Missing|Missing]]",
    ].join("\n");
    const parsed = parseRecordSection("en", content);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.unrecognized).toEqual(["a stray note someone typed"]);
    expect(
      renderRecordSection("en", parsed.records, parsed.unrecognized),
    ).toBe(
      [
        "- [[P/World_Status#Injured|Injured]] when [[P/Battle]]",
        "- [[P/World_Status#Missing|Missing]]",
        "a stray note someone typed",
      ].join("\n"),
    );
  });

  it("reads CRLF content line by line", () => {
    const parsed = parseDetailsSection(
      "en",
      "- **Age**: 23\r\n- **Owner**: [[P/Aria|Aria]]\r\n",
    );
    expect(parsed.details.map((line) => line.property)).toEqual([
      "age",
      "owner",
    ]);
    expect(parsed.unrecognized).toEqual([]);
    // The redundant alias is normalized away: alias only when it differs.
    expect(renderDetailsSection("en", parsed.details)).toBe(
      "- **Age**: 23\n- **Owner**: [[P/Aria]]",
    );
  });
});

describe("terms", () => {
  it("reads a link with and without alias, and anything else as text", () => {
    expect(parseTerm("[[A/B/C|Name]]")).toEqual(link("A/B/C", "Name"));
    expect(parseTerm("[[A/B/C]]")).toEqual(link("A/B/C", "C"));
    expect(parseTerm("plain words")).toEqual(text("plain words"));
  });

  it("writes the alias only when it differs from the link tail", () => {
    expect(renderTerm(link("A/B/C", "C"))).toBe("[[A/B/C]]");
    expect(renderTerm(link("A/B/C", "Name"))).toBe("[[A/B/C|Name]]");
    expect(renderTerm(text("23"))).toBe("23");
  });
});
