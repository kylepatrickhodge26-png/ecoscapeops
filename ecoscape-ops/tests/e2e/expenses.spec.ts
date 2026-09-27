import { expect, test, type Browser, type Page } from "@playwright/test";

import { addDays, formatShortDate, monthOf, todayInTimeZone } from "../../src/lib/dates";
import { PASSWORD, addCustomer, signUpBusiness, uniqueEmail } from "./helpers";

const TIME_ZONE = "America/New_York";
test.use({ timezoneId: TIME_ZONE });
const today = () => todayInTimeZone(TIME_ZONE);

const profit = (page: Page) => page.locator('[data-card="profit"]');
const expenseRows = (page: Page) => page.locator(".expense-table tbody tr");

async function bookToday(page: Page, price: string) {
  const customerId = await addCustomer(page, { firstName: "John", lastName: "Smith" });
  await page.goto(`/schedule/new?customer=${customerId}`);
  await page.getByLabel("Service").fill("Mowing");
  await page.getByLabel("Price ($)").fill(price);
  await page.getByLabel("How often").selectOption("One time");
  await page.getByLabel("Visit date").fill(today());
  await page.getByRole("button", { name: "Book visit" }).click();
  await expect(page.getByText(/booked for/)).toBeVisible();
}

async function quickLog(page: Page, label: "Log gas" | "Log equipment", amount: string, vendor?: string) {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: label }).click();
  const form = page.getByRole("form", { name: label });
  await form.getByLabel("Amount ($)").fill(amount);
  if (vendor) await form.getByLabel("Where (optional)").fill(vendor);
  await form.getByRole("button", { name: "Log it" }).click();
  await expect(page).toHaveURL(/\/dashboard\?logged=/);
}

async function addExpense(page: Page, e: { category: string; amount: string; vendor?: string; notes?: string; date?: string }) {
  await page.goto("/expenses/new");
  if (e.date) await page.getByLabel("Date").fill(e.date);
  await page.getByLabel("Category").selectOption({ label: e.category });
  await page.getByLabel("Amount ($)").fill(e.amount);
  if (e.vendor) await page.getByLabel("Vendor").fill(e.vendor);
  if (e.notes) await page.getByLabel("Notes").fill(e.notes);
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("Expense added.")).toBeVisible();
}

async function joinCrew(browser: Browser, owner: Page, name: string) {
  await owner.goto("/crew");
  await owner.getByLabel("Name", { exact: true }).fill(name);
  await owner.getByRole("button", { name: "Add and get invite link" }).click();
  const link = await owner.getByLabel(`Invite link for ${name}`).inputValue();
  const crew = await (await browser.newContext({ timezoneId: TIME_ZONE })).newPage();
  await crew.goto(link);
  await crew.getByLabel("Email").fill(uniqueEmail("crew"));
  await crew.getByLabel("Choose a password").fill(PASSWORD);
  await crew.getByRole("button", { name: "Create login and join" }).click();
  await expect(crew).toHaveURL(/\/my-jobs$/);
  return crew;
}

test("quick-logging gas and equipment from the dashboard lowers this month's profit", async ({ page }) => {
  await signUpBusiness(page, "Quick Log Lawns");
  await bookToday(page, "300");
  await page.goto("/dashboard");
  await expect(profit(page).locator(".big")).toHaveText("$300.00");

  await quickLog(page, "Log gas", "62.40", "Speedway");
  await expect(page.getByText(`Logged $62.40 for fuel (Speedway) on ${formatShortDate(today())}.`)).toBeVisible();
  await expect(profit(page).locator(".big")).toHaveText("$237.60");
  await expect(profit(page)).toContainText("revenue minus $62.40 in expenses this month");
  // The form closes after saving.
  await expect(page.getByRole("form", { name: "Log gas" })).toHaveCount(0);

  await quickLog(page, "Log equipment", "410");
  await expect(page.getByText(/Logged \$410\.00 for equipment on/)).toBeVisible();
  await expect(profit(page).locator(".big")).toHaveText("-$172.40");

  await page.getByRole("link", { name: "$472.40 in expenses" }).click();
  await expect(page).toHaveURL(/\/expenses$/);
  await expect(page.locator('[data-card="month-total"] .big')).toHaveText("$472.40");
  await expect(expenseRows(page)).toHaveCount(2);
  await expect(page.getByRole("row", { name: /Fuel/ })).toContainText("Speedway");
  await expect(page.getByRole("row", { name: /Equipment/ })).toContainText("$410.00");
});

test("quick-log checks the amount", async ({ page }) => {
  await signUpBusiness(page, "Careful Loggers");
  await page.getByRole("button", { name: "Log gas" }).click();
  const form = page.getByRole("form", { name: "Log gas" });
  await form.getByLabel("Where (optional)").fill("Shell");
  await form.getByRole("button", { name: "Log it" }).click();
  await expect(form.getByRole("alert")).toHaveText("Enter an amount like 62.40");
  await expect(form.getByLabel("Where (optional)")).toHaveValue("Shell");
});

