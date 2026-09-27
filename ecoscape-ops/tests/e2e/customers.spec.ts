import { expect, test } from "@playwright/test";

import { addCustomer, signUpBusiness } from "./helpers";

test("an owner can add, view, edit, and delete a customer", async ({ page }) => {
  await signUpBusiness(page, "Full Cycle Landscaping");

  // Add, filling in every field from the prototype's form.
  await page.getByRole("link", { name: "+ Add customer" }).click();
  await page.getByLabel("First name").fill("John");
  await page.getByLabel("Last name").fill("Smith");
  await page.getByLabel("Phone").fill("(631) 555-0142");
  await page.getByLabel("Email").fill("jsmith@example.com");
  await page.getByLabel("Property address").fill("123 Example Street, Lake Ronkonkoma, NY");
  await page.getByLabel("Billing address").fill("PO Box 12, Ronkonkoma, NY");
  await page.getByLabel("Gate / access instructions").fill("Side gate, code 4471");
  await page.getByLabel("Service notes").fill("Dog in backyard on weekends — call ahead.");
  await page.getByLabel("Preferred day").selectOption("Tuesday");
  await page.getByLabel("Notification preference").selectOption("Email");
  await page.getByLabel("Customer since").fill("2026-04-01");
  await page.getByLabel("Customer has opted in to SMS").check();
  await page.getByRole("button", { name: "Add customer" }).click();

  // Detail page shows everything that was entered.
  await expect(page.getByText("Customer added.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "John Smith" })).toBeVisible();
  await expect(page.getByText("Access: Side gate, code 4471")).toBeVisible();
  await expect(page.getByText("Notes: Dog in backyard on weekends — call ahead.")).toBeVisible();
  const detail = (label: string) =>
    page.locator("dl.details > div").filter({ has: page.locator("dt").getByText(label, { exact: true }) }).locator("dd");
  await expect(detail("Status")).toHaveText("active");
  await expect(detail("Preferred day")).toHaveText("Tuesday");
  await expect(detail("Phone")).toHaveText("(631) 555-0142");
  await expect(detail("Email")).toHaveText("jsmith@example.com");
  await expect(detail("Property address")).toHaveText("123 Example Street, Lake Ronkonkoma, NY");
  await expect(detail("Billing address")).toHaveText("PO Box 12, Ronkonkoma, NY");
  await expect(detail("Notification preference")).toHaveText("Email");
  await expect(detail("SMS opt-in")).toHaveText("Yes");
  await expect(detail("Customer since")).toHaveText("Apr 1, 2026");

  // It's in the list.
  await page.getByRole("link", { name: "← Customers" }).click();
  const row = page.getByRole("row", { name: /John Smith/ });
  await expect(row).toContainText("123 Example Street");
  await expect(row).toContainText("Tuesday");
  await expect(page.getByText("1 customer", { exact: true })).toBeVisible();

  // Edit: the form is pre-filled with the saved values.
  await row.getByRole("link", { name: "John Smith" }).click();
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByLabel("First name")).toHaveValue("John");
  await expect(page.getByLabel("Preferred day")).toHaveValue("tuesday");
  await expect(page.getByLabel("Customer has opted in to SMS")).toBeChecked();
  await page.getByLabel("Last name").fill("Smithson");
  await page.getByLabel("Status").selectOption("Inactive");
  await page.getByLabel("Customer has opted in to SMS").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "John Smithson" })).toBeVisible();
  await expect(detail("Status")).toHaveText("inactive");
  await expect(detail("SMS opt-in")).toHaveText("No");

  // Delete, with a confirmation step that can be cancelled.
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Delete John Smithson? This can't be undone.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page).toHaveURL(/\/customers\?notice=deleted$/);
  await expect(page.getByText("Customer deleted.")).toBeVisible();
  await expect(page.getByText("No customers yet")).toBeVisible();
});

