import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

export const PASSWORD = "correct-horse-battery";
export const uniqueEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.test`;

export async function signUpBusiness(page: Page, businessName: string, email = uniqueEmail("owner")) {
  await page.goto("/signup");
  await page.getByLabel("Business name").fill(businessName);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await expect(page.getByTestId("business-name")).toHaveText(businessName);
  return { email };
}

export type NewCustomer = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  propertyAddress?: string;
};

export async function addCustomer(page: Page, c: NewCustomer) {
  await page.goto("/customers/new");
  if (c.firstName) await page.getByLabel("First name").fill(c.firstName);
  if (c.lastName) await page.getByLabel("Last name").fill(c.lastName);
  if (c.phone) await page.getByLabel("Phone").fill(c.phone);
  if (c.email) await page.getByLabel("Email").fill(c.email);
  if (c.propertyAddress) await page.getByLabel("Property address").fill(c.propertyAddress);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText("Customer added.")).toBeVisible();
}