test("the full form logs any category, into the right month", async ({ page }) => {
  await signUpBusiness(page, "Ledger Lawns");
  await page.locator(".quick-actions").getByRole("link", { name: "+ Other expense" }).click();
  await expect(page).toHaveURL(/\/expenses\/new$/);
  await expect(page.getByLabel("Category").locator("option")).toHaveText([
    "Fuel",
    "Equipment",
    "Repairs",
    "Materials",
    "Fertilizer",
    "Mulch",
    "Payroll",
    "Insurance",
    "Advertising",
    "Vehicle",
    "Other",
  ]);

  // Bad input is explained and kept.
  await page.getByLabel("Amount ($)").fill("0");
  await page.getByLabel("Vendor").fill("Garden Supply Co");
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("The amount must be more than $0")).toBeVisible();
  await expect(page.getByLabel("Vendor")).toHaveValue("Garden Supply Co");

  await addExpense(page, { category: "Mulch", amount: "180", vendor: "Garden Supply Co", notes: "12 yards" });
  await expect(page.getByRole("row", { name: /Mulch/ })).toContainText("12 yards");

  // Last month's insurance shows under last month, and doesn't touch this month.
  const lastMonthDay = addDays(`${monthOf(today())}-01`, -1);
  await addExpense(page, { category: "Insurance", amount: "900", date: lastMonthDay });
  await expect(page).toHaveURL(new RegExp(`/expenses\\?month=${monthOf(lastMonthDay)}&notice=added$`));
  await expect(page.getByRole("row", { name: /Insurance/ })).toContainText("$900.00");
  await expect(expenseRows(page)).toHaveCount(1);

  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page.getByRole("row", { name: /Insurance/ })).toHaveCount(0);
  await expect(page.locator('[data-card="month-total"] .big')).toHaveText("$180.00");
  await expect(page.locator('[data-card="by-category"]')).toContainText("Mulch");

  await page.goto("/dashboard");
  await expect(profit(page)).toContainText("revenue minus $180.00 in expenses this month");
});

test("an expense can be edited and deleted", async ({ page }) => {
  await signUpBusiness(page, "Fix It Lawns");
  await addExpense(page, { category: "Repairs", amount: "85", vendor: "Small Engine Shop" });

  await page.getByRole("row", { name: /Repairs/ }).locator(".row-link").click();
  await expect(page.getByLabel("Amount ($)")).toHaveValue("85.00");
  await page.getByLabel("Amount ($)").fill("95.50");
  await page.getByLabel("Category").selectOption({ label: "Vehicle" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Vehicle/ })).toContainText("$95.50");
  await expect(page.getByRole("row", { name: /Repairs/ })).toHaveCount(0);

  await page.getByRole("row", { name: /Vehicle/ }).locator(".row-link").click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/Delete this \$95\.50 vehicle expense/)).toBeVisible();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText("Expense deleted.")).toBeVisible();
  await expect(page.getByText("No expenses this month")).toBeVisible();
});

test("crew members never see expenses", async ({ page, browser }) => {
  await signUpBusiness(page, "Private Books Lawns");
  await addExpense(page, { category: "Payroll", amount: "1200", vendor: "Payroll Co" });
  await page.getByRole("row", { name: /Payroll/ }).locator(".row-link").click();
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}\/edit$/);
  const editPath = new URL(page.url()).pathname;

  const crew = await joinCrew(browser, page, "Maria");
  await expect(crew.getByRole("link", { name: "Expenses" })).toHaveCount(0);
  for (const path of ["/expenses", "/expenses/new", editPath]) {
    await crew.goto(path);
    await expect(crew, path).toHaveURL(/\/my-jobs$/);
  }
  await crew.goto("/dashboard");
  await expect(crew.getByRole("button", { name: "Log gas" })).toHaveCount(0);
  await expect(crew.locator("main")).not.toContainText("$");
  await expect(crew.getByText("Payroll")).toHaveCount(0);
});

test("another business never sees this business's expenses", async ({ page, browser }) => {
  await signUpBusiness(page, "Acme Lawn Care");
  await addExpense(page, { category: "Advertising", amount: "250", vendor: "Secret Ad Agency" });
  await page.getByRole("row", { name: /Advertising/ }).locator(".row-link").click();
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}\/edit$/);
  const editPath = new URL(page.url()).pathname;

  const birch = await (await browser.newContext({ timezoneId: TIME_ZONE })).newPage();
  await signUpBusiness(birch, "Birch Tree Services");
  await expect(profit(birch)).toContainText("revenue minus $0.00 in expenses this month");
  await birch.goto("/expenses");
  await expect(birch.getByText("No expenses this month")).toBeVisible();
  await expect(birch.getByText("Secret Ad Agency")).toHaveCount(0);
  await birch.goto(editPath);
  await expect(birch.getByText("Expense not found")).toBeVisible();
  await expect(birch.getByText("Secret Ad Agency")).toHaveCount(0);
});
