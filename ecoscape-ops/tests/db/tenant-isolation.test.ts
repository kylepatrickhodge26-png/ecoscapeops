// Multi-tenant isolation, tested through the real Supabase API as real signed-in
// users, so these exercise the same auth → PostgREST → row-level-security path the
// app uses.
import { beforeAll, describe, expect, it } from "vitest";

import { addCustomer, adminClient, anonClient, signUp, signUpOwner, type TestOwner } from "./helpers";

// Postgres "insufficient_privilege": raised for RLS WITH CHECK failures and for
// statements the role has no grant for.
const PERMISSION_DENIED = "42501";

describe("business signup", () => {
  it("creates the business and makes the new user its owner", async () => {
    const owner = await signUpOwner("signup", "Green Acres Landscaping");

    const { data: businesses } = await owner.client.from("businesses").select("id, name");
    expect(businesses).toEqual([{ id: owner.businessId, name: "Green Acres Landscaping" }]);
  });

  it("trims the business name", async () => {
    const owner = await signUpOwner("trim", "  Trimmed Lawns  ");
    const { data } = await owner.client.from("businesses").select("name").single();
    expect(data!.name).toBe("Trimmed Lawns");
  });

  it("lets a user without a business create one, exactly once", async () => {
    const user = await signUp("no-business");
    const { data: before } = await user.client.from("business_members").select("business_id");
    expect(before).toEqual([]);

    const { data: businessId, error } = await user.client.rpc("create_business", { business_name: "Late Start Co" });
    expect(error).toBeNull();

    const { data: membership } = await user.client.from("business_members").select("business_id, role").single();
    expect(membership).toEqual({ business_id: businessId, role: "owner" });

    const { error: second } = await user.client.rpc("create_business", { business_name: "Second Business" });
    expect(second?.code).toBe("23505");
  });

  it("does not let signed-out visitors create businesses", async () => {
    const { error } = await anonClient().rpc("create_business", { business_name: "Anon Co" });
    expect(error).not.toBeNull();
  });
});

