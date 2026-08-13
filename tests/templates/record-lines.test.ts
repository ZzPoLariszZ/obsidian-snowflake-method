import { describe, expect, it } from "vitest";

import {
  parseRecordLine,
  parseRecordSection,
  parseTerm,
  renderRecordLine,
  renderRecordSection,
  renderTerm,
  type RecordLine,
} from "../../src/templates/record-lines";

const label = (name: string, display = name) => ({
  path: `Novel/60_Worldbuilding/Relationship/${display}/_self`,
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
      "[[Novel/60_Worldbuilding/Relationship/Member/_self|Member]]: Guild Master -> [[Novel/60_Worldbuilding/63_Item/Adventurer Guild|Guild]] at [[Novel/60_Worldbuilding/62_Location/Royal Capital|Royal Capital]] when [[Novel/60_Worldbuilding/61_Time/Year 1023|Year 1023]]",
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
      "[[Novel/60_Worldbuilding/Relationship/Ally/_self|Ally]] with [[P/20_Character/Aria|Aria]] with [[P/20_Character/Brin|Brin]] at [[P/62_Location/Capital|Capital]]",
    );
    expect(parseRecordLine("en", line)).toEqual(record);
  });

  it("round-trips the Chinese connectors", () => {
    const record: RecordLine = {
      label: { path: "小说/60_世界观/关系/盟友/_self", display: "盟友" },
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
      "[[Novel/60_Worldbuilding/Relationship/Missing/_self|Missing]] when [[P/61_Time/The Regency|The Regency]] (from [[P/61_Time/Year 1020|Year 1020]] to [[P/61_Time/Year 1024|Year 1024]])",
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
    // What it reads it writes back in today's shape, names and label alike.
    expect(renderRecordLine("en", parsed as RecordLine)).toBe(
      "[[P/Relationship/Member/_self|Member]] from [[P/1023|1023]] to [[P/1025|1025]]",
    );
  });

  it("maps a legacy heading label onto the node it names", () => {
    const parsed = parseRecordLine(
      "en",
      "- [[P/20_Character/23_Relationship#Sibling|Family/Sibling]] -> [[P/20_Character/Brin|Brin]]",
    );
    // The file it pointed into is the folder the tree stands at now, and the
    // alias was already the taxonomy path: together they name the node.
    expect(parsed?.label).toEqual({
      path: "P/20_Character/23_Relationship/Family/Sibling/_self",
      display: "Family/Sibling",
    });
    expect(renderRecordLine("en", parsed as RecordLine)).toBe(
      "[[P/20_Character/23_Relationship/Family/Sibling/_self|Family/Sibling]] -> [[P/20_Character/Brin|Brin]]",
    );
  });

  it("keeps a line opened by an ordinary link out of the records", () => {
    expect(
      parseRecordLine("en", "- [[P/20_Character/Aria|Aria]] said so"),
    ).toBeNull();
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
    // Written as a titled callout, which is what says which section it is now
    // that the sections carry no headings.
    expect(
      renderRecordSection(
        "en",
        "world-status",
        parsed.records,
        parsed.unrecognized,
      ),
    ).toBe(
      [
        "> [!info] World status",
        "> [[P/World_Status/Injured/_self|Injured]] when [[P/Battle|Battle]]",
        ">",
        "> [[P/World_Status/Missing/_self|Missing]]",
        ">",
        "> a stray note someone typed",
      ].join("\n"),
    );
  });

  it("reads a section back out of the callout it was written in", () => {
    const written = renderRecordSection("zh-CN", "relationships", [
      {
        label: { path: "P/23_Relationship/Family/_self", display: "Family" },
        value: "",
        clauses: [{ kind: "target", term: link("P/Bob", "Bob") }],
      },
    ]);
    expect(written.split("\n")[0]).toBe("> [!info] 关系");
    const parsed = parseRecordSection("zh-CN", written);
    expect(parsed.unrecognized).toEqual([]);
    expect(parsed.records).toHaveLength(1);
    expect(renderRecordSection("zh-CN", "relationships", parsed.records)).toBe(
      written,
    );
  });

  it("reads CRLF content line by line", () => {
    const parsed = parseRecordSection(
      "en",
      "- [[P/World_Status/Injured/_self|Injured]]\r\n- [[P/World_Status/Missing/_self|Missing]]\r\n",
    );
    expect(parsed.records.map((record) => record.label.display)).toEqual([
      "Injured",
      "Missing",
    ]);
    expect(parsed.unrecognized).toEqual([]);
  });
});

describe("terms", () => {
  it("reads a link with and without alias, and anything else as text", () => {
    expect(parseTerm("[[A/B/C|Name]]")).toEqual(link("A/B/C", "Name"));
    expect(parseTerm("[[A/B/C]]")).toEqual(link("A/B/C", "C"));
    expect(parseTerm("plain words")).toEqual(text("plain words"));
    // The node file every definition folder holds is a file name, never a
    // name: a bare link to one is read by the folder that is the node.
    expect(parseTerm("[[A/B/Elf/_self]]")).toEqual(link("A/B/Elf/_self", "Elf"));
  });

  it("writes the name a link is read out by, unless it is the link", () => {
    expect(renderTerm(link("A/B/C", "C"))).toBe("[[A/B/C|C]]");
    expect(renderTerm(link("A/B/C", "Name"))).toBe("[[A/B/C|Name]]");
    // A note at the vault root already reads as its name.
    expect(renderTerm(link("C", "C"))).toBe("[[C]]");
    expect(renderTerm(text("23"))).toBe("23");
  });
});
