import { expect, test, type Page } from "@playwright/test";

import { addDays, formatLongDate, formatShortDate, monthOf, nextWeekdayOnOrAfter, todayInTimeZone } from "../../src/lib/dates";
import { addCustomer, bookService, listedDates, signUpBusiness } from "./helpers";

// The business's time zone comes from the browser at signup; pin it so "today" is known.
const TIME_ZONE = "America/New_York";
test.use({ timezoneId: TIME_ZONE });
const today = () => todayInTimeZone(TIME_ZONE);

async function setUpCustomer(page: Page, business: string, preferredDay = "Tuesday") {
  await signUpBusiness(page, business);
  return addCustomer(page, { firstName: "John", lastName: "Smith", propertyAddress: "123 Example St", preferredDay });
}

async function openFirstUpcomingVisit(page: Page) {
  await page.goto("/schedule?view=list&filter=upcoming");
  await page.locator(".job-table tbody tr").first().getByRole("link", { name: "John Smith" }).click();
  await expect(page).toHaveURL(/\/schedule\/jobs\/[0-9a-f-]+/);
}

async function editVisit(page: Page, changes: { status?: string; date?: string; service?: string; price?: string }) {
  await page.getByRole("link", { name: "Edit" }).click();
  if (changes.status) await page.getByLabel("Status").selectOption(changes.status);
  if (changes.date) await page.getByLabel("Date").fill(changes.date);
  if (changes.service) await page.getByLabel("Service").fill(changes.service);
  if (changes.price) await page.getByLabel("Price ($)").fill(changes.price);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
}

test("booking a weekly service puts the next 6 visits on the schedule", async ({ page }) => {
  await setUpCustomer(page, "Weekly Lawns", "Tuesday");

  // From the new customer's page, like the prototype's "set up their service now?".
  await page.getByRole("link", { name: "Book their first service →" }).click();
  await expect(page.getByLabel("Customer")).toHaveValue(/[0-9a-f-]{36}/);
  const firstTuesday = nextWeekdayOnOrAfter(today(), 2);
  await expect(page.getByLabel("First visit")).toHaveValue(firstTuesday);

  await page.getByLabel("Service").fill("Mowing");
  await page.getByLabel("Price ($)").fill("65");
  await page.getByRole("button", { name: "Book 6 visits" }).click();

  await expect(
    page.getByText(`6 visits booked for John Smith — Mowing, every week, starting ${formatShortDate(firstTuesday)}.`),
  ).toBeVisible();
  await expect(page.locator(".calendar")).toHaveAttribute("data-month", monthOf(firstTuesday));
  const firstCell = page.locator(`.cal-cell[data-date="${firstTuesday}"]`);
  await expect(firstCell.locator(".cal-job")).toHaveAttribute("data-status", "scheduled");
  await expect(firstCell.getByText("John Smith")).toBeAttached();

  await page.getByRole("link", { name: "List" }).click();
  await expect(listedDates(page)).toHaveText([0, 7, 14, 21, 28, 35].map((d) => formatShortDate(addDays(firstTuesday, d))));
  await expect(page.locator(".job-table tbody tr").first()).toContainText("Mowing · $65.00");
});

test("a one-time booking creates a single visit, and Today shows it", async ({ page }) => {
  const customerId = await setUpCustomer(page, "One Time Co");
  await bookService(page, { customerId, service: "Spring cleanup", price: "350", frequency: "One time", startDate: today() });
  await expect(page.getByText(/^1 visit booked for John Smith — Spring cleanup, one time/)).toBeVisible();

  await page.goto("/schedule?view=list&filter=today");
  const rows = page.locator(".job-table tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Spring cleanup · $350.00");
  await expect(rows.first().locator(".date-tag")).toHaveText("Today");

  await page.getByRole("link", { name: "All" }).click();
  await expect(rows).toHaveCount(1);
});