describe("tenant isolation between two businesses", () => {
  let acme: TestOwner;
  let birch: TestOwner;
  let acmeCustomerId: string;

  beforeAll(async () => {
    acme = await signUpOwner("acme", "Acme Lawn Care");
    birch = await signUpOwner("birch", "Birch Tree Services");
    const customer = await addCustomer(acme, {
      first_name: "John",
      last_name: "Smith",
      phone: "(631) 555-0142",
      property_address: "123 Example Street, Lake Ronkonkoma, NY",
    });
    acmeCustomerId = customer.id;
    await addCustomer(birch, { first_name: "Dana", last_name: "Reyes" });
  });

  const acmeCustomerAsAcme = async () =>
    (await acme.client.from("customers").select("*").eq("id", acmeCustomerId).single()).data;

  it("each owner sees only their own business and memberships", async () => {
    const { data: businesses } = await birch.client.from("businesses").select("id");
    expect(businesses).toEqual([{ id: birch.businessId }]);

    const { data: members } = await birch.client.from("business_members").select("user_id");
    expect(members).toEqual([{ user_id: birch.userId }]);
  });

  it("an owner's customer list contains only their own customers", async () => {
    const { data } = await birch.client.from("customers").select("business_id, first_name");
    expect(data).toEqual([{ business_id: birch.businessId, first_name: "Dana" }]);
  });

  it("another business cannot read a customer, even by id", async () => {
    const { data, error } = await birch.client.from("customers").select("*").eq("id", acmeCustomerId);
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: byBusiness } = await birch.client.from("customers").select("id").eq("business_id", acme.businessId);
    expect(byBusiness).toEqual([]);
  });

  it("another business cannot update a customer", async () => {
    const { data } = await birch.client
      .from("customers")
      .update({ first_name: "Hacked" })
      .eq("id", acmeCustomerId)
      .select();
    expect(data).toEqual([]);
    expect((await acmeCustomerAsAcme())!.first_name).toBe("John");
  });

  it("another business cannot delete a customer", async () => {
    const { data } = await birch.client.from("customers").delete().eq("id", acmeCustomerId).select();
    expect(data).toEqual([]);
    expect(await acmeCustomerAsAcme()).not.toBeNull();
  });

  it("an owner cannot add a customer to another business", async () => {
    const { error } = await birch.client
      .from("customers")
      .insert({ business_id: acme.businessId, first_name: "Planted" });
    expect(error?.code).toBe(PERMISSION_DENIED);

    const { data } = await acme.client.from("customers").select("first_name");
    expect(data!.map((c) => c.first_name)).not.toContain("Planted");
  });

  it("a customer cannot be moved to another business", async () => {
    const { error } = await acme.client
      .from("customers")
      .update({ business_id: birch.businessId })
      .eq("id", acmeCustomerId);
    expect(error?.code).toBe(PERMISSION_DENIED);
    expect((await acmeCustomerAsAcme())!.business_id).toBe(acme.businessId);
  });

  it("an owner cannot rename another business", async () => {
    const { data } = await birch.client
      .from("businesses")
      .update({ name: "Taken Over" })
      .eq("id", acme.businessId)
      .select();
    expect(data).toEqual([]);
    const { data: acmeBusiness } = await acme.client.from("businesses").select("name").single();
    expect(acmeBusiness!.name).toBe("Acme Lawn Care");
  });

  it("an owner can rename their own business", async () => {
    const { data } = await birch.client
      .from("businesses")
      .update({ name: "Birch Tree & Lawn" })
      .eq("id", birch.businessId)
      .select("name");
    expect(data).toEqual([{ name: "Birch Tree & Lawn" }]);
  });

  it("nobody can add themselves to another business or change their role", async () => {
    const { error: join } = await birch.client
      .from("business_members")
      .insert({ business_id: acme.businessId, user_id: birch.userId, role: "owner" });
    expect(join?.code).toBe(PERMISSION_DENIED);

    const { error: promote } = await birch.client
      .from("business_members")
      .update({ business_id: acme.businessId })
      .eq("user_id", birch.userId);
    expect(promote?.code).toBe(PERMISSION_DENIED);

    const { error: leave } = await birch.client.from("business_members").delete().eq("user_id", birch.userId);
    expect(leave?.code).toBe(PERMISSION_DENIED);
  });

  it("signed-out visitors can't read or write any tenant data", async () => {
    const anon = anonClient();
    for (const table of ["customers", "businesses", "business_members"] as const) {
      const { data, error } = await anon.from(table).select("*");
      expect(error?.code, table).toBe(PERMISSION_DENIED);
      expect(data).toBeNull();
    }
    const { error } = await anon.from("customers").insert({ business_id: acme.businessId, first_name: "Anon" });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("a crew member gets no access to customers yet", async () => {
    // There's no crew invite flow yet, so create the membership directly.
    const crew = await signUp("crew");
    const { error: setupError } = await adminClient()
      .from("business_members")
      .insert({ business_id: acme.businessId, user_id: crew.userId, role: "crew" });
    expect(setupError).toBeNull();

    const { data: businesses } = await crew.client.from("businesses").select("name");
    expect(businesses).toEqual([{ name: "Acme Lawn Care" }]);

    const { data: customers } = await crew.client.from("customers").select("id");
    expect(customers).toEqual([]);

    const { error: insertError } = await crew.client
      .from("customers")
      .insert({ business_id: acme.businessId, first_name: "Crew Added" });
    expect(insertError?.code).toBe(PERMISSION_DENIED);

    const { data: updated } = await crew.client
      .from("customers")
      .update({ first_name: "Crew Edit" })
      .eq("id", acmeCustomerId)
      .select();
    expect(updated).toEqual([]);

    const { data: renamed } = await crew.client
      .from("businesses")
      .update({ name: "Crew Rename" })
      .eq("id", acme.businessId)
      .select();
    expect(renamed).toEqual([]);
  });
});

describe("customers", () => {
  let owner: TestOwner;

  beforeAll(async () => {
    owner = await signUpOwner("crud", "Crud Landscaping");
  });

  it("supports add, edit, list, and delete for the owner", async () => {
    const created = await addCustomer(owner, {
      first_name: "Mike",
      last_name: "Jones",
      phone: "(631) 555-0198",
      email: "mjones@example.com",
      property_address: "48 Harbor Rd, Lake Grove, NY",
      billing_address: "PO Box 9",
      access_instructions: "Side gate",
      service_notes: "Prefers mornings",
      preferred_day: "wednesday",
      notification_preference: "email",
      sms_opt_in: true,
      customer_since: "2026-05-12",
    });
    expect(created).toMatchObject({
      business_id: owner.businessId,
      phone_digits: "6315550198",
      status: "active",
      customer_since: "2026-05-12",
    });

    const { data: updated, error: updateError } = await owner.client
      .from("customers")
      .update({ status: "inactive", preferred_day: "friday" })
      .eq("id", created.id)
      .select()
      .single();
    expect(updateError).toBeNull();
    expect(updated).toMatchObject({ status: "inactive", preferred_day: "friday" });
    expect(new Date(updated!.updated_at).getTime()).toBeGreaterThan(new Date(created.updated_at).getTime());

    const { data: list } = await owner.client.from("customers").select("id");
    expect(list).toEqual([{ id: created.id }]);

    const { data: deleted } = await owner.client.from("customers").delete().eq("id", created.id).select("id");
    expect(deleted).toEqual([{ id: created.id }]);
    const { data: after } = await owner.client.from("customers").select("id");
    expect(after).toEqual([]);
  });

  it("uses the prototype's defaults", async () => {
    const created = await addCustomer(owner, { first_name: "Defaults" });
    expect(created).toMatchObject({
      preferred_day: "monday",
      status: "active",
      notification_preference: "text",
      sms_opt_in: false,
      last_name: "Customer",
      email: "",
    });
  });

  it.each([
    ["no name, phone, or email", { first_name: "", last_name: "" }],
    ["Sunday as the preferred day", { preferred_day: "sunday" }],
    ["an unknown status", { status: "archived" }],
    ["an unknown notification preference", { notification_preference: "fax" }],
    ["a malformed email", { email: "nope" }],
    ["an over-long name", { first_name: "x".repeat(101) }],
  ])("rejects a customer with %s", async (_label, fields) => {
    const { error } = await owner.client
      .from("customers")
      .insert({ business_id: owner.businessId, first_name: "Base", last_name: "Base", ...fields });
    expect(error?.code).toBe("23514"); // check_violation
  });
});
