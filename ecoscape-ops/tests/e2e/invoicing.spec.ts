import { expect, test, type Browser, type Page } from "@playwright/test";

import { formatShortDate, todayInTimeZone } from "../../src/lib/dates";
import { formatPrice } from "../../src/lib/schedule/constants";
import { randomNumber } from "./fakes";
import { PASSWORD, bookService, signUpBusiness, uniqueEmail } from "./helpers";

const TIME_ZONE = "America/New_York";
test.use({ timezoneId: TIME_ZONE });
const today = () => todayInTimeZone(TIME_ZONE);

const status = (page: Page) => page.locator(".pagehead [data-invoice-status]");
const dashboardCard = (page: Page, name: string) => page.locator(`[data-card="${name}"]`);

async function addCustomer(page: Page, c: { firstName: string; lastName: string; phone?: string; optIn?: boolean }) {
  await page.goto("/customers/new");
  await page.getByLabel("First name").fill(c.firstName);
  await page.getByLabel("Last name").fill(c.lastName);
  if (c.phone) await page.getByLabel("Phone").fill(c.phone);
  if (c.optIn) await page.getByLabel("Customer has opted in to SMS").check();
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText("Customer added.")).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2];
}

async function bookVisit(page: Page, customerId: string, price: string, service = "Mowing") {
  await bookService(page, { customerId, service, price, frequency: "One time", startDate: today() });
}

async function completeVisit(page: Page, customerName: string) {
  await page.goto("/dashboard");
  await page.locator(".job-table tbody tr", { hasText: customerName }).first().locator(".row-link").click();
  await page.getByRole("button", { name: "Mark completed" }).click();
  await expect(page.getByText("Marked completed.")).toBeVisible();
}

// Creates a draft invoice for a customer with the given custom lines (and visits, by
// service name). Returns the invoice page URL.
async function createInvoice(page: Page, customerId: string, opts: { visits?: string[]; lines?: [string, string, string][] } = {}) {
  await page.goto(`/invoices/new?customer=${customerId}`);
  for (const service of opts.visits ?? []) await page.getByRole("checkbox", { name: new RegExp(service) }).check();
  let index = (opts.visits ?? []).length;
  for (const [description, quantity, price] of opts.lines ?? []) {
    await page.getByRole("button", { name: "+ Add line" }).click();
    index += 1;
    await page.getByLabel(`Line ${index} description`).fill(description);
    await page.getByLabel(`Line ${index} quantity`).fill(quantity);
    await page.getByLabel(`Line ${index} price`).fill(price);
  }
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Invoice saved as a draft.")).toBeVisible();
  return page.url().split("?")[0];
}

async function markSent(page: Page) {
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(status(page)).toHaveText("Sent");
}

async function recordPayment(page: Page, amount: string, method: "Cash" | "Check" | "Venmo" | "Zelle" | "Other", note = "") {
  await page.getByLabel("Amount ($)").fill(amount);
  await page.getByLabel("How it was paid").selectOption({ label: method });
  if (note) await page.getByLabel("Note").fill(note);
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
}

