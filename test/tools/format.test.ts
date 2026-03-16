import { describe, it, expect } from "vitest";
import {
  textResult,
  errorResult,
  formatTable,
  formatNumber,
  formatPercent,
} from "../../src/tools/format";

describe("textResult", () => {
  it("wraps text in a content array with type text", () => {
    const result = textResult("hello world");

    expect(result).toEqual({
      content: [{ type: "text", text: "hello world" }],
    });
  });

  it("does not set isError", () => {
    const result = textResult("ok");

    expect(result.isError).toBeUndefined();
  });

  it("handles empty string", () => {
    const result = textResult("");

    expect(result.content[0].text).toBe("");
  });
});

describe("errorResult", () => {
  it("sets isError to true", () => {
    const result = errorResult("something broke");

    expect(result.isError).toBe(true);
  });

  it("wraps the message in content array", () => {
    const result = errorResult("bad request");

    expect(result.content).toEqual([{ type: "text", text: "bad request" }]);
  });
});

describe("formatTable", () => {
  it("renders a markdown table with headers and rows", () => {
    const table = formatTable(
      ["Name", "Age"],
      [
        ["Alice", 30],
        ["Bob", 25],
      ],
    );

    expect(table).toBe(
      "| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |",
    );
  });

  it("returns 'No data found.' for empty rows", () => {
    const table = formatTable(["Name", "Age"], []);

    expect(table).toBe("No data found.");
  });

  it("renders null and undefined cells as empty strings", () => {
    const table = formatTable(
      ["A", "B"],
      [[null, undefined]],
    );

    expect(table).toContain("|  |  |");
  });

  it("handles a single row", () => {
    const table = formatTable(["Col"], [["value"]]);

    expect(table).toBe("| Col |\n| --- |\n| value |");
  });
});

describe("formatNumber", () => {
  it("adds commas for thousands", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("does not add commas for numbers under 1000", () => {
    expect(formatNumber(999)).toBe("999");
  });

  it("handles zero", () => {
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatPercent", () => {
  it("formats a decimal as a percentage", () => {
    expect(formatPercent(0.456)).toBe("45.6%");
  });

  it("formats 1.0 as 100.0%", () => {
    expect(formatPercent(1.0)).toBe("100.0%");
  });

  it("formats 0 as 0.0%", () => {
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("rounds to one decimal place", () => {
    expect(formatPercent(0.3333)).toBe("33.3%");
  });
});
