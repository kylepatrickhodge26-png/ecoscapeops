import { expect, test, type Browser, type Page } from "@playwright/test";

import { addDays, formatShortDate, todayInTimeZone } from "../../src/lib/dates";
import { PASSWORD, addCustomer, signUpBusiness, uniqueEmail } from "./helpers";

const TIME_ZONE = "America/New_York";
test.use({ timezoneId: TIME_ZONE });
const today = () => todayInTimeZone(TIME_ZONE);

// Owner adds a crew member on the Crew page and copies the invite link.
async function addCrewMember(page: Page, name: string) {
  await page.goto("/crew");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add and get invite link" }).click();
  const link = page.getByLabel(`Invite link for ${name}`);
  await expect(link).toBeVisible();
  return link.inputValue();
}

// A crew member opens the link on their own device and creates their login.
async function joinCrew(browser: Browser, inviteUrl: string) {
  const context = await browser.newContext({ timezoneId: TIME_ZONE });
  const page = await context.newPage();
  await page.goto(inviteUrl);
  await page.getByLabel("Email").fill(uniqueEmail("crew"));
  await page.getByLabel("Choose a password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create login and join" }).click();
  await expect(page).toHaveURL(/\/my-jobs$/);
  return page;
}

async function bookFor(page: Page, customerId: string, assignee: string, fields: { service?: string; frequency?: "Every week" | "One time"; startDate?: string } = {}) {
  await page.goto(`/schedule/new?customer=${customerId}`);
  await page.getByLabel("Service").fill(fields.service ?? "Mowing");
  await page.getByLabel("Price ($)").fill("65");
  await page.getByLabel("How often").selectOption(fields.frequency ?? "Every week");
  await page.getByLabel(/First visit|Visit date/).fill(fields.startDate ?? today());
  await page.getByLabel("Assign to").selectOption({ label: assignee });
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page.getByText(/booked for/)).toBeVisible();
}

const jobCards = (page: Page) => page.locator("article.jobitem");

async function openVisit(page: Page, row: ReturnType<Page["locator"]>) {
  await row.locator(".row-link").click();
  await expect(page).toHaveURL(/\/schedule\/jobs\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname;
}

test("'Assign to' stays hidden for a solo owner and appears once they add a crew member", async ({ page }) => {
  await signUpBusiness(page, "Solo Lawns", undefined, "Kyle");
  const customerId = await addCustomer(page, { firstName: "John", lastName: "Smith" });

  await page.goto(`/schedule/new?customer=${customerId}`);
  await expect(page.getByLabel("Service")).toBeVisible();
  await expect(page.getByLabel("Assign to")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "My jobs" })).toHaveCount(0);

  await page.goto("/crew");
  const owner = page.locator('[data-crew-member="Kyle"]');
  await expect(owner).toContainText("You · Owner");
  await expect(owner.getByRole("button", { name: "Remove" })).toHaveCount(0);

  await addCrewMember(page, "Maria");
  await expect(page.locator('[data-crew-member="Maria"]')).toContainText("Invite pending");

  await page.goto(`/schedule/new?customer=${customerId}`);
  const assign = page.getByLabel("Assign to");
  await expect(assign.locator("option")).toHaveText(["Unassigned", "Kyle (you)", "Maria"]);
  await expect(page.getByRole("link", { name: "My jobs" })).toBeVisible();
});