async function setPaymentOptions(page: Page, options: Partial<Record<"Venmo username" | "Cash App $cashtag" | "PayPal.Me name" | "Zelle email or phone" | "Other payment link" | "Note for customers", string>>) {
  await page.goto("/invoices/payment-options");
  for (const [label, value] of Object.entries(options)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Save payment options" }).click();
  await expect(page.getByText("Payment options saved.")).toBeVisible();
}

async function customerPage(browser: Browser) {
  return (await browser.newContext({ timezoneId: TIME_ZONE })).newPage();
}

test("an owner builds an invoice from a visit and extra items, sends it, and records payments", async ({ page, context }) => {
  await signUpBusiness(page, "Invoice Lawns");
  const phone = randomNumber();
  const jane = await addCustomer(page, { firstName: "Jane", lastName: "Adams", phone, optIn: true });
  await bookVisit(page, jane, "65");
  await completeVisit(page, "Jane Adams");

  await page.goto("/invoices/new");
  await page.getByLabel("Customer").selectOption({ label: "Jane Adams" });
  await page.getByRole("button", { name: "Continue" }).click();
  const visit = page.getByRole("checkbox", { name: new RegExp(`${formatShortDate(today())} · Mowing · \\$65\\.00 · completed`) });
  await visit.check();
  await expect(page.getByLabel("Line 1 description")).toHaveValue(`Mowing (${formatShortDate(today())})`);
  await page.getByRole("button", { name: "+ Add line" }).click();
  await page.getByLabel("Line 2 quantity").fill("2");
  await page.getByLabel("Line 2 price").fill("30");
  await expect(page.getByTestId("invoice-total")).toHaveText("$125.00");

  // A line needs a description.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.locator(".field-error")).toHaveText("Line 2: Describe each line");
  await page.getByLabel("Line 2 description").fill("Mulch (bags)");
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByText("Invoice saved as a draft.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invoice #1001" })).toBeVisible();
  await expect(status(page)).toHaveText("Draft");
  await expect(page.getByTestId("total")).toHaveText("$125.00");

  // Send it: the owner copies the pay link (Jane can also be texted: she opted in).
  await expect(page.getByRole("link", { name: "Text invoice to Jane Adams" })).toHaveAttribute("href", new RegExp(`^sms:\\${phone}\\?&body=`));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(status(page)).toHaveText("Sent");
  const payUrl = await page.getByLabel("Pay link").inputValue();
  expect(payUrl).toMatch(/\/pay\/[0-9a-f]{64}$/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(payUrl);

  await recordPayment(page, "50", "Check", "Check #1042");
  await expect(status(page)).toHaveText("Partly paid");
  await expect(page.getByTestId("balance")).toHaveText("$75.00");
  await expect(page.locator(".payment-row")).toContainText("$50.00 · Check");

  // Can't record more than what's owed.
  await page.getByLabel("Amount ($)").fill("100");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "more than the balance due" })).toBeVisible();

  await recordPayment(page, "75", "Cash");
  await expect(status(page)).toHaveText("Paid");
  await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);

  await page.goto("/invoices?status=paid");
  await expect(page.locator(".invoice-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".invoice-table tbody tr")).toContainText("Jane Adams");
});

test("an owner adds their payment apps, and the customer's pay link offers them for what's owed", async ({ page, browser }) => {
  await signUpBusiness(page, "Pay Lawns");
  await page.goto("/invoices");
  await expect(page.getByTestId("payment-options-status")).toContainText("Add the payment apps you already use");
  await page.getByRole("link", { name: "Set up payment options" }).click();

  // Mistakes are caught before saving.
  await page.getByLabel("Venmo username").fill("ab");
  await page.getByLabel("Other payment link").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Save payment options" }).click();
  await expect(page.locator("#venmo-error")).toContainText("Enter your Venmo username");
  await expect(page.locator("#pay_link-error")).toHaveText("Enter a full link starting with https://");

  await setPaymentOptions(page, {
    "Venmo username": "@Green-Acres",
    "Cash App $cashtag": "$GreenAcres",
    "Other payment link": "https://square.link/u/AbC123",
    "Zelle email or phone": "(631) 555-0100",
    "Note for customers": "Checks payable to Pay Lawns LLC.",
  });
  await expect(page.getByTestId("payment-options-status")).toContainText("Customers can pay you with Venmo, Cash App, Zelle and your payment link");

  const customer = await addCustomer(page, { firstName: "Pat", lastName: "Payer" });
  await createInvoice(page, customer, { lines: [["Mowing", "1", "65"]] });
  await expect(page.getByText("how to pay you (Venmo, Cash App, Zelle and your payment link)")).toBeVisible();
  await markSent(page);
  const invoicePage = page.url();

  const pat = await customerPage(browser);
  await pat.goto(await page.getByLabel("Pay link").inputValue());
  await expect(pat.getByRole("heading", { name: "Pay $65.00" })).toBeVisible();
  const venmo = pat.getByRole("link", { name: /Pay with Venmo/ });
  await expect(venmo).toHaveAttribute("href", "https://venmo.com/Green-Acres?txn=pay&amount=65.00&note=Invoice+%231001");
  await expect(venmo).toHaveAttribute("target", "_blank");
  await expect(venmo).toHaveAttribute("rel", "noopener noreferrer");
  await expect(pat.getByRole("link", { name: /Pay with Cash App/ })).toHaveAttribute("href", "https://cash.app/$GreenAcres/65.00");
  await expect(pat.getByRole("link", { name: /Pay with PayPal/ })).toHaveCount(0);
  await expect(pat.getByTestId("zelle-to")).toHaveText("(631) 555-0100");
  const other = pat.getByRole("link", { name: /Pay online/ });
  await expect(other).toHaveAttribute("href", "https://square.link/u/AbC123");
  await expect(other).toContainText("square.link");
  await expect(pat.getByText("Checks payable to Pay Lawns LLC.")).toBeVisible();
  await expect(pat.getByText("Please include “Invoice #1001” with your payment.")).toBeVisible();

  // Pat pays part by Venmo; the owner records it when it arrives, and the link asks for the rest.
  await recordPayment(page, "25", "Venmo", "From Pat");
  await expect(page.locator(".payment-row")).toContainText("$25.00 · Venmo");
  await pat.reload();
  await expect(pat.getByRole("heading", { name: "Pay $40.00" })).toBeVisible();
  await expect(pat.getByRole("link", { name: /Pay with Venmo/ })).toHaveAttribute("href", /amount=40\.00/);
  await expect(pat.getByRole("link", { name: /Pay with Cash App/ })).toHaveAttribute("href", "https://cash.app/$GreenAcres/40.00");

  await page.goto(invoicePage);
  await recordPayment(page, "40", "Zelle");
  await expect(status(page)).toHaveText("Paid");
  await pat.reload();
  await expect(pat.getByText("Paid in full. Thank you!")).toBeVisible();
  await expect(pat.getByRole("link", { name: /Pay with/ })).toHaveCount(0);

  // The settings page shows what's saved, the way it was typed; clearing it takes the apps away.
  await page.goto("/invoices/payment-options");
  await expect(page.getByLabel("Venmo username")).toHaveValue("@Green-Acres");
  await expect(page.getByLabel("Cash App $cashtag")).toHaveValue("$GreenAcres");
  await expect(page.getByLabel("Zelle email or phone")).toHaveValue("(631) 555-0100");
  await setPaymentOptions(page, {
    "Venmo username": "",
    "Cash App $cashtag": "",
    "Other payment link": "",
    "Zelle email or phone": "",
    "Note for customers": "",
  });
  await expect(page.getByTestId("payment-options-status")).toContainText("Add the payment apps you already use");
});

