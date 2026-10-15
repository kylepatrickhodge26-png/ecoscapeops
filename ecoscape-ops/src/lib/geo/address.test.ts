import { describe, expect, it } from "vitest";

import { customerQuery, hasState, hasTown, shopAddressProblem, tidyAddress } from "./address";

const SHOP = { city: "Lake Ronkonkoma", state: "NY" };

describe("customerQuery", () => {
  it.each([
    // A bare street is anchored to the shop's town and state.
    ["12 Oak St", "12 Oak St, Lake Ronkonkoma, NY"],
    ["  12   Oak St  ", "12 Oak St, Lake Ronkonkoma, NY"],
    ["12 Oak St, Apt 4", "12 Oak St, Apt 4, Lake Ronkonkoma, NY"],
    ["12 Oak St #2", "12 Oak St #2, Lake Ronkonkoma, NY"],
    ["12 Oak St NE", "12 Oak St NE, Lake Ronkonkoma, NY"],
    ["10 Downing St", "10 Downing St, Lake Ronkonkoma, NY"],
    // Its own town is kept; the shop's state is added.
    ["12 Oak St, Lake Grove", "12 Oak St, Lake Grove, NY"],
    ["12 Oak St, Lake Grove 11755", "12 Oak St, Lake Grove, NY 11755"],
    ["12 Oak St 11755", "12 Oak St, NY 11755"],
    ["12 Oak St\nLake Grove", "12 Oak St, Lake Grove, NY"],
    // Its own state is kept as it is (the distance check catches a wrong one).
    ["12 Oak St, Lake Grove, NY 11755", "12 Oak St, Lake Grove, NY 11755"],
    ["12 Oak St, Lake Grove NY", "12 Oak St, Lake Grove NY"],
    ["12 Oak St, Greenwich, CT", "12 Oak St, Greenwich, CT"],
    ["12 Oak St, Greenwich, Connecticut", "12 Oak St, Greenwich, Connecticut"],
    ["12 Oak St, Lake Grove, ny", "12 Oak St, Lake Grove, ny"],
    // The country is always the US: a typed one is dropped.
    ["12 Oak St, Lake Grove, NY, USA", "12 Oak St, Lake Grove, NY"],
    ["12 Oak St, United States", "12 Oak St, Lake Ronkonkoma, NY"],
  ])("%j → %j", (address, query) => {
    expect(customerQuery(address, SHOP)).toBe(query);
  });

  it("is null for a blank address", () => {
    expect(customerQuery("   ", SHOP)).toBeNull();
    expect(customerQuery(", ,", SHOP)).toBeNull();
  });

  it("without a shop to anchor to, looks up the address as typed", () => {
    expect(customerQuery("12 Oak St", null)).toBe("12 Oak St");
  });
});

describe("hasState / hasTown", () => {
  it("tells a state from a street direction or a town", () => {
    expect(hasState("12 Oak St NE")).toBe(false);
    expect(hasState("12 Oak St, NE")).toBe(true);
    expect(hasState("12 Oak St, Omaha NE 68102")).toBe(true);
    expect(hasState("12 Oak St, Lake Grove")).toBe(false);
    expect(hasTown("12 Oak St, Suite 100")).toBe(false);
    expect(hasTown("12 Oak St, Lake Grove")).toBe(true);
  });
});

describe("tidyAddress", () => {
  it("collapses lines and spaces and drops the country", () => {
    expect(tidyAddress(" 1 Main St,\n Islip ,  NY 11751 , U.S.A. ")).toBe("1 Main St, Islip, NY 11751");
    expect(tidyAddress("12 Oak St,, Lake Grove,")).toBe("12 Oak St, Lake Grove");
    expect(tidyAddress("12 Columbus Ave")).toBe("12 Columbus Ave");
  });
});

describe("shopAddressProblem", () => {
  it("needs the shop's own town and state, or ZIP", () => {
    expect(shopAddressProblem("")).toBe("Enter the shop's address");
    expect(shopAddressProblem("61 Clarendon Rd")).toContain("Include the town and state");
    expect(shopAddressProblem("61 Clarendon Rd, Lake Ronkonkoma")).toContain("Include the town and state");
    expect(shopAddressProblem("61 Clarendon Rd, Lake Ronkonkoma, NY")).toBeNull();
    expect(shopAddressProblem("61 Clarendon Rd 11779")).toBeNull();
  });
});
