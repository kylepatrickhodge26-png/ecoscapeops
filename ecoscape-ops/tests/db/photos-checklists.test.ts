// Job checklists and photos. Checks that checklist templates are copied onto visits, that only
// the owner and the crew member a job is assigned to can tick items or add and see photos,
// and that another crew member, another business or a signed-out visitor can never read or
// upload to a business's private photo files.
import { beforeAll, describe, expect, it } from "vitest";

import { addCustomer, anonClient, bookService, joinCrew, signUpOwner, visitsFor, type TestCrew, type TestOwner } from "./helpers";

const BUCKET = "job-photos";
const NOT_FOUND = "P0002";
const DENIED = "42501";
const INVALID = "22023";
// A tiny valid-looking JPEG header is enough: the bucket checks the declared type and size.
const FILE = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])], { type: "image/jpeg" });

describe("checklists and photos", () => {
  let alpha: TestOwner;
  let bravo: TestOwner;
  let maria: TestCrew;
  let sam: TestCrew;
  let jobId: string;
  let otherBusinessJob: string;
  let customerId: string;

  beforeAll(async () => {
    alpha = await signUpOwner("photos-alpha", "Alpha Lawn");
    bravo = await signUpOwner("photos-bravo", "Bravo Lawn");
    maria = await joinCrew(alpha, "Maria");
    sam = await joinCrew(alpha, "Sam");
    customerId = (await addCustomer(alpha)).id;
    const template = await alpha.client.rpc("save_checklist_template", {
      service_name: "Mowing",
      items: ["Mow", "Edge", "Blow", "Bag clippings"],
    });
    expect(template.error).toBeNull();
    const plan = await bookService(alpha, customerId, { frequency: "one_time", start_date: "2030-03-05", assigned_crew_member_id: maria.crewMemberId });
    jobId = (await visitsFor(alpha, plan.id))[0].id;
    const theirs = await bookService(bravo, (await addCustomer(bravo)).id, { frequency: "one_time", start_date: "2030-03-05" });
    otherBusinessJob = (await visitsFor(bravo, theirs.id))[0].id;
  });

  it("copies the template onto new visits, in order", async () => {
    const { data } = await alpha.client.rpc("job_checklist", { job_id: jobId });
    expect(data!.map((i) => i.label)).toEqual(["Mow", "Edge", "Blow", "Bag clippings"]);
    const { data: theirs } = await bravo.client.rpc("job_checklist", { job_id: otherBusinessJob });
    expect(theirs).toEqual([]);
  });

  it("checks template rules and keeps them owner-only", async () => {
    expect((await maria.client.rpc("save_checklist_template", { service_name: "Mowing", items: ["x"] })).error?.code).toBe(DENIED);
    expect((await alpha.client.rpc("save_checklist_template", { service_name: "Mowing", items: Array(31).fill("i") })).error?.code).toBe(INVALID);
    expect((await alpha.client.rpc("save_checklist_template", { service_name: "Mowing", items: [" "] })).error?.code).toBe(INVALID);
    const { data: seen } = await bravo.client.from("checklist_templates").select("id");
    expect(seen).toEqual([]);
    const { data: crewSeen } = await maria.client.from("checklist_templates").select("id");
    expect(crewSeen).toEqual([]);
  });

  it("lets only the owner and the assigned crew member see and tick items", async () => {
    const { data: items } = await maria.client.rpc("job_checklist", { job_id: jobId });
    expect(items).toHaveLength(4);
    expect((await sam.client.rpc("job_checklist", { job_id: jobId })).data).toEqual([]);
    expect((await bravo.client.rpc("job_checklist", { job_id: jobId })).data).toEqual([]);
    expect((await anonClient().rpc("job_checklist", { job_id: jobId })).error).not.toBeNull();

    const itemId = items![0].id;
    expect((await sam.client.rpc("set_checklist_item", { item_id: itemId, done: true })).error?.code).toBe(NOT_FOUND);
    expect((await bravo.client.rpc("set_checklist_item", { item_id: itemId, done: true })).error?.code).toBe(NOT_FOUND);
    expect((await maria.client.rpc("set_checklist_item", { item_id: itemId, done: true })).error).toBeNull();
    const after = (await maria.client.rpc("job_checklist", { job_id: jobId })).data!.find((i) => i.id === itemId)!;
    expect(after).toMatchObject({ done: true, done_by_name: "Maria" });
    expect(after.done_at).not.toBeNull();
    expect((await maria.client.from("job_checklist_items").update({ done: false }).eq("id", itemId)).error).not.toBeNull();
  });

  it("keeps photo files private to the job's owner and assigned crew", async () => {
    const path = `${alpha.businessId}/${jobId}/before.jpg`;
    const up = await maria.client.storage.from(BUCKET).upload(path, FILE, { contentType: "image/jpeg" });
    expect(up.error).toBeNull();

    for (const who of [sam, bravo]) {
      const denied = await who.client.storage.from(BUCKET).upload(`${alpha.businessId}/${jobId}/x.jpg`, FILE, { contentType: "image/jpeg" });
      expect(denied.error).not.toBeNull();
    }
    expect((await anonClient().storage.from(BUCKET).upload(`${alpha.businessId}/${jobId}/x.jpg`, FILE, { contentType: "image/jpeg" })).error).not.toBeNull();
    // A path outside business/job/file never works, even for the owner.
    expect((await alpha.client.storage.from(BUCKET).upload(`${alpha.businessId}/loose.jpg`, FILE, { contentType: "image/jpeg" })).error).not.toBeNull();

    expect((await maria.client.storage.from(BUCKET).download(path)).error).toBeNull();
    expect((await alpha.client.storage.from(BUCKET).download(path)).error).toBeNull();
    for (const who of [sam, bravo, { client: anonClient() }]) {
      expect((await who.client.storage.from(BUCKET).download(path)).error).not.toBeNull();
    }
    // Crew and other businesses can't delete the file.
    await sam.client.storage.from(BUCKET).remove([path]);
    await bravo.client.storage.from(BUCKET).remove([path]);
    expect((await alpha.client.storage.from(BUCKET).download(path)).error).toBeNull();
  });

  it("records photos and limits who sees and removes them", async () => {
    const path = `${alpha.businessId}/${jobId}/before.jpg`;
    const added = await maria.client.rpc("add_job_photo", { job_id: jobId, storage_path: path, kind: "before", caption: "Front lawn" });
    expect(added.error).toBeNull();
    expect((await maria.client.rpc("add_job_photo", { job_id: jobId, storage_path: path, kind: "after", caption: "" })).error).not.toBeNull();
    expect((await sam.client.rpc("add_job_photo", { job_id: jobId, storage_path: path, kind: "after", caption: "" })).error).not.toBeNull();
    expect((await bravo.client.rpc("add_job_photo", { job_id: jobId, storage_path: path, kind: "after", caption: "" })).error).not.toBeNull();
    expect((await maria.client.rpc("add_job_photo", { job_id: jobId, storage_path: `${alpha.businessId}/${jobId}/none.jpg`, kind: "after", caption: "" })).error).not.toBeNull();

    expect((await maria.client.rpc("job_photos_for", { job_id: jobId })).data).toHaveLength(1);
    expect((await sam.client.rpc("job_photos_for", { job_id: jobId })).data).toEqual([]);
    expect((await bravo.client.rpc("job_photos_for", { job_id: jobId })).data).toEqual([]);
    expect((await maria.client.from("job_photos").select("id")).data).toEqual([]);
    expect((await bravo.client.from("job_photos").select("id")).data).toEqual([]);

    expect((await maria.client.rpc("delete_job_photo", { photo_id: added.data! })).error?.code).toBe(DENIED);
    expect((await bravo.client.rpc("delete_job_photo", { photo_id: added.data! })).error?.code).toBe(NOT_FOUND);
    expect((await maria.client.rpc("photo_usage")).error?.code).toBe(DENIED);
    const usage = await alpha.client.rpc("photo_usage");
    expect(usage.data![0].photo_count).toBe(1);
    const removed = await alpha.client.rpc("delete_job_photo", { photo_id: added.data! });
    expect(removed.data).toBe(path);
  });
});
