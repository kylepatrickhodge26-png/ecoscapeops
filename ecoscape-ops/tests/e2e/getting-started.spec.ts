import { expect, test } from "@playwright/test";

import { addDays, formatShortDate, nextWeekdayOnOrAfter, todayInTimeZone } from "../../src/lib/dates";
import { openMore, openMoreDetails, signUpBusiness } from "./helpers";

// Getting customers in: one at a time with their work booked in the same step, or a whole
// list at once.
const TIME_ZONE = "America/New_York";
test.use({ timezoneId: TIME_ZONE });
const today = () => todayInTimeZone(TIME_ZONE);

test("adding a customer can book their repeat service in the same step", async ({ page }) => {
  await signUpBusiness(page, "One Step Lawns");
  await page.getByRole("link", { name: "+ Add customer" }).click();
  await page.getByLabel("First name").fill("John");
  await page.getByLabel("Last name").fill("Smith");
  await page.getByLabel("Phone").fill("631-555-0100");
  await page.getByLabel("Property address").fill("12 Main St, Lake Ronkonkoma, NY");

  // A repeat service is the starting choice.
  await expect(page.getByLabel("Repeat service")).toBeChecked();
  const thursday = nextWeekdayOnOrAfter(addDays(today(), 1), 4);
  await page.getByLabel("Service", { exact: true }).fill("Mowing");
  await page.getByLabel("Price ($)").fill("50");
  await page.getByLabel("How often").selectOption("Every 2 weeks");
  await page.getByLabel("First visit").fill(thursday);
  // Their preferred day follows the first visit's day.
  await openMoreDetails(page);
  await expect(page.getByLabel("Preferred day")).toHaveValue("thursday");
  await page.getByRole("button", { name: "Add customer & book 6 visits" }).click();

  await expect(page.getByText("Customer added, and their work is on the schedule.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "John Smith" })).toBeVisible();
  const visits = page.locator(".visit-table tbody tr");
  await expect(visits).toHaveCount(6);
  await expect(visits.first()).toContainText(formatShortDate(thursday));
  await expect(visits.nth(1)).toContainText(formatShortDate(addDays(thursday, 14)));
  await expect(page.locator(".service-row")).toContainText("Mowing — $50.00 every 2 weeks");
  await expect(page.locator("dl.details")).toContainText("Thursday");
});

test("adding a customer can book a one-time job instead", async ({ page }) => {
  await signUpBusiness(page, "Patio Pros");
  await page.goto("/customers/new");
  await page.getByLabel("First name").fill("Karen");
  await page.getByLabel("Last name").fill("Lopez");
  await page.getByLabel("One-time job").check();
  // No "How often" for a one-time job.
  await expect(page.getByLabel("How often")).toHaveCount(0);
  await page.getByLabel("Service", { exact: true }).fill("Paver patio");
  await page.getByLabel("Price ($)").fill("4500");
  await page.getByLabel("Visit date").fill(addDays(today(), 10));
  await page.getByRole("button", { name: "Add customer & book visit" }).click();

  await expect(page.getByText("Customer added, and their work is on the schedule.")).toBeVisible();
  await expect(page.locator(".visit-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".visit-table tbody tr").first()).toContainText("Paver patio");
});

test("a mistake in the work keeps everything typed and saves nothing", async ({ page }) => {
  await signUpBusiness(page, "Careful Starts");
  await page.goto("/customers/new");
  await page.getByLabel("First name").fill("Dana");
  await page.getByLabel("Price ($)").fill("45");
  await page.getByRole("button", { name: "Add customer & book 6 visits" }).click();

  await expect(page.getByText("Please fix the highlighted fields.")).toBeVisible();
  await expect(page.getByLabel("Service", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("First name")).toHaveValue("Dana");
  await expect(page.getByLabel("Price ($)")).toHaveValue("45");
  await page.goto("/customers");
  await expect(page.getByText("No customers yet")).toBeVisible();
});

test("a list of customers can be pasted in all at once, and importing it again adds no one twice", async ({ page }) => {
  await signUpBusiness(page, "Import Lawns");
  await page.goto("/customers");
  await openMore(page);
  await page.getByRole("link", { name: "Import a list" }).click();
  await expect(page).toHaveURL(/\/customers\/import$/);

  const list = [
    "Name\tPhone\tAddress\tNotes",
    "John Smith\t631-555-0100\t12 Main St\tGate code 1234",
    "Karen Lopez\t631-555-0101\t40 Oak Ave\t",
    "\t\t\t",
    "\t\t9 Nowhere Rd\t",
  ].join("\n");
  await page.getByLabel("Paste your list").fill(list);

  // The columns are worked out from the first row, and the preview shows who's added.
  await expect(page.getByLabel("Column 1")).toHaveValue("name");
  await expect(page.getByLabel("Column 2")).toHaveValue("phone");
  await expect(page.getByLabel("Column 3")).toHaveValue("address");
  await expect(page.getByLabel("Column 4")).toHaveValue("notes");
  await expect(page.getByText("2 customers ready to add")).toBeVisible();
  await expect(page.locator(".import-preview tbody tr")).toHaveCount(2);
  await expect(page.getByText(/1 row is left out: line 5 \(no name, phone or email\)/)).toBeVisible();

  await page.getByRole("button", { name: "Add 2 customers" }).click();
  await expect(page).toHaveURL(/\/customers\?notice=imported/);
  await expect(page.getByText(/Added 2 customers from your list\./)).toBeVisible();
  await expect(page.locator("tbody tr td:first-child b")).toHaveText(["Karen Lopez", "John Smith"]);
  await page.getByRole("link", { name: "John Smith" }).click();
  await expect(page.getByText("Notes: Gate code 1234")).toBeVisible();

  // The same list again: everyone's already there.
  await page.goto("/customers/import");
  await page.getByLabel("Paste your list").fill(list);
  await page.getByRole("button", { name: "Add 2 customers" }).click();
  await expect(page.getByRole("alert")).toHaveText("Everyone on that list is already in your customers.");
  await page.goto("/customers");
  await expect(page.locator("tbody tr")).toHaveCount(2);
});

test("an imported list goes only into the business that imported it", async ({ browser }) => {
  const acmeContext = await browser.newContext({ timezoneId: TIME_ZONE });
  const acme = await acmeContext.newPage();
  await signUpBusiness(acme, "Acme Imports");
  await acme.goto("/customers/import");
  await acme.getByLabel("Paste your list").fill("Secret Client, 631-555-0199");
  await acme.getByRole("button", { name: "Add 1 customer" }).click();
  await expect(acme.getByText(/Added 1 customer from your list\./)).toBeVisible();

  const birchContext = await browser.newContext({ timezoneId: TIME_ZONE });
  const birch = await birchContext.newPage();
  await signUpBusiness(birch, "Birch Imports");
  await birch.goto("/customers");
  await expect(birch.getByText("No customers yet")).toBeVisible();
  await expect(birch.getByText("Secret Client")).toHaveCount(0);

  await acmeContext.close();
  await birchContext.close();
});