test("a crew member joins with the invite link and sees only their own jobs, without prices", async ({ page, browser }) => {
  await signUpBusiness(page, "Two Crew Lawns");
  const customerId = await addCustomer(page, { firstName: "John", lastName: "Smith", propertyAddress: "123 Example St" });
  const mariaLink = await addCrewMember(page, "Maria");
  const luisLink = await addCrewMember(page, "Luis");

  await bookFor(page, customerId, "Maria", { service: "Mowing" });
  await bookFor(page, customerId, "Luis", { service: "Hedge trimming", frequency: "One time" });
  await bookFor(page, customerId, "Unassigned", { service: "Leaf cleanup", frequency: "One time" });

  const maria = await joinCrew(browser, mariaLink);
  await expect(maria.getByTestId("business-name")).toHaveText("Two Crew Lawns");
  await expect(maria.getByRole("link", { name: "My jobs" })).toBeVisible();
  await expect(maria.getByRole("link", { name: "Customers" })).toHaveCount(0);
  await expect(maria.getByRole("heading", { name: "Today" })).toBeVisible();
  const todayCards = maria.locator("section", { has: maria.getByRole("heading", { name: "Today" }) }).locator("article.jobitem");
  await expect(todayCards).toHaveCount(1);
  await expect(todayCards.first()).toContainText("Mowing");
  await expect(todayCards.first()).toContainText("123 Example St");
  await expect(maria.getByText("Hedge trimming")).toHaveCount(0);
  await expect(maria.getByText("Leaf cleanup")).toHaveCount(0);
  await expect(maria.locator("main")).not.toContainText("$");

  const luis = await joinCrew(browser, luisLink);
  await expect(jobCards(luis)).toHaveCount(1);
  await expect(jobCards(luis).first()).toContainText("Hedge trimming");
  await expect(luis.getByText("Mowing")).toHaveCount(0);

  // The owner sees who's doing what.
  await page.goto("/crew");
  await expect(page.locator('[data-crew-member="Maria"]')).not.toContainText("Invite pending");
  await page.goto("/schedule?view=list&filter=today");
  await expect(page.getByRole("row", { name: /Hedge trimming/ })).toContainText("Luis");
  await expect(page.getByRole("row", { name: /Leaf cleanup/ })).toContainText("Unassigned");
});

test("crew members can't reach the owner's pages or another crew member's jobs", async ({ page, browser }) => {
  await signUpBusiness(page, "Locked Down Lawns");
  const customerId = await addCustomer(page, { firstName: "John", lastName: "Smith" });
  const mariaLink = await addCrewMember(page, "Maria");
  await addCrewMember(page, "Luis");
  await bookFor(page, customerId, "Luis", { service: "Hedge trimming", frequency: "One time" });

  await page.goto("/schedule?view=list&filter=today");
  const luisJobPath = await openVisit(page, page.getByRole("row", { name: /Hedge trimming/ }));
  const customerPath = `/customers/${customerId}`;

  const maria = await joinCrew(browser, mariaLink);
  for (const path of ["/customers", customerPath, "/schedule", "/schedule/new", luisJobPath, `${luisJobPath}/edit`, "/crew"]) {
    await maria.goto(path);
    await expect(maria, path).toHaveURL(/\/my-jobs$/);
  }
  await expect(maria.getByText("Hedge trimming")).toHaveCount(0);
  await expect(maria.getByText("No jobs today")).toBeVisible();
});

