import { expect, test, type Browser, type Page } from "@playwright/test";

import { addDays, todayInTimeZone } from "../../src/lib/dates";
import { PASSWORD, signUpBusiness, uniqueEmail } from "./helpers";

// The Today screen: start the day, clock in to the next visit, clock out & finish, end the day,
// each a single tap, for crew members and the owner alike.
const TIME_ZONE = "America/New_York";
test.use({ timezoneId: TIME_ZONE });
const today = () => todayInTimeZone(TIME_ZONE);

async function addCustomer(page: Page, name: string) {
  await page.goto("/customers/new");
  const [first, last] = name.split(" ");
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill(last);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText("Customer added.")).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2];
}

async function book(page: Page, customerId: string, service: string, assignee?: string) {
  await page.goto(`/schedule/new?customer=${customerId}`);
  await page.getByLabel("Service").fill(service);
  await page.getByLabel("Price ($)").fill("65");
  await page.getByLabel("How often").selectOption("One time");
  await page.getByLabel(/First visit|Visit date/).fill(today());
  if (assignee) await page.getByLabel("Assign to").selectOption({ label: assignee });
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page.getByText(/booked for/)).toBeVisible();
}

async function addCrewMember(page: Page, name: string) {
  await page.goto("/crew");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add and get invite link" }).click();
  return page.getByLabel(`Invite link for ${name}`).inputValue();
}

async function joinCrew(browser: Browser, inviteUrl: string) {
  const page = await (await browser.newContext({ timezoneId: TIME_ZONE, ...(test.info().project.use ?? {}) })).newPage();
  await page.goto(inviteUrl);
  await page.getByLabel("Email").fill(uniqueEmail("crew"));
  await page.getByLabel("Choose a password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create login and join" }).click();
  await expect(page).toHaveURL(/\/my-jobs$/);
  return page;
}

const nowCard = (page: Page) => page.locator(".now-card");
const workday = (page: Page) => page.getByTestId("workday");

