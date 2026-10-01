import { expect, test, type Browser, type Page } from "@playwright/test";
import Stripe from "stripe";

import { formatShortDate, todayInTimeZone } from "../../src/lib/dates";
import { formatPrice } from "../../src/lib/schedule/constants";
import { FAKE_ENV, randomNumber, resendStripeEvent, settleBankPayment, stripeEvents } from "./fakes";
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

async function recordPayment(page: Page, amount: string, method: "Cash" | "Check" | "Other", note = "") {
  await page.getByLabel("Amount ($)").fill(amount);
  await page.getByLabel("How it was paid").selectOption({ label: method });
  if (note) await page.getByLabel("Note").fill(note);
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
}

async function connectStripe(page: Page, finish: "Finish setup" | "Finish setup (card only)" = "Finish setup") {
  await page.goto("/invoices");
  await page.getByRole("button", { name: "Connect Stripe" }).click();
  // Stripe's own onboarding page (the test stand-in).
  await expect(page.getByRole("heading", { name: "Stripe onboarding (test)" })).toBeVisible();
  await page.getByRole("button", { name: finish, exact: true }).click();
  await expect(page).toHaveURL(/\/invoices\?notice=stripe$/);
  await expect(page.getByTestId("stripe-status")).toContainText("Online payments are on.");
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

test("a customer pays online through Stripe, and the payment is recorded exactly once", async ({ page, browser }) => {
  await signUpBusiness(page, "Stripe Lawns");
  await connectStripe(page);
  const customer = await addCustomer(page, { firstName: "Pat", lastName: "Payer" });
  const invoiceUrl = await createInvoice(page, customer, { lines: [["Spring cleanup", "1", "180"]] });
  await markSent(page);
  const payUrl = await page.getByLabel("Pay link").inputValue();

  // The customer, not signed in, opens their pay link.
  const pat = await customerPage(browser);
  await pat.goto(payUrl);
  await expect(pat.getByText("Stripe Lawns", { exact: true })).toBeVisible();
  await expect(pat.getByRole("heading", { name: "Invoice #1001" })).toBeVisible();
  await expect(pat.getByText("Spring cleanup")).toBeVisible();
  // No card fields on our page: the card is entered on Stripe's.
  await expect(pat.locator("input")).toHaveCount(0);
  await pat.getByRole("button", { name: "Pay $180.00" }).click();

  // Stripe's hosted Checkout (the test stand-in), charged to the business's own account.
  await expect(pat).toHaveURL(/127\.0\.0\.1:4010\/checkout\/cs_test_/);
  const sessionId = new URL(pat.url()).pathname.split("/").at(-1)!;
  await expect(pat.getByTestId("checkout-amount")).toHaveText("USD 180.00");
  await pat.getByRole("button", { name: "Pay with card" }).click();
  await expect(pat).toHaveURL(/\/pay\/[0-9a-f]{64}\?paid=1$/);
  await expect(async () => {
    await pat.reload();
    await expect(pat.getByText("Paid in full. Thank you!")).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await expect(pat.getByRole("button", { name: /^Pay/ })).toHaveCount(0);

  await page.goto(invoiceUrl);
  await expect(status(page)).toHaveText("Paid");
  await expect(page.locator(".payment-row")).toHaveCount(1);
  await expect(page.locator(".payment-row")).toContainText("$180.00 · Paid online (Stripe)");

  // Stripe delivering the same event again changes nothing.
  const completed = (await stripeEvents()).find((e) => e.event.type === "checkout.session.completed" && e.event.data.object.id === sessionId)!;
  expect(completed.status).toBe(200);
  expect((await resendStripeEvent(completed.event.id)).status).toBe(200);
  expect((await resendStripeEvent(completed.event.id)).status).toBe(200);
  await page.reload();
  await expect(page.locator(".payment-row")).toHaveCount(1);
  await expect(page.getByTestId("paid")).toHaveText("$180.00");
});

test("a bank payment shows as on its way, then paid when it clears", async ({ page, browser }) => {
  await signUpBusiness(page, "Bank Lawns");
  await connectStripe(page);
  const customer = await addCustomer(page, { firstName: "Bea", lastName: "Banks" });
  const invoiceUrl = await createInvoice(page, customer, { lines: [["Patio install", "1", "2400"]] });
  await markSent(page);
  const payUrl = await page.getByLabel("Pay link").inputValue();

  const bea = await customerPage(browser);
  await bea.goto(payUrl);
  await bea.getByRole("button", { name: "Pay $2,400.00" }).click();
  await expect(bea).toHaveURL(/\/checkout\/cs_test_/);
  const sessionId = new URL(bea.url()).pathname.split("/").at(-1)!;
  await bea.getByRole("button", { name: "Pay by bank" }).click();
  await expect(async () => {
    await bea.reload();
    await expect(bea.getByText("Your bank payment is on its way.")).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });

  await page.goto(invoiceUrl);
  await expect(page.getByText("A bank payment of $2,400.00 is on its way")).toBeVisible();
  await expect(status(page)).toHaveText("Sent");

  expect((await settleBankPayment(sessionId)).status).toBe(200);
  await page.reload();
  await expect(status(page)).toHaveText("Paid");
  await expect(page.locator(".payment-row")).toContainText("$2,400.00 · Bank transfer (Stripe)");
});

test("a business without bank payments turned on offers card only", async ({ page, browser }) => {
  await signUpBusiness(page, "Card Only Lawns");
  await connectStripe(page, "Finish setup (card only)");
  const customer = await addCustomer(page, { firstName: "Cal", lastName: "Card" });
  await createInvoice(page, customer, { lines: [["Mowing", "1", "65"]] });
  await markSent(page);
  const cal = await customerPage(browser);
  await cal.goto(await page.getByLabel("Pay link").inputValue());
  await cal.getByRole("button", { name: "Pay $65.00" }).click();
  await expect(cal.getByRole("button", { name: "Pay with card" })).toBeVisible();
  await expect(cal.getByRole("button", { name: "Pay by bank" })).toHaveCount(0);
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
  for (const path of ["/invoices", invoicePath, "/invoices/new"]) {
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
  // Stripe isn't connected, so there's no Pay button.
  await expect(lee.getByText("To pay this invoice, please contact Link Lawns.")).toBeVisible();

  await page.getByRole("button", { name: "Cancel invoice" }).click();
  await page.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(page.getByText("Invoice cancelled.")).toBeVisible();
  await lee.reload();
  await expect(lee.getByText("Invoice not available")).toBeVisible();
});

test("the Stripe webhook rejects forged events and ignores payments it didn't start", async ({ page, browser, request }) => {
  await signUpBusiness(page, "Webhook Lawns");
  await connectStripe(page);
  const customer = await addCustomer(page, { firstName: "Wes", lastName: "Hook" });
  const invoiceUrl = await createInvoice(page, customer, { lines: [["Mowing", "1", "65"]] });
  await markSent(page);

  // Start a real checkout (so the session exists), but don't pay.
  const wes = await customerPage(browser);
  await wes.goto(await page.getByLabel("Pay link").inputValue());
  await wes.getByRole("button", { name: "Pay $65.00" }).click();
  await expect(wes).toHaveURL(/\/checkout\/cs_test_/);
  const sessionId = new URL(wes.url()).pathname.split("/").at(-1)!;
  const account = (await stripeEvents()).find((e) => e.event.type === "account.updated" && e.status === 200 && e.event.account)!.event.account;

  const event = (sessionIdToUse: string, accountToUse: string) =>
    JSON.stringify({
      id: `evt_forged_${Date.now()}`,
      object: "event",
      type: "checkout.session.completed",
      account: accountToUse,
      data: { object: { id: sessionIdToUse, object: "checkout.session", payment_status: "paid", amount_total: 6500 } },
    });
  const post = (payload: string, signature: string) =>
    request.post("/api/stripe/webhook", { data: payload, headers: { "Content-Type": "application/json", "Stripe-Signature": signature } });
  const signer = new Stripe("sk_test_signer").webhooks;

  // Not signed with the webhook secret: refused.
  const forged = event(sessionId, account);
  expect((await post(forged, signer.generateTestHeaderString({ payload: forged, secret: "whsec_wrong" }))).status()).toBe(400);
  expect((await post(forged, "")).status()).toBe(400);

  // Properly signed, but for a checkout this app never started: accepted and ignored.
  const unknown = event("cs_test_neverstarted", account);
  const response = await post(unknown, signer.generateTestHeaderString({ payload: unknown, secret: FAKE_ENV.STRIPE_WEBHOOK_SECRET }));
  expect(response.status()).toBe(200);
  expect((await response.json()).result).toBe("unknown_checkout");

  await page.goto(invoiceUrl);
  await expect(status(page)).toHaveText("Sent");
  await expect(page.locator(".payment-row")).toHaveCount(0);
});
