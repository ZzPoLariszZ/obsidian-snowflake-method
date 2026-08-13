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
  it("renders a value and every clause, and reads them back", () => {
    const record: RecordLine = {
      label: label("Member"),
      value: "Guild Master",
      clauses: [
        {
          kind: "target",
          term: link("Novel/60_Worldbuilding/63_Item/Adventurer Guild", "Guild"),
        },
        {
          kind: "at",
          term: link("Novel/60_Worldbuilding/62_Location/Royal Capital"),
        },
        { kind: "when", term: link("Novel/60_Worldbuilding/61_Time/Year 1023") },
      ],
    };
    const line = renderRecordLine("en", record);
    expect(line).toBe(
      "- [[Novel/60_Worldbuilding/Relationship#Member|Member]]: Guild Master -> [[Novel/60_Worldbuilding/63_Item/Adventurer Guild|Guild]] at [[Novel/60_Worldbuilding/62_Location/Royal Capital|Royal Capital]] when [[Novel/60_Worldbuilding/61_Time/Year 1023|Year 1023]]",
    );
    expect(parseRecordLine("en", line)).toEqual(record);
  });

  it("round-trips a bare label, a value alone, and a clause alone", () => {
    const records: RecordLine[] = [
      { label: label("Missing"), value: "", clauses: [] },
      { label: label("Age"), value: "18", clauses: [] },
      {
        label: label("Injured"),
        value: "",
        clauses: [{ kind: "when", term: link("P/61_Time/Battle of Red Valley") }],
      },
    ];
    for (const record of records) {
      expect(parseRecordLine("en", renderRecordLine("en", record))).toEqual(
        record,
      );
    }
  });

  it("keeps several references of the same kind, in the order given", () => {
    const record: RecordLine = {
      label: label("Ally"),
      value: "",
      clauses: [
        { kind: "with", term: link("P/20_Character/Aria", "Aria") },
        { kind: "with", term: link("P/20_Character/Brin", "Brin") },
        { kind: "at", term: link("P/62_Location/Capital") },
      ],
    };
    const line = renderRecordLine("en", record);
    expect(line).toBe(
      "- [[Novel/60_Worldbuilding/Relationship#Ally|Ally]] with [[P/20_Character/Aria|Aria]] with [[P/20_Character/Brin|Brin]] at [[P/62_Location/Capital|Capital]]",
    );
    expect(parseRecordLine("en", line)).toEqual(record);
  });

  it("round-trips the Chinese connectors", () => {
    const record: RecordLine = {
      label: { path: "小说/60_世界观/关系", heading: "盟友", display: "盟友" },
      value: "同盟",
      clauses: [
        { kind: "target", term: link("小说/60_世界观/63_物品/精灵王国", "精灵王国") },
        { kind: "at", term: link("小说/60_世界观/62_地点/皇都", "皇都") },
        { kind: "when", term: link("小说/60_世界观/61_时间/1023年", "1023年") },
      ],
    };
    const line = renderRecordLine("zh-CN", record);
    expect(line).toContain("：同盟");
    expect(line).toContain(" 在 ");
    expect(line).toContain(" 于 ");
    expect(parseRecordLine("zh-CN", line)).toEqual(record);
  });

  it("writes a period's own span behind it, and reads the line back without it", () => {
    const record: RecordLine = {
      label: label("Missing"),
      value: "",
      clauses: [
        { kind: "when", term: link("P/61_Time/The Regency", "The Regency") },
      ],
    };
    const spans = (path: string) =>
      path === "P/61_Time/The Regency"
        ? { start: link("P/61_Time/Year 1020"), end: link("P/61_Time/Year 1024") }
        : null;
    const line = renderRecordLine("en", record, spans);
    expect(line).toBe(
      "- [[Novel/60_Worldbuilding/Relationship#Missing|Missing]] when [[P/61_Time/The Regency|The Regency]] (from [[P/61_Time/Year 1020|Year 1020]] to [[P/61_Time/Year 1024|Year 1024]])",
    );
    // The span is the time note's, not the record's, so reading gives back
    // exactly the record that was written.
    expect(parseRecordLine("en", line)).toEqual(record);
    // And writing it again adds one span, never two.
    expect(renderRecordLine("en", parseRecordLine("en", line) as RecordLine, spans)).toBe(line);
  });

  it("leaves a bracket an author wrote in a value alone", () => {
    const line =
      "- [[P/World_Status#Note|Note]]: taken (from the vault) when [[P/61_Time/Year 1020|Year 1020]]";
    const parsed = parseRecordLine("en", line);
    expect(parsed?.value).toBe("taken (from the vault)");
    expect(parsed?.clauses).toEqual([
      { kind: "when", term: link("P/61_Time/Year 1020", "Year 1020") },
    ]);
  });

  it("still reads a span written before periods were notes", () => {
    const line =
      "- [[P/Relationship#Member|Member]] from [[P/1023]] to [[P/1025]]";
    const parsed = parseRecordLine("en", line);
    expect(parsed?.clauses).toEqual([
      { kind: "span", start: link("P/1023"), end: link("P/1025") },
    ]);
    // What it reads it writes back, with the names each link is read out by.
    expect(renderRecordLine("en", parsed as RecordLine)).toBe(
      "- [[P/Relationship#Member|Member]] from [[P/1023|1023]] to [[P/1025|1025]]",
    );
  });

  it("does not split on connector words inside a link", () => {
    const record: RecordLine = {
      label: label("Injured"),
      value: "",
      clauses: [{ kind: "when", term: link("P/61_Time/Battle at Red Valley") }],
    };
    const line = renderRecordLine("en", record);
    expect(parseRecordLine("en", line)).toEqual(record);
  });

  it("reads clauses in whatever order they were written", () => {
    const parsed = parseRecordLine(
      "en",
      "- [[P/Relationship#Ally|Ally]] at [[P/Capital]] -> [[P/Kingdom]]",
    );
    expect(parsed?.clauses.map((clause) => clause.kind)).toEqual([
      "at",
      "target",
    ]);
  });

  it("rejects a period missing its end", () => {
    expect(
      parseRecordLine("en", "- [[P/Relationship#Ally|Ally]] from [[P/1023]]"),
    ).toBeNull();
  });

  it("rejects loose text where the value separator should be", () => {
    expect(
      parseRecordLine(
        "en",
        "- [[P/Relationship#Ally|Ally]] indeed -> [[P/Kingdom]]",
      ),
    ).toBeNull();
    expect(
      parseRecordLine("en", "- [[P/Relationship#Ally|Ally]]: -> [[P/Kingdom]]"),
    ).toBeNull();
  });
});