test("a crew member runs their day from Today, one tap at a time", async ({ page, browser }) => {
  await signUpBusiness(page, "Clock Lawns");
  const maria = await joinCrew(browser, await addCrewMember(page, "Maria"));
  const jane = await addCustomer(page, "Jane Adams");
  const bob = await addCustomer(page, "Bob Lee");
  await book(page, jane, "Mowing", "Maria");
  await book(page, bob, "Edging", "Maria");

  // Today opens on the next job, with one big button.
  await maria.goto("/");
  await expect(maria).toHaveURL(/\/dashboard$/);
  await expect(maria.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await expect(workday(maria).getByRole("button", { name: "Start my day" })).toBeVisible();
  await expect(nowCard(maria).locator(".now-label")).toHaveText("Next up · Stop 1 of 2");
  await expect(nowCard(maria).locator(".now-customer")).toHaveText("Jane Adams");

  // One tap: on the clock for the day, clocked in, and the job is started.
  await nowCard(maria).getByRole("button", { name: "Clock in" }).click();
  await expect(nowCard(maria).locator(".now-label")).toHaveText("Now · Stop 1 of 2");
  await expect(workday(maria)).toContainText("On the clock since");
  await expect(nowCard(maria)).toContainText("Clocked in at");
  await expect(nowCard(maria).getByTestId("live-timer")).toHaveText(/^\d+m$/);
  // The other stop can't be clocked into until she clocks out here.
  await expect(maria.locator(".today-list").getByRole("button", { name: "Clock in" })).toHaveCount(0);

  // The owner sees who's working, and where.
  await page.goto("/dashboard");
  const crewNow = page.getByTestId("crew-now");
  await expect(crewNow).toContainText("1 of 2 on the clock");
  await expect(crewNow.locator('li[data-crew="Maria"]')).toContainText("On since");
  await expect(crewNow.locator('li[data-crew="Maria"]')).toContainText("At Jane Adams · Mowing");

  // Clock out & finish: done, and the next job comes up.
  await nowCard(maria).getByRole("button", { name: "Clock out & finish" }).click();
  await expect(nowCard(maria).locator(".now-label")).toHaveText("Next up · Stop 2 of 2");
  await expect(nowCard(maria).locator(".now-customer")).toHaveText("Bob Lee");
  await expect(maria.getByText("Done today (1)")).toBeVisible();
  await expect(workday(maria)).toContainText("On the clock since");

  // Not finished: clocked out, the job stays open.
  await nowCard(maria).getByRole("button", { name: "Clock in" }).click();
  await nowCard(maria).getByRole("button", { name: "Clock out, not finished" }).click();
  await expect(nowCard(maria).locator(".now-label")).toHaveText("Next up · Stop 2 of 2");
  await expect(nowCard(maria).getByRole("button", { name: "Clock in" })).toBeVisible();

  // End of the day asks once, then stops the clock.
  await workday(maria).getByRole("button", { name: "End my day" }).click();
  await workday(maria).getByRole("button", { name: "Yes, end my day" }).click();
  await expect(workday(maria).getByRole("button", { name: "Start my day" })).toBeVisible();
  await page.reload();
  await expect(crewNow).toContainText("0 of 2 on the clock");

  // The owner's Time page has her workday hours and each job's time.
  await page.goto("/time");
  await expect(page.getByTestId("workday-by-crew")).toContainText("Maria");
  await expect(page.getByTestId("workdays").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("time-entries").locator("li")).toHaveCount(2);
});

test("the owner clocks into their own jobs from Today too", async ({ page }) => {
  await signUpBusiness(page, "Solo Lawns");
  const ann = await addCustomer(page, "Ann Cho");
  await book(page, ann, "Mowing");

  await page.goto("/dashboard");
  await expect(nowCard(page).locator(".now-customer")).toHaveText("Ann Cho");
  await nowCard(page).getByRole("button", { name: "Clock in" }).click();
  await expect(workday(page)).toContainText("On the clock since");
  await nowCard(page).getByRole("button", { name: "Clock out & finish" }).click();
  await expect(page.getByText("All done for today")).toBeVisible();
  await expect(page.locator(".job-table tbody tr").first().locator(".status-pill")).toHaveText("Completed");
});

test("Today is the first tab, and everything else is one tap away", async ({ page, browser }) => {
  await signUpBusiness(page, "Menu Lawns");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText(["Today", "Schedule", "Customers", "Money", "More"]);
  await expect(nav.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  const maria = await joinCrew(browser, await addCrewMember(page, "Maria"));
  await expect(maria.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["Today", "My jobs"]);
});

test("crew only clock into their own jobs, and another business sees no one's clock", async ({ page, browser }) => {
  await signUpBusiness(page, "Own Jobs Lawns");
  const maria = await joinCrew(browser, await addCrewMember(page, "Maria"));
  await addCrewMember(page, "Luis");
  const jane = await addCustomer(page, "Jane Adams");
  const zed = await addCustomer(page, "Zed Quinn");
  await book(page, jane, "Mowing", "Maria");
  await book(page, zed, "Hedge trimming", "Luis");

  await maria.goto("/dashboard");
  await expect(maria.locator("[data-today-stop]")).toHaveCount(1);
  await expect(maria.locator("main")).not.toContainText("Zed Quinn");
  await nowCard(maria).getByRole("button", { name: "Clock in" }).click();
  await expect(workday(maria)).toContainText("On the clock since");

  const other = await (await browser.newContext({ timezoneId: TIME_ZONE })).newPage();
  await signUpBusiness(other, "Nosy Lawns");
  await other.goto("/dashboard");
  await expect(other.getByTestId("crew-now")).toHaveCount(0);
  await expect(other.locator("main")).not.toContainText("Maria");
  await other.goto("/time");
  await expect(other.getByTestId("workdays")).toContainText("No workdays in this date range.");
  await expect(other.locator("main")).not.toContainText("Maria");
});

test("the owner fixes a workday someone forgot to end", async ({ page, browser }) => {
  await signUpBusiness(page, "Fix Lawns");
  const maria = await joinCrew(browser, await addCrewMember(page, "Maria"));
  await maria.goto("/dashboard");
  await workday(maria).getByRole("button", { name: "Start my day" }).click();
  await expect(workday(maria)).toContainText("On the clock since");

  const yesterday = addDays(today(), -1);
  await page.goto("/time");
  await page.getByTestId("workdays").getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Started").fill(`${yesterday}T07:00`);
  await page.getByLabel("Ended").fill(`${yesterday}T15:30`);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Add a note saying why you changed this.")).toBeVisible();
  await page.getByLabel("Why are you changing this?").fill("Forgot to end the day");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Workday saved.")).toBeVisible();
  await page.goto(`/time?from=${yesterday}&to=${today()}`);
  await expect(page.getByTestId("workdays")).toContainText("edited: Forgot to end the day");
  await expect(page.getByTestId("workday-by-crew")).toContainText("8.5 h");

  // She's off the clock now, and can start today fresh.
  await maria.reload();
  await expect(workday(maria).getByRole("button", { name: "Start my day" })).toBeVisible();
});
