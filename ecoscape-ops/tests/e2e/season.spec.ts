import { expect, test, type Browser, type Page } from "@playwright/test";

import { addDays, todayInTimeZone } from "../../src/lib/dates";
import { PASSWORD, signUpBusiness, uniqueEmail } from "./helpers";

// Done for the season: one tap takes a customer's repeat visits off the schedule (one-time
// jobs stay), repeat bookings made meanwhile wait, and Start again brings them back. Crew
// stop seeing the paused visits, and the Edit form's Status does the same.
const TIME_ZONE = "America/New_York";
test.use({ timezoneId: TIME_ZONE });
const today = () => todayInTimeZone(TIME_ZONE);

async function addCustomer(page: Page, first: string, last: string) {
  await page.goto("/customers/new");
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill(last);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText("Customer added.")).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2];
}

async function book(page: Page, customerId: string, service: string, often: string, date: string, assignee?: string) {
  await page.goto(`/schedule/new?customer=${customerId}`);
  await page.getByLabel("Service").fill(service);
  await page.getByLabel("Price ($)").fill("40");
  await page.getByLabel("How often").selectOption(often);
  await page.getByLabel(/First visit|Visit date/).fill(date);
  if (assignee) await page.getByLabel("Assign to").selectOption({ label: assignee });
  await page.getByRole("button", { name: /^Book/ }).click();
}

async function joinCrew(page: Page, browser: Browser, name: string) {
  await page.goto("/crew");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add and get invite link" }).click();
  const url = await page.getByLabel(`Invite link for ${name}`).inputValue();
  const crew = await (await browser.newContext({ timezoneId: TIME_ZONE, ...(test.info().project.use ?? {}) })).newPage();
  await crew.goto(url);
  await crew.getByLabel("Email").fill(uniqueEmail("crew"));
  await crew.getByLabel("Choose a password").fill(PASSWORD);
  await crew.getByRole("button", { name: "Create login and join" }).click();
  await expect(crew).toHaveURL(/\/my-jobs$/);
  return crew;
}

const upcomingRows = (page: Page) => page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Upcoming visits" }) }).locator("tbody tr");
const service = (page: Page, name: string) => page.locator(".service-row", { hasText: name });

test("Done for the season takes repeat visits off, and Start again brings them back", async ({ page }) => {
  await signUpBusiness(page, "Season Lawns");
  const jane = await addCustomer(page, "Jane", "Adams");
  await book(page, jane, "Mowing", "Every week", today());
  await expect(page.getByText(/booked for/)).toBeVisible();
  await book(page, jane, "Fall cleanup", "One time", addDays(today(), 8));
  await expect(page.getByText(/booked for/)).toBeVisible();

  await page.goto(`/customers/${jane}`);
  await expect(upcomingRows(page)).toHaveCount(7);

  // One tap (and a yes): the repeat visits come off; the cleanup stays.
  await page.getByRole("button", { name: "Done for the season" }).click();
  await expect(page.getByText(/Their 6 upcoming repeat visits come off the schedule/)).toBeVisible();
  await page.getByRole("button", { name: "Yes, done for the season" }).click();
  await expect(page.getByText("Done for the season. 6 upcoming repeat visits came off the schedule.")).toBeVisible();
  await expect(upcomingRows(page)).toHaveCount(1);
  await expect(upcomingRows(page)).toContainText("Fall cleanup");
  await expect(service(page, "Mowing")).toContainText("Paused for the season");
  await expect(page.locator(".details dd").first()).toHaveText("inactive");

  // A repeat service booked meanwhile waits.
  await book(page, jane, "Edging", "Every 2 weeks", addDays(today(), 2));
  await expect(page).toHaveURL(new RegExp(`/customers/${jane}\\?notice=booked-waiting$`));
  await expect(page.getByText(/Booked\. It starts when you tap Start again/)).toBeVisible();
  await expect(service(page, "Edging")).toContainText("Paused for the season");
  await expect(upcomingRows(page)).toHaveCount(1);
  await page.goto(`/customers/${jane}`);
  await expect(page.getByTestId("season-paused")).toBeVisible();

  // Start again: back on the schedule, mowing from today.
  await page.getByRole("button", { name: "Start again" }).click();
  await expect(page.getByText(/Back for the season\. Their repeat visits are on the schedule again, starting/)).toBeVisible();
  await expect(upcomingRows(page)).toHaveCount(13);
  await expect(service(page, "Mowing")).toContainText("Next visit");
  await expect(page.locator(".details dd").first()).toHaveText("active");
  await expect(page.getByRole("button", { name: "Done for the season" })).toBeVisible();
});

test("crew stop seeing a paused customer, and the Edit form's Status works the same", async ({ page, browser }) => {
  await signUpBusiness(page, "Crew Season Lawns");
  const maria = await joinCrew(page, browser, "Maria");
  const bob = await addCustomer(page, "Bob", "Lee");
  await book(page, bob, "Mowing", "Every week", today(), "Maria");
  await expect(page.getByText(/booked for/)).toBeVisible();

  await maria.goto("/dashboard");
  await expect(maria.locator(".now-card .now-customer")).toHaveText("Bob Lee");

  await page.goto(`/customers/${bob}/edit`);
  await page.getByLabel("Status").selectOption("Inactive");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect(upcomingRows(page)).toHaveCount(0);

  await maria.reload();
  await expect(maria.getByText("Nothing on your route today")).toBeVisible();
  await maria.goto("/my-jobs");
  await expect(maria.locator("main")).not.toContainText("Bob Lee");

  await page.goto(`/customers/${bob}/edit`);
  await page.getByLabel("Status").selectOption("Active");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(upcomingRows(page)).toHaveCount(6);
  await maria.goto("/dashboard");
  await expect(maria.locator(".now-card .now-customer")).toHaveText("Bob Lee");
});

test("another business can't pause your customers", async ({ page, browser }) => {
  await signUpBusiness(page, "Mine Lawns");
  const jane = await addCustomer(page, "Jane", "Adams");
  await book(page, jane, "Mowing", "Every week", today());
  await expect(page.getByText(/booked for/)).toBeVisible();

  const other = await (await browser.newContext({ timezoneId: TIME_ZONE, ...(test.info().project.use ?? {}) })).newPage();
  await signUpBusiness(other, "Other Lawns");
  await other.goto(`/customers/${jane}`);
  await expect(other.getByRole("button", { name: "Done for the season" })).toHaveCount(0);
  await expect(other.locator("main")).not.toContainText("Jane Adams");

  await page.goto(`/customers/${jane}`);
  await expect(upcomingRows(page)).toHaveCount(6);
});