test("the booking form checks its input", async ({ page }) => {
  await setUpCustomer(page, "Careful Bookers");
  await page.goto("/schedule/new");
  await page.getByLabel("First visit").fill(addDays(today(), -1));
  await page.getByLabel("Price ($)").fill("sixty");
  await page.getByRole("button", { name: "Book 6 visits" }).click();

  await expect(page.locator(".field-error", { hasText: "Choose a customer" })).toBeVisible();
  await expect(page.getByText("Enter the service, e.g. Mowing")).toBeVisible();
  await expect(page.getByText("Enter a price like 65 or 65.50")).toBeVisible();
  await expect(page.getByText(/The first visit can't be before today/)).toBeVisible();
  await expect(page.getByLabel("Price ($)")).toHaveValue("sixty");
});

test("completing a visit keeps 6 upcoming, and it shows under Completed", async ({ page }) => {
  const customerId = await setUpCustomer(page, "Always Six Lawns");
  const start = addDays(today(), 1);
  await bookService(page, { customerId, startDate: start });

  await openFirstUpcomingVisit(page);
  await page.getByRole("button", { name: "Mark completed" }).click();
  await expect(page.getByText("Marked completed.")).toBeVisible();
  await expect(page.locator(".status-pill")).toHaveAttribute("data-status", "completed");

  await page.goto("/schedule?view=list&filter=upcoming");
  await expect(listedDates(page)).toHaveText([7, 14, 21, 28, 35, 42].map((d) => formatShortDate(addDays(start, d))));

  await page.getByRole("link", { name: "Completed" }).click();
  await expect(listedDates(page)).toHaveText([formatShortDate(start)]);
});

test("'Could not service' reschedules the visit to a new day", async ({ page }) => {
  const customerId = await setUpCustomer(page, "Locked Gate Lawns");
  const start = addDays(today(), 2);
  await bookService(page, { customerId, startDate: start });
  await openFirstUpcomingVisit(page);

  await page.getByRole("button", { name: "Could not service" }).click();
  await expect(page.getByText("Couldn't service this visit? Reschedule it or cancel it.")).toBeVisible();
  await expect(page.getByLabel("New date")).toHaveValue(addDays(start, 1));

  // A date in the past is refused.
  await page.getByLabel("New date").fill(addDays(today(), -1));
  await page.getByRole("button", { name: "Reschedule" }).click();
  await expect(page.getByText(/The new date can't be before today/)).toBeVisible();

  await page.getByLabel("What happened? (optional)").fill("Gate locked");
  await page.getByLabel("New date").fill(addDays(start, 3));
  await page.getByRole("button", { name: "Reschedule" }).click();

  await expect(page.getByText("Visit rescheduled.")).toBeVisible();
  await expect(page.locator(".status-pill")).toHaveAttribute("data-status", "scheduled");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mowing for John Smith");
  await expect(page.locator(".pagehead .meta")).toContainText(formatLongDate(addDays(start, 3)));
  await expect(
    page.getByText(
      `Couldn't service on ${formatShortDate(start)} (Gate locked) — rescheduled to ${formatShortDate(addDays(start, 3))}.`,
    ),
  ).toBeVisible();
});

test("'Could not service' can cancel the visit instead, and the next one is added", async ({ page }) => {
  const customerId = await setUpCustomer(page, "Called Off Lawns");
  const start = addDays(today(), 1);
  await bookService(page, { customerId, startDate: start });
  await openFirstUpcomingVisit(page);

  await page.getByRole("button", { name: "Could not service" }).click();
  await page.getByLabel("What happened? (optional)").fill("Customer asked to skip");
  await page.getByRole("button", { name: "Cancel visit" }).click();

  await expect(page.getByText("Visit cancelled.")).toBeVisible();
  await expect(page.locator(".status-pill")).toHaveAttribute("data-status", "cancelled");
  await expect(page.getByText(`Couldn't service on ${formatShortDate(start)} (Customer asked to skip) — cancelled.`)).toBeVisible();
  // A closed visit offers no more "complete" / "could not service" actions.
  await expect(page.getByRole("button", { name: "Could not service" })).toHaveCount(0);

  await page.goto("/schedule?view=list&filter=upcoming");
  await expect(listedDates(page)).toHaveCount(6);
  await expect(listedDates(page).last()).toHaveText(formatShortDate(addDays(start, 42)));
});

test("Needs attention collects weather delays and overdue visits", async ({ page }) => {
  const customerId = await setUpCustomer(page, "Attention Lawns");
  await bookService(page, { customerId, startDate: addDays(today(), 1) });

  await page.goto("/schedule?view=list&filter=attention");
  await expect(page.getByText("All clear")).toBeVisible();

  await openFirstUpcomingVisit(page);
  await editVisit(page, { status: "Weather delay" });
  await expect(page.locator(".status-pill")).toHaveAttribute("data-status", "weather_delay");

  // Another visit whose day has passed without being closed out is overdue.
  await page.goto("/schedule?view=list&filter=upcoming");
  await page.locator(".job-table tbody tr").nth(1).getByRole("link", { name: "John Smith" }).click();
  await editVisit(page, { date: addDays(today(), -2) });
  await expect(page.locator(".job-status-row .date-tag")).toHaveText("Overdue");

  await page.goto("/schedule?view=list&filter=attention");
  const rows = page.locator(".job-table tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Overdue");
  await expect(rows.nth(1).locator(".status-pill")).toHaveAttribute("data-status", "weather_delay");
  await expect(page.locator(".count-badge")).toHaveText("2");
});

test("every status has its own shape and color", async ({ page }) => {
  const customerId = await setUpCustomer(page, "Shapes Lawns");
  await bookService(page, { customerId, startDate: addDays(today(), 1) });
  await page.goto("/schedule");

  const legend = page.locator(".status-legend li");
  await expect(legend).toHaveCount(8);
  const entries = await legend.evaluateAll((items) =>
    items.map((li) => {
      const svg = li.querySelector("svg")!;
      return { label: li.textContent, shape: svg.dataset.shape, color: getComputedStyle(svg).color };
    }),
  );
  expect(entries.map((e) => e.label)).toEqual([
    "Scheduled",
    "Assigned",
    "En route",
    "In progress",
    "Completed",
    "Unable to complete",
    "Weather delay",
    "Cancelled",
  ]);
  expect(new Set(entries.map((e) => e.shape)).size).toBe(8);
  expect(new Set(entries.map((e) => e.color)).size).toBe(8);

  // A visit's status shows up with its shape on the calendar and as a labelled pill.
  await openFirstUpcomingVisit(page);
  await editVisit(page, { status: "En route" });
  await expect(page.locator(".status-pill")).toHaveText("En route");
  await expect(page.locator(".status-pill svg")).toHaveAttribute("data-shape", "arrow");
  await page.getByRole("link", { name: "← Schedule" }).click();
  await expect(page.locator('.cal-job[data-status="en_route"] svg')).toHaveAttribute("data-shape", "arrow");
});

test("a visit can be edited and deleted", async ({ page }) => {
  const customerId = await setUpCustomer(page, "Edit Lawns");
  const start = addDays(today(), 3);
  await bookService(page, { customerId, startDate: start });
  await openFirstUpcomingVisit(page);

  await editVisit(page, { service: "Mowing + edging", price: "80", date: addDays(start, 1) });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mowing + edging for John Smith");
  await expect(page.locator("dl.details")).toContainText("$80.00");

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(`Delete this Mowing + edging visit for John Smith on ${formatShortDate(addDays(start, 1))}?`)).toBeVisible();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page).toHaveURL(new RegExp(`/schedule/day/${addDays(start, 1)}\\?notice=deleted$`));
  await expect(page.getByText("Visit deleted.")).toBeVisible();
  await expect(page.getByText("Nothing scheduled")).toBeVisible();
});

test("stopping a recurring service removes its upcoming visits", async ({ page }) => {
  const customerId = await setUpCustomer(page, "Season End Lawns");
  await bookService(page, { customerId, startDate: addDays(today(), 1) });

  await page.goto(`/customers/${customerId}`);
  const service = page.locator(".service-row");
  await expect(service).toContainText("Mowing — $65.00 every week");
  await expect(page.locator(".visit-table tbody tr")).toHaveCount(6);

  await service.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText(/the 6 upcoming visits that haven't started will be removed/)).toBeVisible();
  await page.getByRole("button", { name: "Stop service" }).click();

  await expect(page.getByText("Service stopped. 6 upcoming visits were removed from the schedule.")).toBeVisible();
  await expect(service).toContainText("Stopped");
  await expect(page.getByText("No upcoming visits.")).toBeVisible();

  await page.goto("/schedule?view=list&filter=all");
  await expect(page.getByText("No visits yet")).toBeVisible();
});

test("deleting a customer warns that their visits go too", async ({ page }) => {
  const customerId = await setUpCustomer(page, "Goodbye Lawns");
  await bookService(page, { customerId, startDate: addDays(today(), 1) });
  await page.goto(`/customers/${customerId}`);
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/This also permanently deletes their 6 visits and booked services/)).toBeVisible();
});

test("a business never sees another business's visits", async ({ browser }) => {
  const acmeContext = await browser.newContext({ timezoneId: TIME_ZONE });
  const acme = await acmeContext.newPage();
  const customerId = await setUpCustomer(acme, "Acme Lawn Care");
  await bookService(acme, { customerId, startDate: addDays(today(), 1) });
  await openFirstUpcomingVisit(acme);
  const visitPath = new URL(acme.url()).pathname;

  const birchContext = await browser.newContext({ timezoneId: TIME_ZONE });
  const birch = await birchContext.newPage();
  await signUpBusiness(birch, "Birch Tree Services");
  await birch.goto("/schedule?view=list&filter=all");
  await expect(birch.getByText("No visits yet")).toBeVisible();
  await birch.goto(`/schedule?month=${monthOf(addDays(today(), 1))}`);
  await expect(birch.locator(".cal-job")).toHaveCount(0);

  await birch.goto(visitPath);
  await expect(birch.getByText("Visit not found")).toBeVisible();
  await birch.goto(`${visitPath}/edit`);
  await expect(birch.getByText("Visit not found")).toBeVisible();

  await acmeContext.close();
  await birchContext.close();
});

test("on a phone, the calendar shows status shapes and a day opens its visits", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout only");
  const customerId = await setUpCustomer(page, "Pocket Lawns");
  const start = addDays(today(), 1);
  await bookService(page, { customerId, startDate: start });

  const cell = page.locator(`.cal-cell[data-date="${start}"]`);
  await expect(cell.locator(".status-shape")).toBeVisible();
  await expect(cell.locator(".cal-job-name")).toBeHidden();
  await cell.click();
  await expect(page).toHaveURL(new RegExp(`/schedule/day/${start}$`));
  await expect(page.locator(".job-table tbody tr")).toHaveCount(1);
});