describe("details lines", () => {
  it("round-trips a plain value, a linked value, and their time clauses", () => {
    const cases = [
      {
        property: "owner" as const,
        value: link("P/20_Character/Aria", "Aria"),
        location: null,
        time: null,
      },
      {
        property: "owner" as const,
        value: text("the crown"),
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
      property: "owner",
      value: text("王室"),
      location: null,
      time: null,
    });
    expect(line).toBe("- **所有者**：王室");
    expect(parseDetailsLine("zh-CN", line)).toEqual({
      property: "owner",
      value: text("王室"),
      location: null,
      time: null,
    });
  });

  it("refuses an arrow clause on a details line", () => {
    expect(
      parseDetailsLine("en", "- **Owner**: [[P/Aria]] -> [[P/Somewhere]]"),
    ).toBeNull();
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
        "- [[P/World_Status#Injured|Injured]] when [[P/Battle|Battle]]",
        "- [[P/World_Status#Missing|Missing]]",
        "a stray note someone typed",
      ].join("\n"),
    );
  });

  it("reads CRLF content line by line", () => {
    const parsed = parseDetailsSection(
      "en",
      "- **Owner**: [[P/Aria|Aria]]\r\n- **Owner**: the crown\r\n",
    );
    expect(parsed.details.map((line) => line.property)).toEqual([
      "owner",
      "owner",
    ]);
    expect(parsed.unrecognized).toEqual([]);
    expect(renderDetailsSection("en", parsed.details)).toBe(
      "- **Owner**: [[P/Aria|Aria]]\n- **Owner**: the crown",
    );
  });
});

describe("terms", () => {
  it("reads a link with and without alias, and anything else as text", () => {
    expect(parseTerm("[[A/B/C|Name]]")).toEqual(link("A/B/C", "Name"));
    expect(parseTerm("[[A/B/C]]")).toEqual(link("A/B/C", "C"));
    expect(parseTerm("plain words")).toEqual(text("plain words"));
  });

  it("writes the name a link is read out by, unless it is the link", () => {
    expect(renderTerm(link("A/B/C", "C"))).toBe("[[A/B/C|C]]");
    expect(renderTerm(link("A/B/C", "Name"))).toBe("[[A/B/C|Name]]");
    // A note at the vault root already reads as its name.
    expect(renderTerm(link("C", "C"))).toBe("[[C]]");
    expect(renderTerm(text("23"))).toBe("23");
  });
});
