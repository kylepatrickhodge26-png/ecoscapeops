// Route ordering: the shop location, cached customer locations, and each route's
// arrow order and one-day starting address. Checks that only the owner stores locations,
// that a changed address or shop never leaves a stale location behind, that a crew
// member sees and changes only their own route, and that nothing crosses businesses.
import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  addCustomer,
  anonClient,
  bookService,
  joinCrew,
  signUpOwner,
  visitsFor,
  type Client,
  type TestCrew,
  type TestOwner,
} from "./helpers";

const PERMISSION_DENIED = "42501";
const INVALID = "22023";
const NOT_FOUND = "P0002";
const DAY = "2030-06-04";

const SHOP = { address: "61 Clarendon Rd, Lake Ronkonkoma, NY", matched_address: "61 CLARENDON RD, LAKE RONKONKOMA, NY, 11779", city: "Lake Ronkonkoma", state: "NY", postal_code: "11779", lat: 40.835, lon: -73.11 };

const setShop = (client: Client, fields: Partial<typeof SHOP> = {}) => client.rpc("set_shop_location", { ...SHOP, ...fields });

const locate = (client: Client, customerId: string, address: string, fields: { status?: "located" | "not_found" | "flagged"; lat?: number | null; lon?: number | null; matched?: string; miles?: number | null } = {}) =>
  client.rpc("record_customer_geocode", {
    customer_id: customerId,
    address,
    status: fields.status ?? "located",
    lat: (fields.lat === undefined ? 40.84 : fields.lat) as number,
    lon: (fields.lon === undefined ? -73.1 : fields.lon) as number,
    matched_address: fields.matched ?? `${address.toUpperCase()}, NY`,
    distance_miles: (fields.miles === undefined ? 1.2 : fields.miles) as number,
  });

async function geoOf(owner: TestOwner, customerId: string) {
  const { data } = await owner.client
    .from("customers")
    .select("geo_status, geo_lat, geo_lon, geo_matched_address, geo_distance_miles")
    .eq("id", customerId)
    .single();
  return data!;
}

async function visitOn(owner: TestOwner, customerId: string, crew: string | null, date = DAY) {
  const plan = await bookService(owner, customerId, { frequency: "one_time", start_date: date, assigned_crew_member_id: crew });
  return (await visitsFor(owner, plan.id))[0];
}

const routeDays = async (owner: TestOwner) =>
  (await owner.client.from("route_days").select("crew_member_id, route_date, manual_order, start_address, start_lat").eq("business_id", owner.businessId)).data!;