test("a crew member can start, note, complete, and reschedule their jobs", async ({ page, browser }) => {
  await signUpBusiness(page, "Busy Crew Lawns");
  const customerId = await addCustomer(page, { firstName: "John", lastName: "Smith" });
  const mariaLink = await addCrewMember(page, "Maria");
  await bookFor(page, customerId, "Maria");

  const maria = await joinCrew(browser, mariaLink);
  const card = jobCards(maria).first();

  await card.getByRole("button", { name: "Start job" }).click();
  await expect(maria.getByText("Job started.")).toBeVisible();
  await expect(jobCards(maria).first().locator(".status-pill")).toHaveText("In progress");

  await jobCards(maria).first().getByRole("button", { name: "Add note" }).click();
  await maria.getByLabel("Note", { exact: true }).fill("Dog in yard");
  await maria.getByRole("button", { name: "Save note" }).click();
  await expect(maria.getByText("Note added.")).toBeVisible();
  await expect(jobCards(maria).first()).toContainText("Maria: Dog in yard");

  await jobCards(maria).first().getByRole("button", { name: "Mark completed" }).click();
  await expect(maria.getByText("Job marked completed.")).toBeVisible();
  await expect(jobCards(maria).first().locator(".status-pill")).toHaveText("Completed");
  await expect(jobCards(maria).first().getByRole("button", { name: "Could not service" })).toHaveCount(0);

  // Next week's visit: couldn't do it, move it a day.
  const upcoming = maria.locator("section", { has: maria.getByRole("heading", { name: "Coming up" }) }).locator("article.jobitem");
  const nextWeek = addDays(today(), 7);
  await upcoming.first().getByRole("button", { name: "Could not service" }).click();
  await maria.getByLabel("What happened? (optional)").fill("Gate locked");
  await maria.getByLabel("New date").fill(addDays(nextWeek, 1));
  await maria.getByRole("button", { name: "Reschedule" }).click();
  await expect(maria.getByText("Job rescheduled.")).toBeVisible();

  // The owner sees what the crew member did.
  await page.goto("/schedule?view=list&filter=completed");
  await openVisit(page, page.locator(".job-table tbody tr").first());
  await expect(page.getByText("Maria: Dog in yard")).toBeVisible();
  await page.goto(`/schedule/day/${addDays(nextWeek, 1)}`);
  await openVisit(page, page.locator(".job-table tbody tr").first());
  await expect(
    page.getByText(`Maria: Couldn't service on ${formatShortDate(nextWeek)} (Gate locked) — rescheduled to ${formatShortDate(addDays(nextWeek, 1))}.`),
  ).toBeVisible();
});

test("reassigning a visit moves it from one crew member's list to the other's", async ({ page, browser }) => {
  await signUpBusiness(page, "Swap Lawns");
  const customerId = await addCustomer(page, { firstName: "John", lastName: "Smith" });
  const mariaLink = await addCrewMember(page, "Maria");
  const luisLink = await addCrewMember(page, "Luis");
  await bookFor(page, customerId, "Maria", { frequency: "One time" });
  const maria = await joinCrew(browser, mariaLink);
  const luis = await joinCrew(browser, luisLink);
  await expect(jobCards(maria)).toHaveCount(1);
  await expect(jobCards(luis)).toHaveCount(0);

  await page.goto("/schedule?view=list&filter=today");
  await openVisit(page, page.locator(".job-table tbody tr").first());
  await expect(page.locator("dl.details")).toContainText("Maria");
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByLabel("Assign to")).toHaveValue(/[0-9a-f-]{36}/);
  await page.getByLabel("Assign to").selectOption({ label: "Luis" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("dl.details")).toContainText("Luis");

  await maria.reload();
  await luis.reload();
  await expect(jobCards(maria)).toHaveCount(0);
  await expect(jobCards(luis)).toHaveCount(1);
});

test("an invite link works once, and a new link replaces the old one", async ({ page, browser }) => {
  await signUpBusiness(page, "Link Lawns");
  const anaLink = await addCrewMember(page, "Ana");
  const ana = await joinCrew(browser, anaLink);
  await ana.goto(anaLink);
  await expect(ana.getByText("This invite link isn't valid")).toBeVisible();

  const oldLink = await addCrewMember(page, "Sam");
  await page.goto("/crew");
  await page.locator('[data-crew-member="Sam"]').getByRole("button", { name: "New invite link" }).click();
  const newLink = await page.getByLabel("Invite link for Sam").inputValue();
  expect(newLink).not.toBe(oldLink);

  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(oldLink);
  await expect(stranger.getByText("This invite link isn't valid")).toBeVisible();
  await stranger.goto(newLink);
  await expect(stranger.getByRole("heading", { name: "Join Link Lawns" })).toBeVisible();
  await stranger.goto(`${new URL(newLink).origin}/join/${"a".repeat(64)}`);
  await expect(stranger.getByText("This invite link isn't valid")).toBeVisible();
});

