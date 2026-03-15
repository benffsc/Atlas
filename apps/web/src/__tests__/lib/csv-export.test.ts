import { describe, it, expect } from "vitest";
import { generateCsv } from "@/lib/csv-export";

// =============================================================================
// generateCsv
// =============================================================================

describe("generateCsv", () => {
  it("generates CSV with headers and rows", () => {
    const headers = ["Name", "Age", "City"];
    const rows = [
      ["Alice", 30, "Petaluma"],
      ["Bob", 25, "Santa Rosa"],
    ];
    const csv = generateCsv(headers, rows);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Name,Age,City");
    expect(lines[1]).toBe("Alice,30,Petaluma");
    expect(lines[2]).toBe("Bob,25,Santa Rosa");
  });

  it("handles empty rows", () => {
    const csv = generateCsv(["A", "B"], []);
    expect(csv).toBe("A,B");
  });

  it("quotes values containing commas", () => {
    const csv = generateCsv(["Name", "Address"], [
      ["Alice", "123 Main St, Suite 4"],
    ]);
    const lines = csv.split("\n");
    expect(lines[1]).toBe('Alice,"123 Main St, Suite 4"');
  });

  it("doubles quotes inside quoted values", () => {
    const csv = generateCsv(["Name", "Quote"], [
      ["Alice", 'She said "hello"'],
    ]);
    const lines = csv.split("\n");
    expect(lines[1]).toBe('Alice,"She said ""hello"""');
  });

  it("quotes values containing newlines", () => {
    const csv = generateCsv(["Name", "Notes"], [
      ["Alice", "Line 1\nLine 2"],
    ]);
    const lines = csv.split("\n");
    // The newline within the quoted value means the raw split will produce extra lines,
    // but the actual CSV cell should be quoted
    expect(csv).toContain('"Line 1\nLine 2"');
  });

  it("converts null to empty string", () => {
    const csv = generateCsv(["Name", "Email"], [
      ["Alice", null],
    ]);
    const lines = csv.split("\n");
    expect(lines[1]).toBe("Alice,");
  });

  it("converts undefined to empty string", () => {
    const csv = generateCsv(["Name", "Email"], [
      ["Alice", undefined],
    ]);
    const lines = csv.split("\n");
    expect(lines[1]).toBe("Alice,");
  });

  it("handles boolean values", () => {
    const csv = generateCsv(["Name", "Active"], [
      ["Alice", true],
      ["Bob", false],
    ]);
    const lines = csv.split("\n");
    expect(lines[1]).toBe("Alice,true");
    expect(lines[2]).toBe("Bob,false");
  });

  it("handles numbers", () => {
    const csv = generateCsv(["Name", "Score"], [
      ["Alice", 95.5],
    ]);
    const lines = csv.split("\n");
    expect(lines[1]).toBe("Alice,95.5");
  });

  it("handles empty string values", () => {
    const csv = generateCsv(["Name", "Email"], [
      ["Alice", ""],
    ]);
    const lines = csv.split("\n");
    expect(lines[1]).toBe("Alice,");
  });

  it("quotes headers with commas", () => {
    const csv = generateCsv(["Name, First", "Age"], [
      ["Alice", 30],
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe('"Name, First",Age');
  });

  it("handles single column", () => {
    const csv = generateCsv(["Name"], [["Alice"], ["Bob"]]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Name");
    expect(lines[1]).toBe("Alice");
    expect(lines[2]).toBe("Bob");
  });

  it("handles values with both commas and quotes", () => {
    const csv = generateCsv(["Description"], [
      ['He said, "Hello, world!"'],
    ]);
    expect(csv).toContain('"He said, ""Hello, world!"""');
  });

  it("handles zero as a valid value", () => {
    const csv = generateCsv(["Count"], [[0]]);
    const lines = csv.split("\n");
    expect(lines[1]).toBe("0");
  });
});