test("the form explains what's wrong and keeps what was typed", async ({ page }) => {
  await signUpBusiness(page, "Picky Forms Inc");
  await page.goto("/customers/new");

  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText("Enter at least a name, phone number, or email")).toBeVisible();

  await page.getByLabel("First name").fill("Dana");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Service notes").fill("Prefers morning service.");
  await page.getByLabel("Preferred day").selectOption("Saturday");
  await page.getByLabel("Customer has opted in to SMS").check();
  await page.getByRole("button", { name: "Add customer" }).click();

  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("First name")).toHaveValue("Dana");
  await expect(page.getByLabel("Email")).toHaveValue("not-an-email");
  await expect(page.getByLabel("Service notes")).toHaveValue("Prefers morning service.");
  await expect(page.getByLabel("Preferred day")).toHaveValue("saturday");
  await expect(page.getByLabel("Customer has opted in to SMS")).toBeChecked();

  await page.getByLabel("Email").fill("dreyes@example.com");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByRole("heading", { name: "Dana" })).toBeVisible();
});

test("adding a customer whose phone number is already on file asks first", async ({ page }) => {
  await signUpBusiness(page, "Double Check Lawns");
  await addCustomer(page, { firstName: "Mike", lastName: "Jones", phone: "(631) 555-0198" });

  await page.goto("/customers/new");
  await page.getByLabel("First name").fill("Michael");
  await page.getByLabel("Last name").fill("Jones");
  await page.getByLabel("Phone").fill("631.555.0198");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(
    page.getByRole("alert").filter({
      hasText: "Mike Jones already has this phone number on file — could this be the same customer?",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add anyway" }).click();
  await expect(page.getByRole("heading", { name: "Michael Jones" })).toBeVisible();
  await page.goto("/customers");
  await expect(page.getByRole("row", { name: /Jones/ })).toHaveCount(2);
});

test("customers are sorted by last name", async ({ page }) => {
  await signUpBusiness(page, "Alphabetical Gardens");
  await addCustomer(page, { firstName: "Zoe", lastName: "Adams" });
  await addCustomer(page, { firstName: "Adam", lastName: "Young" });
  await addCustomer(page, { firstName: "Mia", lastName: "Lopez" });
  await page.goto("/customers");
  await expect(page.locator("tbody tr td:first-child b")).toHaveText(["Zoe Adams", "Mia Lopez", "Adam Young"]);
});

test("a business never sees another business's customers", async ({ browser }) => {
  const acmeContext = await browser.newContext();
  const acme = await acmeContext.newPage();
  await signUpBusiness(acme, "Acme Lawn Care");
  await addCustomer(acme, { firstName: "Secret", lastName: "Client", propertyAddress: "1 Private Way" });
  const acmeCustomerUrl = new URL(acme.url());
  acmeCustomerUrl.search = "";

  const birchContext = await browser.newContext();
  const birch = await birchContext.newPage();
  await signUpBusiness(birch, "Birch Tree Services");
  await birch.goto("/customers");
  await expect(birch.getByText("No customers yet")).toBeVisible();
  await expect(birch.getByText("Secret Client")).toHaveCount(0);

  // Even with the exact URL, the other business's customer doesn't exist for Birch.
  await birch.goto(acmeCustomerUrl.pathname);
  await expect(birch.getByText("Customer not found")).toBeVisible();
  await expect(birch.getByText("1 Private Way")).toHaveCount(0);
  await birch.goto(`${acmeCustomerUrl.pathname}/edit`);
  await expect(birch.getByText("Customer not found")).toBeVisible();

  // And Acme still has it.
  await acme.goto("/customers");
  await expect(acme.getByRole("row", { name: /Secret Client/ })).toBeVisible();

  await acmeContext.close();
  await birchContext.close();
});

test("an unknown customer id shows not found", async ({ page }) => {
  await signUpBusiness(page, "Lost and Found Lawns");
  await page.goto("/customers/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText("Customer not found")).toBeVisible();
  await page.goto("/customers/not-a-uuid");
  await expect(page.getByText("Customer not found")).toBeVisible();
});

// One of these (UTC+14 / UTC-11) is always on a different calendar day from the machine
// running the app server, so this fails if the default ever comes from the server clock.
const dateIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
const serverToday = new Date().toLocaleDateString("en-CA");
const timezoneId =
  ["Pacific/Kiritimati", "Pacific/Pago_Pago"].find((tz) => dateIn(tz) !== serverToday) ?? "Pacific/Kiritimati";

test.describe(`in a time zone on a different day from the server (${timezoneId})`, () => {
  test.use({ timezoneId });

  test("'Customer since' defaults to today where the owner is", async ({ page }) => {
    await signUpBusiness(page, "Date Line Landscaping");
    await page.goto("/customers/new");
    await expect(page.getByLabel("Customer since")).toHaveValue(dateIn(timezoneId));
  });
});

