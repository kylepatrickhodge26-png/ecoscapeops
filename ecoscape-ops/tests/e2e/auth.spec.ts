import { expect, test } from "@playwright/test";

import { PASSWORD, signUpBusiness, uniqueEmail } from "./helpers";

test("a new business signs up and lands on its empty customer list", async ({ page }) => {
  await signUpBusiness(page, "Green Acres Landscaping");
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  await expect(page.getByText("No customers yet")).toBeVisible();
});

test("signed-out visitors are sent to sign in, then returned to where they were going", async ({ page }) => {
  const { email } = await signUpBusiness(page, "Return Trip Lawns");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/customers/new");
  await expect(page).toHaveURL(/\/login\?next=%2Fcustomers%2Fnew$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Incorrect email or password." })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue(email);

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/customers\/new$/);
  await expect(page.getByTestId("business-name")).toHaveText("Return Trip Lawns");
});

test("signed-in users skip the sign-in and signup pages", async ({ page }) => {
  await signUpBusiness(page, "Already In Co");
  await page.goto("/login");
  await expect(page).toHaveURL(/\/customers$/);
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/customers$/);
});

test("signing up with an email that's already registered shows an error", async ({ page, browser }) => {
  const { email } = await signUpBusiness(page, "First Business");

  const other = await browser.newPage();
  await other.goto("/signup");
  await other.getByLabel("Your name").fill("Second Owner");
  await other.getByLabel("Business name").fill("Second Business");
  await other.getByLabel("Email").fill(email);
  await other.getByLabel("Password").fill(PASSWORD);
  await other.getByRole("button", { name: "Create account" }).click();
  await expect(other.getByRole("alert").filter({ hasText: "An account with this email already exists" })).toBeVisible();
  await expect(other.getByLabel("Business name")).toHaveValue("Second Business");
  await other.close();
});

test("signup rejects a short password", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Short Pass");
  await page.getByLabel("Business name").fill("Short Pass Co");
  await page.getByLabel("Email").fill(uniqueEmail("short"));
  await page.getByLabel("Password").fill("abc");
  // Skip the browser's own minlength check to exercise the server-side one.
  await page.locator("form").evaluate((form) => form.setAttribute("novalidate", ""));
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Password must be at least 8 characters" })).toBeVisible();
});
