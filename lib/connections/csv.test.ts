import { describe, expect, it } from "vitest";

import { parseConnectionsCsv } from "@/lib/connections/csv";

describe("parseConnectionsCsv", () => {
  it("parses valid csv rows", () => {
    const csv = [
      "First Name,Last Name,URL,Email,Company,Position,Connected On",
      "Jane,Doe,https://www.linkedin.com/in/jane-doe,jane@example.com,Acme Inc,Engineer,2024-01-10",
    ].join("\n");

    const result = parseConnectionsCsv(csv);
    expect(result.totalRows).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].identityKey).toBe("profile:https://www.linkedin.com/in/jane-doe");
  });

  it("records invalid rows when identity cannot be created", () => {
    const csv = [
      "First Name,Last Name,URL,Company,Position,Connected On",
      "Jane,Doe,,Acme Inc,Engineer,",
    ].join("\n");

    const result = parseConnectionsCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rowNumber).toBe(2);
  });

  it("parses linkedin exports that include notes before the header row", () => {
    const csv = [
      "Notes:",
      "\"When exporting your connection data...\"",
      "",
      "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
      "Jane,Doe,https://www.linkedin.com/in/jane-doe,jane@example.com,Acme Inc,Engineer,20 Feb 2026",
    ].join("\n");

    const result = parseConnectionsCsv(csv);
    expect(result.totalRows).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].firstName).toBe("Jane");
    expect(result.rows[0].email).toBe("jane@example.com");
  });

  it("supports UTF-8 BOM on header row", () => {
    const csv = [
      "\uFEFFFirst Name,Last Name,URL,Email Address,Company,Position,Connected On",
      "Jane,Doe,https://www.linkedin.com/in/jane-doe,jane@example.com,Acme Inc,Engineer,20 Feb 2026",
    ].join("\n");

    const result = parseConnectionsCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });
});