test("removing a crew member ends their access and unassigns their jobs", async ({ page, browser }) => {
  await signUpBusiness(page, "Parting Lawns");
  const customerId = await addCustomer(page, { firstName: "John", lastName: "Smith" });
  const mariaLink = await addCrewMember(page, "Maria");
  await bookFor(page, customerId, "Maria", { startDate: addDays(today(), 1) });
  const maria = await joinCrew(browser, mariaLink);
  // My jobs looks 14 days ahead: tomorrow's visit and the one a week later.
  await expect(jobCards(maria)).toHaveCount(2);

  await page.goto("/crew");
  await page.locator('[data-crew-member="Maria"]').getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(/Their login loses access right away\. Their 6 upcoming jobs become unassigned\./)).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).last().click();
  await expect(page.getByText("Crew member removed.")).toBeVisible();
  await expect(page.locator('[data-crew-member="Maria"]')).toHaveCount(0);

  await maria.goto("/my-jobs");
  await expect(maria).toHaveURL(/\/onboarding$/);
  await maria.goto("/customers");
  await expect(maria).toHaveURL(/\/onboarding$/);

  // Back to a solo owner: no crew column, and the jobs are simply unassigned.
  await page.goto("/schedule?view=list&filter=upcoming");
  await expect(page.locator(".job-table thead")).not.toContainText("Crew");
  await expect(page.locator(".job-table tbody tr")).toHaveCount(6);
});

test("the owner can rename a crew member", async ({ page, browser }) => {
  await signUpBusiness(page, "Rename Lawns");
  const link = await addCrewMember(page, "Mariah");
  const maria = await joinCrew(browser, link);

  await page.goto("/crew");
  await page.locator('[data-crew-member="Mariah"]').getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("New name").fill("Maria G.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Name updated.")).toBeVisible();
  await expect(page.locator('[data-crew-member="Maria G."]')).toBeVisible();

  await maria.reload();
  await expect(maria.locator(".pagehead .meta")).toContainText("Maria G.");
});

test("a crew member of another business sees none of this one", async ({ page, browser }) => {
  await signUpBusiness(page, "Acme Lawn Care");
  const acmeCustomer = await addCustomer(page, { firstName: "Secret", lastName: "Client" });
  await addCrewMember(page, "Maria");
  await bookFor(page, acmeCustomer, "Kyle (you)", { frequency: "One time" });
  await page.goto("/schedule?view=list&filter=today");
  const acmeJobPath = await openVisit(page, page.locator(".job-table tbody tr").first());

  const birchOwner = await (await browser.newContext({ timezoneId: TIME_ZONE })).newPage();
  await signUpBusiness(birchOwner, "Birch Tree Services");
  const zoeLink = await addCrewMember(birchOwner, "Zoe");
  const zoe = await joinCrew(browser, zoeLink);

  await expect(zoe.getByTestId("business-name")).toHaveText("Birch Tree Services");
  await expect(zoe.getByText("Secret Client")).toHaveCount(0);
  await zoe.goto(acmeJobPath);
  await expect(zoe).toHaveURL(/\/my-jobs$/);
  await expect(zoe.getByText("Secret Client")).toHaveCount(0);
});

test("the owner, who is on the crew too, sees jobs assigned to them under My jobs", async ({ page }) => {
  await signUpBusiness(page, "Hands On Lawns", undefined, "Kyle");
  const customerId = await addCustomer(page, { firstName: "John", lastName: "Smith" });
  await addCrewMember(page, "Maria");
  await bookFor(page, customerId, "Kyle (you)", { frequency: "One time" });
  await bookFor(page, customerId, "Maria", { frequency: "One time", service: "Edging" });

  await page.getByRole("link", { name: "My jobs" }).click();
  await expect(page.locator(".pagehead .meta")).toContainText("Kyle");
  await expect(jobCards(page)).toHaveCount(1);
  await expect(jobCards(page).first()).toContainText("Mowing");
});