describe("the shop location", () => {
  let acme: TestOwner;
  let maria: TestCrew;
  let birch: TestOwner;

  beforeAll(async () => {
    acme = await signUpOwner("route-shop", "Acme Lawn Care");
    maria = await joinCrew(acme, "Maria");
    birch = await signUpOwner("route-shop-birch", "Birch Tree Services");
  });

  it("is saved by the owner and read back only by them", async () => {
    expect((await setShop(acme.client, { state: " ny " })).error).toBeNull();
    const { data } = await acme.client.from("shop_locations").select("address, city, state, postal_code, lat, lon").single();
    expect(data).toEqual({ address: SHOP.address, city: "Lake Ronkonkoma", state: "NY", postal_code: "11779", lat: 40.835, lon: -73.11 });

    // Crew, other businesses and signed-out visitors can't read or change it.
    expect((await maria.client.from("shop_locations").select("*")).data).toEqual([]);
    expect((await birch.client.from("shop_locations").select("*").eq("business_id", acme.businessId)).data).toEqual([]);
    expect((await anonClient().from("shop_locations").select("*")).error?.code).toBe(PERMISSION_DENIED);
    expect((await setShop(maria.client, { address: "1 Crew St, Elsewhere, NY" })).error?.code).toBe(PERMISSION_DENIED);
    expect((await setShop(anonClient())).error?.code).toBe(PERMISSION_DENIED);

    // Birch saving its own shop never touches Acme's.
    expect((await setShop(birch.client, { address: "9 Birch Ln, Albany, NY", city: "Albany", lat: 42.65, lon: -73.75 })).error).toBeNull();
    expect((await acme.client.from("shop_locations").select("address").single()).data!.address).toBe(SHOP.address);
  });

  it("nobody writes it directly", async () => {
    const { error } = await acme.client.from("shop_locations").update({ address: "Sneaky" }).eq("business_id", acme.businessId);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it.each([
    ["state", { state: "New York" }],
    ["latitude", { lat: 123 }],
    ["ZIP code", { postal_code: "ABCDE" }],
    ["blank address", { address: "  " }],
  ] as const)("refuses a bad %s", async (_label, fields) => {
    expect((await setShop(acme.client, fields)).error?.code).toBe("23514");
  });
});

describe("customer locations", () => {
  let acme: TestOwner;
  let maria: TestCrew;
  let birch: TestOwner;
  const ADDRESS = "12 Oak St";

  beforeAll(async () => {
    acme = await signUpOwner("route-geo", "Acme Lawn Care");
    maria = await joinCrew(acme, "Maria");
    birch = await signUpOwner("route-geo-birch", "Birch Tree Services");
    await setShop(acme.client);
  });

  it("starts as pending, and stores what the owner's lookup found", async () => {
    const c = await addCustomer(acme, { property_address: ADDRESS });
    expect((await geoOf(acme, c.id)).geo_status).toBe("pending");
    expect((await locate(acme.client, c.id, ADDRESS)).data).toBe(true);
    expect(await geoOf(acme, c.id)).toEqual({
      geo_status: "located",
      geo_lat: 40.84,
      geo_lon: -73.1,
      geo_matched_address: "12 OAK ST, NY",
      geo_distance_miles: 1.2,
    });
  });

  it("keeps what a flagged lookup matched, but never a position to route by", async () => {
    const c = await addCustomer(acme, { property_address: "10 Downing St" });
    expect((await locate(acme.client, c.id, "10 Downing St", { status: "flagged", lat: null, lon: null, matched: "10 Downing St, London", miles: 3460 })).data).toBe(true);
    expect(await geoOf(acme, c.id)).toEqual({ geo_status: "flagged", geo_lat: null, geo_lon: null, geo_matched_address: "10 Downing St, London", geo_distance_miles: 3460 });
    // A flagged (or not found) result can't carry a position.
    expect((await locate(acme.client, c.id, "10 Downing St", { status: "flagged" })).error?.code).toBe(INVALID);
    expect((await locate(acme.client, c.id, "10 Downing St", { status: "located", lat: null, lon: null })).error?.code).toBe(INVALID);
  });

  it("goes back to pending when the property address changes, and ignores a lookup of the old address", async () => {
    const c = await addCustomer(acme, { property_address: ADDRESS });
    await locate(acme.client, c.id, ADDRESS);
    await acme.client.from("customers").update({ property_address: "99 Elm St" }).eq("id", c.id);
    expect(await geoOf(acme, c.id)).toMatchObject({ geo_status: "pending", geo_lat: null, geo_matched_address: null });

    // A lookup that started before the change arrives late: it's ignored.
    expect((await locate(acme.client, c.id, ADDRESS)).data).toBe(false);
    expect((await geoOf(acme, c.id)).geo_status).toBe("pending");

    // Other edits keep the location.
    await locate(acme.client, c.id, "99 Elm St");
    await acme.client.from("customers").update({ service_notes: "Gate code 1234" }).eq("id", c.id);
    expect((await geoOf(acme, c.id)).geo_status).toBe("located");
  });

  it("moving the shop sends every customer back to pending", async () => {
    const owner = await signUpOwner("route-geo-move", "Moving Lawns");
    await setShop(owner.client);
    const c = await addCustomer(owner, { property_address: ADDRESS });
    await locate(owner.client, c.id, ADDRESS);
    // Saving the same shop again changes nothing.
    await setShop(owner.client);
    expect((await geoOf(owner, c.id)).geo_status).toBe("located");
    await setShop(owner.client, { address: "1 Main St, Islip, NY", city: "Islip", lat: 40.73, lon: -73.21 });
    expect((await geoOf(owner, c.id)).geo_status).toBe("pending");
  });

  it("only the owner stores a location: not by editing the customer, not crew, not another business", async () => {
    const c = await addCustomer(acme, { property_address: ADDRESS });

    const direct = await acme.client.from("customers").update({ geo_status: "located", geo_lat: 1, geo_lon: 1 }).eq("id", c.id);
    expect(direct.error?.code).toBe(PERMISSION_DENIED);
    // Even on insert, a new customer starts as pending whatever it says.
    const { data: inserted, error } = await acme.client
      .from("customers")
      .insert({ business_id: acme.businessId, first_name: "Sneaky", property_address: ADDRESS, geo_status: "located", geo_lat: 1, geo_lon: 1 })
      .select("id");
    expect(error?.code ?? null).toBe(PERMISSION_DENIED);
    expect(inserted).toBeNull();

    expect((await locate(maria.client, c.id, ADDRESS)).error?.code).toBe(PERMISSION_DENIED);
    expect((await locate(anonClient(), c.id, ADDRESS)).error?.code).toBe(PERMISSION_DENIED);
    // Another business's owner: nothing happens.
    expect((await locate(birch.client, c.id, ADDRESS)).data).toBe(false);
    expect((await geoOf(acme, c.id)).geo_status).toBe("pending");
  });
});

describe("routes", () => {
  let acme: TestOwner;
  let maria: TestCrew;
  let sam: TestCrew;
  let ownerCrewId: string;
  let birch: TestOwner;
  let birchJob: string;
  const jobs: Record<string, string> = {};

  beforeAll(async () => {
    acme = await signUpOwner("route-acme", "Acme Lawn Care");
    maria = await joinCrew(acme, "Maria");
    sam = await joinCrew(acme, "Sam");
    ownerCrewId = (await acme.client.from("crew_members").select("id").eq("user_id", acme.userId).single()).data!.id;
    await setShop(acme.client);

    const add = async (name: string, address: string, crew: string | null) => {
      const c = await addCustomer(acme, { first_name: name, property_address: address, phone: "631-555-0100" });
      await locate(acme.client, c.id, address, { lat: 40.8 + Object.keys(jobs).length / 100 });
      jobs[name] = (await visitOn(acme, c.id, crew)).id;
    };
    await add("MariaOne", "1 Maple Ave", maria.crewMemberId);
    await add("MariaTwo", "2 Maple Ave", maria.crewMemberId);
    await add("SamOne", "3 Maple Ave", sam.crewMemberId);
    await add("Unassigned", "4 Maple Ave", null);
    // A cancelled visit on Maria's route, and one of hers on another day.
    const cancelled = await addCustomer(acme, { first_name: "MariaCancelled", property_address: "5 Maple Ave" });
    jobs.MariaCancelled = (await visitOn(acme, cancelled.id, maria.crewMemberId)).id;
    await acme.client.from("jobs").update({ status: "cancelled" }).eq("id", jobs.MariaCancelled);
    const later = await addCustomer(acme, { first_name: "MariaLater", property_address: "6 Maple Ave" });
    jobs.MariaLater = (await visitOn(acme, later.id, maria.crewMemberId, "2030-06-05")).id;

    birch = await signUpOwner("route-birch", "Birch Tree Services");
    const bc = await addCustomer(birch, { first_name: "BirchOnly", property_address: "7 Birch Ln" });
    birchJob = (await visitOn(birch, bc.id, null)).id;
  });

  it("a crew member's route has only their own visits that day, with where each one is", async () => {
    const { data, error } = await maria.client.rpc("crew_route", { route_date: DAY });
    expect(error).toBeNull();
    expect(data!.map((j) => j.customer_first_name)).toEqual(["MariaOne", "MariaTwo"]);
    expect(data![0]).toMatchObject({ geo_status: "located", geo_lat: 40.8, geo_lon: -73.1, property_address: "1 Maple Ave" });
    expect(JSON.stringify(data)).not.toContain("price");
    expect((await sam.client.rpc("crew_route", { route_date: DAY })).data!.map((j) => j.customer_first_name)).toEqual(["SamOne"]);
    // The owner's crew record has no visits that day; other businesses and visitors get nothing.
    expect((await acme.client.rpc("crew_route", { route_date: DAY })).data).toEqual([]);
    expect((await birch.client.rpc("crew_route", { route_date: DAY })).data).toEqual([]);
    expect((await anonClient().rpc("crew_route", { route_date: DAY })).error?.code).toBe(PERMISSION_DENIED);
  });

  it("the owner orders any route; the order is kept", async () => {
    for (const [crew, order] of [
      [maria.crewMemberId, [jobs.MariaTwo, jobs.MariaOne]],
      [null, [jobs.Unassigned]],
    ] as const) {
      expect((await acme.client.rpc("set_route_order", { route_date: DAY, crew_member_id: crew as string, job_ids: [...order] })).error).toBeNull();
    }
    const days = await routeDays(acme);
    expect(days.find((d) => d.crew_member_id === maria.crewMemberId)!.manual_order).toEqual([jobs.MariaTwo, jobs.MariaOne]);
    expect(days.find((d) => d.crew_member_id === null)!.manual_order).toEqual([jobs.Unassigned]);
    // Maria sees the owner's order for her route.
    expect((await maria.client.rpc("crew_route_settings", { route_date: DAY }).single()).data!.manual_order).toEqual([jobs.MariaTwo, jobs.MariaOne]);

    // Saving again replaces it; resetting goes back to the suggested order.
    await acme.client.rpc("set_route_order", { route_date: DAY, crew_member_id: maria.crewMemberId, job_ids: [jobs.MariaOne, jobs.MariaTwo] });
    expect((await routeDays(acme)).filter((d) => d.crew_member_id === maria.crewMemberId)).toHaveLength(1);
    expect((await acme.client.rpc("reset_route_order", { route_date: DAY, crew_member_id: maria.crewMemberId })).error).toBeNull();
    expect((await routeDays(acme)).find((d) => d.crew_member_id === maria.crewMemberId)!.manual_order).toBeNull();
  });

  it("a crew member can reorder and restart only their own route", async () => {
    expect((await maria.client.rpc("set_route_order", { route_date: DAY, crew_member_id: maria.crewMemberId, job_ids: [jobs.MariaTwo, jobs.MariaOne] })).error).toBeNull();
    const start = { route_date: DAY, address: "8 Home Rd", matched_address: "8 HOME RD, RONKONKOMA, NY", lat: 40.82, lon: -73.12 };
    expect((await maria.client.rpc("set_route_start", { ...start, crew_member_id: maria.crewMemberId })).error).toBeNull();
    expect((await maria.client.rpc("crew_route_settings", { route_date: DAY }).single()).data).toMatchObject({
      crew_member_id: maria.crewMemberId,
      start_address: "8 Home Rd",
      start_lat: 40.82,
      shop_address: SHOP.address,
      shop_city: "Lake Ronkonkoma",
      shop_state: "NY",
    });

    // Sam's route, the unassigned route and the owner's route are off limits to Maria.
    for (const crew of [sam.crewMemberId, null, ownerCrewId]) {
      const results = await Promise.all([
        maria.client.rpc("set_route_order", { route_date: DAY, crew_member_id: crew as string, job_ids: [jobs.SamOne] }),
        maria.client.rpc("reset_route_order", { route_date: DAY, crew_member_id: crew as string }),
        maria.client.rpc("set_route_start", { ...start, crew_member_id: crew as string }),
      ]);
      for (const { error } of results) expect(error?.code).toBe(PERMISSION_DENIED);
    }
    // And she can't slip someone else's visit into her own route.
    expect((await maria.client.rpc("set_route_order", { route_date: DAY, crew_member_id: maria.crewMemberId, job_ids: [jobs.MariaOne, jobs.SamOne] })).error?.code).toBe(INVALID);

    // A day start for Maria's route never changes Sam's route or the shop.
    expect((await sam.client.rpc("crew_route_settings", { route_date: DAY }).single()).data).toMatchObject({ start_address: null, manual_order: null });
    expect((await acme.client.from("shop_locations").select("address").single()).data!.address).toBe(SHOP.address);

    // Clearing the day start goes back to the shop.
    await maria.client.rpc("set_route_start", { route_date: DAY, crew_member_id: maria.crewMemberId, address: "", matched_address: "", lat: 0, lon: 0 });
    expect((await maria.client.rpc("crew_route_settings", { route_date: DAY }).single()).data).toMatchObject({ start_address: null, start_lat: null });
  });

  it("only visits on that route, that day, can be put in its order", async () => {
    const order = (job_ids: string[], crew: string | null = maria.crewMemberId) =>
      acme.client.rpc("set_route_order", { route_date: DAY, crew_member_id: crew as string, job_ids });
    for (const bad of [
      [jobs.MariaOne, jobs.SamOne], // someone else's visit
      [jobs.MariaOne, jobs.MariaCancelled], // cancelled
      [jobs.MariaOne, jobs.MariaLater], // another day
      [jobs.MariaOne, jobs.MariaOne], // twice
      [jobs.MariaOne, randomUUID()], // doesn't exist
      [jobs.MariaOne, birchJob], // another business's
      [],
    ]) {
      expect((await order(bad)).error?.code).toBe(INVALID);
    }
    expect((await order([jobs.Unassigned], maria.crewMemberId)).error?.code).toBe(INVALID);
  });

  it("crew members and visitors can't read anyone's route table", async () => {
    expect((await maria.client.from("route_days").select("*")).data).toEqual([]);
    expect((await anonClient().from("route_days").select("*")).error?.code).toBe(PERMISSION_DENIED);
    expect((await maria.client.from("route_days").insert({ business_id: acme.businessId, route_date: DAY })).error?.code).toBe(PERMISSION_DENIED);
    // Someone who isn't on a crew gets no settings row.
    expect((await birch.client.rpc("crew_route_settings", { route_date: DAY })).data).toEqual([
      expect.objectContaining({ crew_member_id: expect.any(String), shop_address: null, manual_order: null }),
    ]);
  });

  it("another business can't see, order or restart this business's routes", async () => {
    expect((await birch.client.from("route_days").select("*").eq("business_id", acme.businessId)).data).toEqual([]);
    const attempts = await Promise.all([
      birch.client.rpc("set_route_order", { route_date: DAY, crew_member_id: maria.crewMemberId, job_ids: [jobs.MariaOne] }),
      birch.client.rpc("reset_route_order", { route_date: DAY, crew_member_id: maria.crewMemberId }),
      birch.client.rpc("set_route_start", { route_date: DAY, crew_member_id: maria.crewMemberId, address: "x", matched_address: "x", lat: 1, lon: 1 }),
    ]);
    for (const { error } of attempts) expect(error?.code).toBe(NOT_FOUND);
    // Its own unassigned route can't take Acme's visits either.
    expect((await birch.client.rpc("set_route_order", { route_date: DAY, crew_member_id: null as unknown as string, job_ids: [jobs.Unassigned] })).error?.code).toBe(INVALID);
    // Birch's own route works, and stays Birch's.
    expect((await birch.client.rpc("set_route_order", { route_date: DAY, crew_member_id: null as unknown as string, job_ids: [birchJob] })).error).toBeNull();
    expect((await routeDays(acme)).some((d) => d.manual_order?.includes(birchJob))).toBe(false);
  });
});
