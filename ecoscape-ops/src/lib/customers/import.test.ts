import { describe, expect, it } from "vitest";

import { MAX_IMPORT_ROWS, buildImport, guessRoles, headerRoles, splitName, splitRows } from "./import";

describe("splitting a pasted list or a CSV file", () => {
  it("uses tabs when it came from a spreadsheet", () => {
    expect(splitRows("John Smith\t631-555-0100\nKaren Lopez\t631-555-0101")).toEqual([
      ["John Smith", "631-555-0100"],
      ["Karen Lopez", "631-555-0101"],
    ]);
  });
  it("uses commas otherwise, with quoted values and Windows line endings", () => {
    expect(splitRows('Name,Address\r\n"Smith, John","12 Main St, Lake Ronkonkoma"\r\n"Bob ""Bud"" Jones",3 Elm St')).toEqual([
      ["Name", "Address"],
      ["Smith, John", "12 Main St, Lake Ronkonkoma"],
      ['Bob "Bud" Jones', "3 Elm St"],
    ]);
  });
});

describe("working out the columns", () => {
  it("reads column names in the first row", () => {
    expect(headerRoles(["First Name", "Last Name", "Mobile", "E-mail", "Street Address", "Gate code"])).toEqual([
      "first_name",
      "last_name",
      "phone",
      "email",
      "address",
      "notes",
    ]);
  });
  it("doesn't take a row of customers for column names", () => {
    expect(headerRoles(["John Smith", "631-555-0100", "12 Main St"])).toBeNull();
  });
  it("guesses columns from what's in them when there are no names", () => {
    const rows = [
      ["John Smith", "631-555-0100", "12 Main St", "john@example.com"],
      ["Karen Lopez", "(631) 555-0101", "40 Oak Ave", "karen@example.com"],
    ];
    expect(guessRoles(rows, 4)).toEqual(["name", "phone", "address", "email"]);
  });
});

describe("splitting a full name", () => {
  it.each([
    ["John Smith", "John", "Smith"],
    ["Smith, John", "John", "Smith"],
    ["Mary Ann  Lee", "Mary Ann", "Lee"],
    ["Cher", "Cher", ""],
  ])("%s", (full, first, last) => {
    expect(splitName(full)).toEqual({ first, last });
  });
});

describe("building the customers to add", () => {
  it("makes one customer per row, with the address put together from its parts", () => {
    const result = buildImport(
      "Name,Phone,Email,Address,City,State,Zip,Notes\nJohn Smith,631-555-0100,John@Example.com,12 Main St,Lake Ronkonkoma,ny,11779,Gate code 1234",
    );
    expect(result.hasHeader).toBe(true);
    expect(result.rows).toEqual([
      {
        line: 2,
        first_name: "John",
        last_name: "Smith",
        phone: "631-555-0100",
        email: "john@example.com",
        property_address: "12 Main St, Lake Ronkonkoma, NY 11779",
        service_notes: "Gate code 1234",
      },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("leaves out empty rows and rows with no way to reach anyone, and says why", () => {
    const result = buildImport("Name\tPhone\tAddress\nJohn Smith\t631-555-0100\t12 Main St\n\n\t\t40 Oak Ave\n");
    expect(result.rows.map((r) => r.first_name)).toEqual(["John"]);
    expect(result.skipped).toEqual([{ line: 4, reason: "No name, phone or email" }]);
  });

  it("keeps a customer whose email doesn't look right, without the email", () => {
    const result = buildImport("Name,Email\nJohn Smith,john at example");
    expect(result.rows[0].email).toBe("");
    expect(result.rows[0].warning).toMatch(/left out/);
  });

  it("uses the columns the owner picked", () => {
    const result = buildImport("12 Main St,John Smith", { roles: ["address", "name"], hasHeader: false });
    expect(result.rows[0]).toMatchObject({ first_name: "John", last_name: "Smith", property_address: "12 Main St" });
  });

  it("can treat the first row as a customer, when the owner says it isn't column names", () => {
    const result = buildImport("Phone\n631-555-0100", { roles: ["phone"], hasHeader: false });
    expect(result.rows.map((r) => r.phone)).toEqual(["Phone", "631-555-0100"]);
  });

  it(`stops at ${MAX_IMPORT_ROWS} customers`, () => {
    const list = Array.from({ length: MAX_IMPORT_ROWS + 2 }, (_, i) => `Customer ${i},631-555-${String(i).padStart(4, "0")}`).join("\n");
    const result = buildImport(list);
    expect(result.rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0].reason).toMatch(/limit/);
  });

  it("keeps long values within the customer's limits", () => {
    const result = buildImport(`Name,Notes\n${"A".repeat(150)},${"n".repeat(2500)}`);
    expect(result.rows[0].first_name).toHaveLength(100);
    expect(result.rows[0].service_notes).toHaveLength(2000);
  });
});