test("one business's payment apps never appear on another business's invoices", async ({ page, browser }) => {
  await signUpBusiness(page, "Venmo Lawns");
  await setPaymentOptions(page, { "Venmo username": "@Venmo-Lawns", "Zelle email or phone": "pay@venmolawns.test" });

  const other = await (await browser.newContext({ timezoneId: TIME_ZONE })).newPage();
  await signUpBusiness(other, "Plain Lawns");
  // Its own settings page starts empty, not with the first business's apps.
  await other.goto("/invoices/payment-options");
  await expect(other.getByLabel("Venmo username")).toHaveValue("");
  await expect(other.getByLabel("Zelle email or phone")).toHaveValue("");
  const customer = await addCustomer(other, { firstName: "Cy", lastName: "Customer" });
  await createInvoice(other, customer, { lines: [["Mowing", "1", "65"]] });
  await markSent(other);

  const cy = await customerPage(browser);
  await cy.goto(await other.getByLabel("Pay link").inputValue());
  await expect(cy.getByText("To pay this invoice, please contact Plain Lawns.")).toBeVisible();
  await expect(cy.getByRole("link", { name: /Pay with/ })).toHaveCount(0);
  await expect(cy.locator("main")).not.toContainText("Venmo-Lawns");
  await expect(cy.locator("main")).not.toContainText("venmolawns");
});

test("with auto-invoicing on, completing a visit creates a draft invoice for it", async ({ page }) => {
  await signUpBusiness(page, "Auto Lawns");
  await page.goto("/invoices");
  await page.getByLabel("Auto-create a draft invoice when a visit is marked completed").check();
  await page.reload();
  await expect(page.getByLabel("Auto-create a draft invoice when a visit is marked completed")).toBeChecked();

  const customer = await addCustomer(page, { firstName: "Ada", lastName: "Auto" });
  await bookVisit(page, customer, "85", "Hedge trimming");
  await completeVisit(page, "Ada Auto");
  await page.getByRole("link", { name: "#1001 (draft)" }).click();
  await expect(status(page)).toHaveText("Draft");
  await expect(page.locator(".invoice-lines")).toContainText(`Hedge trimming (${formatShortDate(today())})`);
  await expect(page.getByTestId("total")).toHaveText("$85.00");
});

