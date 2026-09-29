import { expect, test, type Browser, type Page } from "@playwright/test";

import { addDays, monthOf, todayInTimeZone } from "../../src/lib/dates";
import { formatPrice } from "../../src/lib/schedule/constants";
import { PASSWORD, addCustomer, signUpBusiness, uniqueEmail } from "./helpers";

const TIME_ZONE = "America/New_York";
test.use({ timezoneId: TIME_ZONE });
const today = () => todayInTimeZone(TIME_ZONE);
const inThisMonth = (date: string) => monthOf(date) === monthOf(today());

const card = (page: Page, name: "today" | "tomorrow" | "week" | "revenue" | "profit" | "outstanding") =>
  page.locator(`[data-card="${name}"]`);

async function book(
  page: Page,
  customerId: string,
  b: { service?: string; price: string; frequency?: "Every week" | "One time"; date: string; assignee?: string },
) {
  await page.goto(`/schedule/new?customer=${customerId}`);
  await page.getByLabel("Service").fill(b.service ?? "Mowing");
  await page.getByLabel("Price ($)").fill(b.price);
  await page.getByLabel("How often").selectOption(b.frequency ?? "One time");
  await page.getByLabel(/First visit|Visit date/).fill(b.date);
  if (b.assignee) await page.getByLabel("Assign to").selectOption({ label: b.assignee });
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
  const page = await (await browser.newContext({ timezoneId: TIME_ZONE })).newPage();
  await page.goto(inviteUrl);
  await page.getByLabel("Email").fill(uniqueEmail("crew"));
  await page.getByLabel("Choose a password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create login and join" }).click();
  await expect(page).toHaveURL(/\/my-jobs$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  return page;
}

test("a new business's dashboard starts at zero, with quick actions one tap away", async ({ page }) => {
  await signUpBusiness(page, "Fresh Start Lawns");
  await expect(card(page, "today").locator(".big")).toHaveText("0");
  await expect(card(page, "tomorrow").locator(".big")).toHaveText("0");
  await expect(card(page, "week").locator(".big")).toHaveText("0");
  await expect(card(page, "revenue").locator(".big")).toHaveText("$0.00");
  await expect(card(page, "profit")).toContainText("revenue minus $0.00 in expenses this month");
  await expect(card(page, "outstanding").locator(".big")).toHaveText("$0.00");
  await expect(card(page, "outstanding")).toContainText("nothing overdue");

  const quick = page.locator(".quick-actions");
  await quick.getByRole("link", { name: "+ Add customer" }).click();
  await expect(page).toHaveURL(/\/customers\/new$/);
  await page.goto("/dashboard");
  await quick.getByRole("link", { name: "+ Book a job" }).click();
  await expect(page).toHaveURL(/\/schedule\/new$/);
  await page.goto("/dashboard");
  await quick.getByRole("link", { name: "Manage crew" }).click();
  await expect(page).toHaveURL(/\/crew$/);
});

test("counts and revenue follow what's booked, completed, and cancelled", async ({ page }) => {
  await signUpBusiness(page, "Numbers Lawns");
  const john = await addCustomer(page, { firstName: "John", lastName: "Smith" });
  const mike = await addCustomer(page, { firstName: "Mike", lastName: "Jones" });
  const dana = await addCustomer(page, { firstName: "Dana", lastName: "Reyes" });

  const t = today();
  const bookings = [
    { customerId: john, price: "65", frequency: "Every week" as const, date: t },
    { customerId: mike, price: "70", date: addDays(t, 1) },
    { customerId: dana, price: "120", date: addDays(t, 6) },
    { customerId: dana, price: "40", date: addDays(t, 7), service: "Cleanup" },
  ];
  for (const b of bookings) await book(page, b.customerId, b);

  // Every non-cancelled visit dated this month counts, completed or not.
  const johnVisits = [0, 7, 14, 21, 28, 35].map((d) => addDays(t, d));
  let booked =
    65 * johnVisits.filter(inThisMonth).length +
    (inThisMonth(addDays(t, 1)) ? 70 : 0) +
    (inThisMonth(addDays(t, 6)) ? 120 : 0) +
    (inThisMonth(addDays(t, 7)) ? 40 : 0);

  await page.goto("/dashboard");
  await expect(card(page, "today").locator(".big")).toHaveText("1");
  await expect(card(page, "today")).toContainText("0 completed · 1 remaining");
  await expect(card(page, "tomorrow").locator(".big")).toHaveText("1");
  await expect(card(page, "week").locator(".big")).toHaveText("3"); // +7 is outside the week
  await expect(card(page, "revenue").locator(".big")).toHaveText(formatPrice(booked));
  await expect(card(page, "revenue")).toContainText("$0.00 completed so far");
  await expect(card(page, "profit").locator(".big")).toHaveText(formatPrice(booked));
  const todaysJobs = page.locator(".job-table tbody tr");
  await expect(todaysJobs).toHaveCount(1);
  await expect(todaysJobs.first()).toContainText("John Smith");

  // Complete today's visit (the next one is added 6 weeks out — never this month).
  await todaysJobs.first().locator(".row-link").click();
  await page.getByRole("button", { name: "Mark completed" }).click();
  await expect(page.getByText("Marked completed.")).toBeVisible();

  // Mike's visit tomorrow is called off.
  await page.goto("/schedule?view=list&filter=upcoming");
  await page.getByRole("row", { name: /Mike Jones/ }).locator(".row-link").click();
  await page.getByRole("button", { name: "Could not service" }).click();
  await page.getByRole("button", { name: "Cancel visit" }).click();
  await expect(page.getByText("Visit cancelled.")).toBeVisible();
  if (inThisMonth(addDays(t, 1))) booked -= 70;

  await page.goto("/dashboard");
  await expect(card(page, "today")).toContainText("1 completed · 0 remaining");
  await expect(card(page, "tomorrow").locator(".big")).toHaveText("0");
  await expect(card(page, "week").locator(".big")).toHaveText("2");
  await expect(card(page, "revenue").locator(".big")).toHaveText(formatPrice(booked));
  await expect(card(page, "revenue")).toContainText(`${formatPrice(65)} completed so far`);
  await expect(todaysJobs.first().locator(".status-pill")).toHaveText("Completed");
});

