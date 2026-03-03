import { describe, expect, it } from "vitest";

import { parseApolloCsv, suggestApolloMapping } from "@/lib/people/import/parsers/apollo";

describe("apollo parser", () => {
  it("suggests mappings from headers", () => {
    const mapping = suggestApolloMapping(["Name", "Email", "Title", "Company", "LinkedIn"]);
    expect(mapping.fullName).toBe("Name");
    expect(mapping.email).toBe("Email");
    expect(mapping.position).toBe("Title");
  });

  it("parses valid rows", () => {
    const csv = [
      "Name,Email,Company,Title,LinkedIn",
      "Jane Doe,jane@example.com,Acme,Talent Partner,https://linkedin.com/in/jane-doe",
    ].join("\n");

    const result = parseApolloCsv(csv, {
      fullName: "Name",
      email: "Email",
      company: "Company",
      position: "Title",
      linkedinUrl: "LinkedIn",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].source).toBe("apollo");
    expect(result.rows[0].identityKey.startsWith("apollo:")).toBe(true);
  });

  it("rejects rows without identity fields", () => {
    const csv = [
      "Name,Company,Title",
      "Jane Doe,Acme,Engineer",
    ].join("\n");

    const result = parseApolloCsv(csv, {
      fullName: "Name",
      company: "Company",
      position: "Title",
    });

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});