test("the dashboard counts an invoiced visit once, and shows what's owed and collected", async ({ page }) => {
  await signUpBusiness(page, "Counting Lawns");
  const customer = await addCustomer(page, { firstName: "Cy", lastName: "Count" });
  await bookVisit(page, customer, "100");
  await completeVisit(page, "Cy Count");

  await page.goto("/dashboard");
  await expect(dashboardCard(page, "revenue").locator(".big")).toHaveText("$100.00");

  // Billed at $80 (a discount), plus $15 of materials.
  await page.goto(`/invoices/new?customer=${customer}`);
  await page.getByRole("checkbox", { name: /Mowing · \$100\.00/ }).check();
  await page.getByLabel("Line 1 price").fill("80");
  await page.getByRole("button", { name: "+ Add line" }).click();
  await page.getByLabel("Line 2 description").fill("Materials");
  await page.getByLabel("Line 2 price").fill("15");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Invoice saved as a draft.")).toBeVisible();
  const invoiceUrl = page.url().split("?")[0];

  // A draft changes nothing yet.
  await page.goto("/dashboard");
  await expect(dashboardCard(page, "revenue").locator(".big")).toHaveText("$100.00");
  await expect(dashboardCard(page, "outstanding").locator(".big")).toHaveText("$0.00");

  await page.goto(invoiceUrl);
  await markSent(page);
  await recordPayment(page, "30", "Cash");

  await page.goto("/dashboard");
  // $80 for the visit (not $100 + $80), plus $15 of materials.
  await expect(dashboardCard(page, "revenue").locator(".big")).toHaveText("$95.00");
  await expect(dashboardCard(page, "revenue")).toContainText(`${formatPrice(30)} collected this month`);
  await expect(dashboardCard(page, "outstanding").locator(".big")).toHaveText("$65.00");
  await expect(dashboardCard(page, "profit").locator(".big")).toHaveText("$95.00");
});

test("crew members can't see invoices, and another business can't open them", async ({ page, browser }) => {
  await signUpBusiness(page, "Private Lawns");
  const customer = await addCustomer(page, { firstName: "Secret", lastName: "Client" });
  const invoiceUrl = await createInvoice(page, customer, { lines: [["Big job", "1", "999"]] });
  const invoicePath = new URL(invoiceUrl).pathname;

  // A crew member of the same business.
  await page.goto("/crew");
  await page.getByLabel("Name", { exact: true }).fill("Maria");
  await page.getByRole("button", { name: "Add and get invite link" }).click();
  const invite = await page.getByLabel("Invite link for Maria").inputValue();
  const maria = await (await browser.newContext({ timezoneId: TIME_ZONE })).newPage();
  await maria.goto(invite);
  await maria.getByLabel("Email").fill(uniqueEmail("crew"));
  await maria.getByLabel("Choose a password").fill(PASSWORD);
  await maria.getByRole("button", { name: "Create login and join" }).click();
  await expect(maria).toHaveURL(/\/my-jobs$/);
  await expect(maria.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Invoices" })).toHaveCount(0);
  for (const path of ["/invoices", invoicePath, "/invoices/new", "/invoices/payment-options"]) {
    await maria.goto(path);
    await expect(maria).toHaveURL(/\/my-jobs$/);
  }
  await maria.goto("/dashboard");
  await expect(maria.locator('[data-card="outstanding"]')).toHaveCount(0);
  await expect(maria.locator("main")).not.toContainText("$");

  // Another business's owner.
  const other = await (await browser.newContext({ timezoneId: TIME_ZONE })).newPage();
  await signUpBusiness(other, "Nosy Lawns");
  await other.goto(invoicePath);
  await expect(other.getByText("Invoice not found")).toBeVisible();
  await expect(other.getByText("Secret Client")).toHaveCount(0);
  await other.goto("/invoices");
  await expect(other.getByText("No invoices yet")).toBeVisible();
});

test("a pay link works only once the invoice is sent, and stops when it's cancelled", async ({ page, browser }) => {
  await signUpBusiness(page, "Link Lawns");
  const customer = await addCustomer(page, { firstName: "Lee", lastName: "Link" });
  await createInvoice(page, customer, { lines: [["Mowing", "1", "65"]] });
  const payUrl = await page.getByLabel("Pay link").inputValue();

  const lee = await customerPage(browser);
  await lee.goto(payUrl);
  await expect(lee.getByText("Invoice not available")).toBeVisible();

  await markSent(page);
  await lee.reload();
  await expect(lee.getByRole("heading", { name: "Invoice #1001" })).toBeVisible();
  // No payment apps set up yet, so there's nothing to pay with.
  await expect(lee.getByText("To pay this invoice, please contact Link Lawns.")).toBeVisible();

  await page.getByRole("button", { name: "Cancel invoice" }).click();
  await page.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(page.getByText("Invoice cancelled.")).toBeVisible();
  await lee.reload();
  await expect(lee.getByText("Invoice not available")).toBeVisible();
});
