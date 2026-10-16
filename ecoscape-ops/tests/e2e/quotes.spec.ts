import { expect, test, type Page } from "@playwright/test";

import { signUpBusiness } from "./helpers";

// Quotes: price a prospect, send, accept into the schedule; crew never see quotes.

async function fillLine(page: Page, index: number, description: string, quantity: string, price: string) {
  await page.getByLabel(`Line ${index} description`).fill(description);
  await page.getByLabel(`Line ${index} quantity`).fill(quantity);
  await page.getByLabel(`Line ${index} price`).fill(price);
}

test("a prospect's quote is copied, accepted, and booked on the schedule", async ({ page }) => {
  await signUpBusiness(page, "Quote Lawn Co");
  await page.goto("/quotes/new");
  await page.getByLabel("Name", { exact: true }).fill("Pat Prospect");
  await page.getByLabel("Phone").fill("631-555-0188");
  await page.getByLabel("What's the job?").fill("Spring cleanup");
  await fillLine(page, 1, "Cleanup", "1", "250");
  await page.getByRole("button", { name: "+ Add line" }).click();
  await fillLine(page, 2, "Mulch", "3", "40.50");
  await expect(page.getByTestId("quote-total")).toHaveText("$371.50");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Quote saved as a draft.")).toBeVisible();
  await expect(page.locator(".pagehead [data-quote-status]")).toHaveText("Draft");
  await expect(page.getByTestId("total")).toHaveText("$371.50");

  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.locator(".pagehead [data-quote-status]")).toHaveText("Sent");
  await expect(page.locator("#quote-text")).toHaveValue(/Total: \$371\.50/);

  await page.getByLabel("How often").selectOption("Every week");
  await page.getByRole("button", { name: "Accept & book it" }).click();
  await expect(page.getByText("Accepted and booked.")).toBeVisible();
  await expect(page.locator(".pagehead [data-quote-status]")).toHaveText("Accepted");

  await page.goto("/customers");
  await expect(page.getByText("Pat Prospect")).toBeVisible();
  await page.goto("/schedule?filter=all");
  await expect(page.getByText("Spring cleanup").first()).toBeVisible();
});

test("another business doesn't see the quote", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await signUpBusiness(a, "Quote Alpha");
  await a.goto("/quotes/new");
  await a.getByLabel("Name", { exact: true }).fill("Private Prospect");
  await fillLine(a, 1, "Job", "1", "100");
  await a.getByRole("button", { name: "Save draft" }).click();
  const url = a.url().split("?")[0];

  const b = await (await browser.newContext()).newPage();
  await signUpBusiness(b, "Quote Bravo");
  await b.goto(url);
  await expect(b.getByText("Quote not found")).toBeVisible();
  await b.goto("/quotes");
  await expect(b.getByText("Private Prospect")).toHaveCount(0);
});
