import { randomUUID } from "node:crypto";

import { expect, type Locator, type Page } from "@playwright/test";

export const PASSWORD = "correct-horse-battery";
export const uniqueEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.test`;

export async function signUpBusiness(page: Page, businessName: string, email = uniqueEmail("owner"), ownerName = "Kyle") {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(ownerName);
  await page.getByLabel("Business name").fill(businessName);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("business-name")).toHaveText(businessName);
  return { email };
}

export type NewCustomer = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  propertyAddress?: string;
  preferredDay?: string;
};

// Adds a customer without booking anything ("Not yet").
export async function addCustomer(page: Page, c: NewCustomer) {
  await page.goto("/customers/new");
  if (c.firstName) await page.getByLabel("First name").fill(c.firstName);
  if (c.lastName) await page.getByLabel("Last name").fill(c.lastName);
  if (c.phone) await page.getByLabel("Phone").fill(c.phone);
  if (c.email) await page.getByLabel("Email").fill(c.email);
  if (c.propertyAddress) await page.getByLabel("Property address").fill(c.propertyAddress);
  await page.getByLabel("Not yet").check();
  if (c.preferredDay) {
    await openMoreDetails(page);
    await page.getByLabel("Preferred day").selectOption(c.preferredDay);
  }
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page.getByText("Customer added.")).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2];
}

// Add customer folds its less-used fields under "More details".
export async function openMoreDetails(page: Page) {
  const details = page.locator("details.more-details");
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) await details.locator("summary").click();
}

// A screen's less-used actions sit behind its "More" button.
export async function openMore(scope: Page | Locator) {
  await scope.getByRole("button", { name: "More", exact: true }).click();
}

export type Frequency = "Every week" | "Every 2 weeks" | "Every 3 weeks" | "One time";

// Booking: a repeat service (and how often) or a one-time job.
export async function chooseFrequency(page: Page, frequency: Frequency) {
  if (frequency === "One time") {
    await page.getByLabel("One-time job").check();
  } else {
    await page.getByLabel("Repeat service").check();
    await page.getByLabel("How often").selectOption(frequency);
  }
}

export type NewBooking = {
  customerId?: string;
  service?: string;
  price?: string;
  frequency?: Frequency;
  startDate?: string;
};

// Books a service through the booking form and waits for the confirmation.
export async function bookService(page: Page, b: NewBooking = {}) {
  await page.goto(b.customerId ? `/schedule/new?customer=${b.customerId}` : "/schedule/new");
  await page.getByLabel("Service", { exact: true }).fill(b.service ?? "Mowing");
  await page.getByLabel("Price ($)").fill(b.price ?? "65");
  await chooseFrequency(page, b.frequency ?? "Every week");
  if (b.startDate) await page.getByLabel(/First visit|Visit date/).fill(b.startDate);
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page.getByText(/booked for/)).toBeVisible();
}

// The dates shown in the schedule list, top to bottom. Use with auto-waiting
// assertions (toHaveText / toHaveCount) so they wait for navigation to finish.
export function listedDates(page: Page) {
  return page.locator(".job-table tbody .date-cell .nowrap");
}