test("a crew member's dashboard counts only their own jobs and shows no money", async ({ page, browser }) => {
  await signUpBusiness(page, "Split Crew Lawns");
  const customer = await addCustomer(page, { firstName: "John", lastName: "Smith" });
  const mariaLink = await addCrewMember(page, "Maria");
  const luisLink = await addCrewMember(page, "Luis");
  const t = today();
  await book(page, customer, { service: "Mowing", price: "65", frequency: "Every week", date: t, assignee: "Maria" });
  await book(page, customer, { service: "Hedge trimming", price: "999", date: t, assignee: "Luis" });
  await book(page, customer, { service: "Leaf cleanup", price: "50", date: addDays(t, 1), assignee: "Luis" });
  await book(page, customer, { service: "Edging", price: "10", date: t, assignee: "Unassigned" });

  const maria = await joinCrew(browser, mariaLink);
  await expect(card(maria, "today").locator(".big")).toHaveText("1");
  await expect(card(maria, "tomorrow").locator(".big")).toHaveText("0");
  await expect(card(maria, "week").locator(".big")).toHaveText("1");
  await expect(card(maria, "revenue")).toHaveCount(0);
  await expect(card(maria, "profit")).toHaveCount(0);
  await expect(maria.locator("main")).not.toContainText("$");
  await expect(maria.getByRole("link", { name: "+ Add customer" })).toHaveCount(0);
  await expect(maria.getByRole("link", { name: "+ Book a job" })).toHaveCount(0);
  const mariaJobs = maria.locator("article.jobitem");
  await expect(mariaJobs).toHaveCount(1);
  await expect(mariaJobs.first()).toContainText("Mowing");
  for (const other of ["Hedge trimming", "Leaf cleanup", "Edging"]) await expect(maria.getByText(other)).toHaveCount(0);

  const luis = await joinCrew(browser, luisLink);
  await expect(card(luis, "today").locator(".big")).toHaveText("1");
  await expect(card(luis, "tomorrow").locator(".big")).toHaveText("1");
  await expect(card(luis, "week").locator(".big")).toHaveText("2");
  await expect(luis.locator("article.jobitem")).toHaveCount(1);
  await expect(luis.locator("article.jobitem").first()).toContainText("Hedge trimming");
  await expect(luis.getByText("Mowing")).toHaveCount(0);
  await expect(luis.locator("main")).not.toContainText("$");

  // The owner sees the whole business.
  await page.goto("/dashboard");
  await expect(card(page, "today").locator(".big")).toHaveText("3");
  await expect(card(page, "tomorrow").locator(".big")).toHaveText("1");
});

test("a crew member acting on a job from their dashboard updates their numbers", async ({ page, browser }) => {
  await signUpBusiness(page, "Crew Action Lawns");
  const customer = await addCustomer(page, { firstName: "John", lastName: "Smith" });
  const link = await addCrewMember(page, "Maria");
  await book(page, customer, { price: "65", date: today(), assignee: "Maria" });

  const maria = await joinCrew(browser, link);
  await maria.locator("article.jobitem").first().getByRole("button", { name: "Mark completed" }).click();
  await expect(maria.getByText("Job marked completed.")).toBeVisible();
  await maria.goto("/dashboard");
  await expect(card(maria, "today")).toContainText("1 completed · 0 remaining");

  await page.goto("/dashboard");
  await expect(card(page, "revenue")).toContainText(`${formatPrice(65)} completed so far`);
});

test("another business's crew member sees none of this business's numbers", async ({ page, browser }) => {
  await signUpBusiness(page, "Acme Lawn Care");
  const customer = await addCustomer(page, { firstName: "Secret", lastName: "Client" });
  await addCrewMember(page, "Maria");
  for (const price of ["100", "200", "300"]) await book(page, customer, { price, date: today(), assignee: "Kyle (you)" });

  const birchOwner = await (await browser.newContext({ timezoneId: TIME_ZONE })).newPage();
  await signUpBusiness(birchOwner, "Birch Tree Services");
  const zoe = await joinCrew(browser, await addCrewMember(birchOwner, "Zoe"));

  await expect(zoe.getByTestId("business-name")).toHaveText("Birch Tree Services");
  for (const name of ["today", "tomorrow", "week"] as const) await expect(card(zoe, name).locator(".big")).toHaveText("0");
  await expect(zoe.getByText("Secret Client")).toHaveCount(0);

  await birchOwner.goto("/dashboard");
  await expect(card(birchOwner, "today").locator(".big")).toHaveText("0");
  await expect(card(birchOwner, "revenue").locator(".big")).toHaveText("$0.00");
});

test("everyone's home is their dashboard", async ({ page, browser }) => {
  await signUpBusiness(page, "Home Lawns");
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

  const crew = await joinCrew(browser, await addCrewMember(page, "Maria"));
  const nav = crew.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText(["Home", "My jobs"]);
});
