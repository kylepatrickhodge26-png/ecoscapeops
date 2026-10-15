// Public request form: a signed-out visitor can send a request through a business's secret
// link and can read nothing back; requests are owner-only; the limits are enforced by the
// database; switching the link off or regenerating it stops it working at once.
import { beforeAll, describe, expect, it } from "vitest";

import { anonClient, joinCrew, signUpOwner, type TestCrew, type TestOwner } from "./helpers";

const NOT_FOUND = "P0002";
const INVALID = "22023";
const LIMITED = "P0429";
const DENIED = "42501";

function submit(token: string, ip: string, fields: Partial<{ name: string; phone: string; email: string; address: string; details: string }> = {}) {
  return anonClient().rpc("submit_request", {
    token,
    name: "Jo Smith",
    phone: "631-555-0100",
    email: "",
    address: "12 Oak St, Lake Grove NY",
    details: "Mow my lawn",
    ip_hash: ip,
    ...fields,
  });
}

async function openLink(owner: TestOwner, enable = true) {
  const { data } = await owner.client.rpc("request_link");
  if (enable) expect((await owner.client.rpc("set_request_link_enabled", { enabled: true })).error).toBeNull();
  return data![0].token;
}

describe("request form", () => {
  let alpha: TestOwner;
  let bravo: TestOwner;
  let crew: TestCrew;
  let tokenA: string;
  let tokenB: string;
  const ip = () => `ip-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    alpha = await signUpOwner("req-alpha", "Alpha Lawn");
    bravo = await signUpOwner("req-bravo", "Bravo Lawn");
    crew = await joinCrew(alpha, "Casey");
    tokenA = await openLink(alpha, false);
    tokenB = await openLink(bravo);
  });

  it("stays shut until the owner turns the link on", async () => {
    expect(tokenA).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenA).not.toBe(tokenB);
    expect((await anonClient().rpc("public_request_form", { token: tokenA })).data).toEqual([]);
    expect((await submit(tokenA, ip())).error?.code).toBe(NOT_FOUND);
    expect((await alpha.client.rpc("set_request_link_enabled", { enabled: true })).error).toBeNull();
    expect((await anonClient().rpc("public_request_form", { token: tokenA })).data).toEqual([{ business_name: "Alpha Lawn" }]);
    expect((await submit("a".repeat(64), ip())).error?.code).toBe(NOT_FOUND);
  });

  it("files a request under the link's own business and nothing else", async () => {
    expect((await submit(tokenA, ip(), { name: "<b>Eve</b>", details: "<script>alert(1)</script>" })).error).toBeNull();
    const { data: mine } = await alpha.client.from("requests").select("name, details, status");
    expect(mine).toContainEqual({ name: "<b>Eve</b>", details: "<script>alert(1)</script>", status: "new" });
    const { data: theirs } = await bravo.client.from("requests").select("id");
    expect(theirs).toEqual([]);
  });

  it("checks every field", async () => {
    for (const bad of [{ name: " " }, { phone: "", email: "" }, { email: "nope" }, { details: " " }, { details: "d".repeat(1501) }, { address: "a".repeat(201) }, { phone: "5".repeat(41) }]) {
      expect((await submit(tokenA, ip(), bad)).error?.code).toBe(INVALID);
    }
  });

  it("lets a signed-out visitor read and write nothing directly", async () => {
    const anon = anonClient();
    expect((await anon.from("requests").select("id")).error).not.toBeNull();
    expect((await anon.from("request_links").select("token")).error).not.toBeNull();
    expect((await anon.from("requests").insert({ business_id: alpha.businessId, name: "x", details: "x", phone: "1", ip_hash: "h" })).error).not.toBeNull();
    expect((await alpha.client.from("requests").insert({ business_id: alpha.businessId, name: "x", details: "x", phone: "1", ip_hash: "h" })).error).not.toBeNull();
  });

  it("keeps requests and the link away from crew and other businesses", async () => {
    expect((await crew.client.from("requests").select("id")).data).toEqual([]);
    expect((await crew.client.from("request_links").select("token")).data).toEqual([]);
    expect((await crew.client.rpc("request_link")).error?.code).toBe(DENIED);
    expect((await crew.client.rpc("set_request_link_enabled", { enabled: false })).error?.code).toBe(DENIED);
    expect((await crew.client.rpc("regenerate_request_link")).error?.code).toBe(DENIED);
    const { data: links } = await bravo.client.from("request_links").select("token");
    expect(links).toEqual([{ token: tokenB }]);
  });

  it("limits repeats per connection and per business", async () => {
    const same = ip();
    for (let i = 0; i < 3; i++) expect((await submit(tokenB, same)).error).toBeNull();
    expect((await submit(tokenB, same)).error?.code).toBe(LIMITED);
    expect((await submit(tokenB, ip())).error).toBeNull();
  });

  it("converts once, dismisses, and deletes only handled requests", async () => {
    await submit(tokenA, ip(), { name: "Ann Lee", phone: "631-555-0111", details: "Weekly mowing" });
    const { data: rows } = await alpha.client.from("requests").select("id").eq("name", "Ann Lee");
    const id = rows![0].id;
    expect((await crew.client.rpc("convert_request", { request_id: id })).error?.code).toBe(DENIED);
    expect((await bravo.client.rpc("convert_request", { request_id: id })).error?.code).toBe(NOT_FOUND);
    const first = await alpha.client.rpc("convert_request", { request_id: id });
    const again = await alpha.client.rpc("convert_request", { request_id: id });
    expect(first.error).toBeNull();
    expect(again.data).toBe(first.data);
    const { data: customers } = await alpha.client.from("customers").select("first_name, last_name, service_notes").eq("id", first.data!);
    expect(customers).toEqual([{ first_name: "Ann", last_name: "Lee", service_notes: "Requested: Weekly mowing" }]);

    await submit(tokenA, ip(), { name: "Bob" });
    const { data: bob } = await alpha.client.from("requests").select("id").eq("name", "Bob");
    expect((await alpha.client.rpc("delete_request", { request_id: bob![0].id })).error?.code).toBe(NOT_FOUND);
    expect((await bravo.client.rpc("dismiss_request", { request_id: bob![0].id })).error?.code).toBe(NOT_FOUND);
    expect((await alpha.client.rpc("dismiss_request", { request_id: bob![0].id })).error).toBeNull();
    expect((await alpha.client.rpc("delete_request", { request_id: bob![0].id })).error).toBeNull();
  });

  it("stops the old link the moment it's regenerated or switched off", async () => {
    const fresh = (await alpha.client.rpc("regenerate_request_link")).data!;
    expect(fresh).not.toBe(tokenA);
    expect((await submit(tokenA, ip())).error?.code).toBe(NOT_FOUND);
    expect((await anonClient().rpc("public_request_form", { token: tokenA })).data).toEqual([]);
    expect((await submit(fresh, ip())).error).toBeNull();
    await alpha.client.rpc("set_request_link_enabled", { enabled: false });
    expect((await submit(fresh, ip())).error?.code).toBe(NOT_FOUND);
    expect((await bravo.client.rpc("request_link")).data![0].token).toBe(tokenB);
  });
});
