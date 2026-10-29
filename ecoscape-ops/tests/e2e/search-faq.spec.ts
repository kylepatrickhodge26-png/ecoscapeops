import { expect, test, type Browser, type Page } from "@playwright/test";

import { todayInTimeZone } from "../../src/lib/dates";
import { PASSWORD, signUpBusiness, uniqueEmail } from "./helpers";

// Search (owner only), the Help page (owner and crew), and the customer FAQ the owner writes
// and their customers read, with nothing crossing businesses.
const TIME_ZONE = "America/New_York";
test.use({ timezoneId: TIME_ZONE });

async function addCustomer(page: Page, first: string, last: string, phone = "", address = "") {
  await page.goto("/customers/new");
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill(last);
  if (phone) await page.getByLabel("Phone").fill(phone);
  if (address) await page.getByLabel("Property address").fill(address);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText("Customer added.")).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2];
}

async function book(page: Page, customerId: string, service: string) {
  await page.goto(`/schedule/new?customer=${customerId}`);
  await page.getByLabel("Service").fill(service);
  await page.getByLabel("Price ($)").fill("45");
  await page.getByLabel("How often").selectOption("One time");
  await page.getByLabel(/First visit|Visit date/).fill(todayInTimeZone(TIME_ZONE));
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page.getByText(/booked for/)).toBeVisible();
}

async function newContext(browser: Browser) {
  return (await browser.newContext({ timezoneId: TIME_ZONE, ...(test.info().project.use ?? {}) })).newPage();
}

async function joinCrew(page: Page, browser: Browser, name: string) {
  await page.goto("/crew");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add and get invite link" }).click();
  const url = await page.getByLabel(`Invite link for ${name}`).inputValue();
  const crew = await newContext(browser);
  await crew.goto(url);
  await crew.getByLabel("Email").fill(uniqueEmail("crew"));
  await crew.getByLabel("Choose a password").fill(PASSWORD);
  await crew.getByRole("button", { name: "Create login and join" }).click();
  await expect(crew).toHaveURL(/\/my-jobs$/);
  return crew;
}

const searchBox = (page: Page) => page.getByRole("search").getByRole("searchbox", { name: "Search" });

async function search(page: Page, q: string) {
  await searchBox(page).fill(q);
  await searchBox(page).press("Enter");
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.getByTestId("search-summary")).toContainText(q);
}

test("the owner finds customers, visits and help from the search box on any screen", async ({ page }) => {
  await signUpBusiness(page, "Search Lawns");
  const jane = await addCustomer(page, "Jane", "Adams", "631-555-0142", "12 Oak St");
  await addCustomer(page, "Bob", "Lee", "631-555-0199", "40 Elm Ave");
  await book(page, jane, "Hedge trimming");

  // From any page: the box is at the top, without making the page wider than a phone.
  await page.goto("/money");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await search(page, "jane");
  await expect(page.getByTestId("search-customer").getByRole("link")).toHaveText([/Jane Adams/]);
  await expect(page.getByTestId("search-visit")).toContainText("Hedge trimming");
  await expect(page.getByTestId("search-customer")).not.toContainText("Bob Lee");
  // The box keeps what was searched for.
  await expect(searchBox(page)).toHaveValue("jane");

  // By phone number, by street, by service.
  await search(page, "555-0199");
  await expect(page.getByTestId("search-customer").getByRole("link")).toHaveText([/Bob Lee/]);
  await search(page, "oak st");
  await expect(page.getByTestId("search-customer").getByRole("link")).toHaveText([/Jane Adams/]);
  await search(page, "hedge");
  await page.getByTestId("search-visit").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/schedule\/jobs\//);

  // Nothing found says so; help questions come up too.
  await search(page, "zzqx");
  await expect(page.getByText("Nothing found")).toBeVisible();
  await search(page, "invoice");
  await page.getByTestId("search-help").getByRole("link", { name: /How do I send an invoice\?/ }).click();
  await expect(page).toHaveURL(/\/help#invoice$/);
  await expect(page.locator("details#invoice")).toHaveAttribute("open", "");

  // Clicking a customer opens them.
  await search(page, "adams");
  await page.getByTestId("search-customer").getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/customers/${jane}$`));
});

test("another business's search never finds your customers", async ({ page, browser }) => {
  await signUpBusiness(page, "Private Lawns");
  await addCustomer(page, "Quincy", "Zebulon", "631-555-0777", "7 Secret Ln");

  const other = await newContext(browser);
  await signUpBusiness(other, "Nosy Lawns");
  for (const q of ["quincy", "zebulon", "555-0777", "secret ln"]) {
    await search(other, q);
    await expect(other.getByText("Nothing found")).toBeVisible();
    await expect(other.locator("main")).not.toContainText("Quincy");
  }
});

test("crew get Help for their own work, and no search", async ({ page, browser }) => {
  await signUpBusiness(page, "Crew Help Lawns");
  await addCustomer(page, "Jane", "Adams");
  const crew = await joinCrew(page, browser, "Maria");

  await expect(crew.getByRole("search")).toHaveCount(0);
  await crew.goto("/search?q=jane");
  await expect(crew).toHaveURL(/\/my-jobs$/);
  await expect(crew.locator("main")).not.toContainText("Jane Adams");

  await crew.getByRole("link", { name: "Help" }).click();
  await expect(crew).toHaveURL(/\/help$/);
  // Each question in the list (the page may also show popular questions at the top).
  const question = (p: Page, q: string) => p.locator("details > summary", { hasText: q });
  await expect(question(crew, "How do I clock in to a job?")).toBeVisible();
  await expect(question(crew, "Why don't I see prices?")).toBeVisible();
  await expect(crew.locator("main")).not.toContainText("How do I send an invoice?");
  await expect(crew.locator("main")).not.toContainText("Venmo");
  await question(crew, "How do I clock out?").click();
  await expect(crew.locator("details#clock-out")).toContainText("Tap Clock out & finish");

  // The owner's Help has the owner's questions, under More.
  await page.goto("/more");
  await page.getByRole("link", { name: /^Help/ }).first().click();
  await expect(question(page, "How do I send an invoice?")).toBeVisible();
});

test("the owner writes a customer FAQ, and customers see it on the request form and their account", async ({ page, browser }) => {
  await signUpBusiness(page, "FAQ Lawns");
  await page.goto("/settings");
  await page.locator(".panel", { hasText: "Customer FAQ" }).getByRole("link", { name: "Manage" }).click();
  await expect(page).toHaveURL(/\/settings\/faq$/);
  await expect(page.getByText("No questions yet")).toBeVisible();

  // A suggestion fills in the question; the owner writes the answer.
  await page.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByText("Write the question")).toBeVisible();
  await page.getByRole("button", { name: "What happens if it rains?", exact: true }).click();
  await page.getByLabel("Answer").fill("We move your visit to the next dry day and text you.");
  await page.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByText("Question added.")).toBeVisible();
  await page.getByLabel("Question", { exact: true }).fill("How do I pay?");
  await page.getByLabel("Answer").fill("Venmo @faq-lawns or cash.");
  await page.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByTestId("faq-items").locator("li")).toHaveCount(2);
  // A used suggestion isn't offered again.
  await expect(page.getByRole("button", { name: "What happens if it rains?", exact: true })).toHaveCount(0);

  // Reorder, edit, remove.
  await page.getByRole("button", { name: 'Move "How do I pay?" up' }).click();
  await expect(page.getByTestId("faq-items").locator("li b")).toHaveText(["How do I pay?", "What happens if it rains?"]);
  await page.locator('li[data-faq="How do I pay?"]').getByRole("link", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit question" })).toBeVisible();
  await page.getByLabel("Answer").fill("Venmo @faq-lawns, Zelle or cash.");
  await page.getByRole("button", { name: "Save question" }).click();
  await expect(page.getByText("Question saved.")).toBeVisible();
  await page.getByLabel("Question", { exact: true }).fill("Temporary?");
  await page.getByLabel("Answer").fill("Delete me.");
  await page.getByRole("button", { name: "Add question" }).click();
  await page.locator('li[data-faq="Temporary?"]').getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Yes, remove it" }).click();
  await expect(page.getByText("Question removed.")).toBeVisible();
  await expect(page.getByTestId("faq-items").locator("li")).toHaveCount(2);

  // The request form shows it once the link is on.
  await page.goto("/requests");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByTestId("request-link-panel")).toContainText("On");
  const requestUrl = (await page.getByTestId("request-link").textContent())!.trim();
  const visitor = await newContext(browser);
  await visitor.goto(requestUrl);
  const faq = visitor.getByTestId("public-faq");
  await expect(faq.locator("summary")).toHaveText(["How do I pay?", "What happens if it rains?"]);
  await faq.getByText("How do I pay?").click();
  await expect(faq).toContainText("Venmo @faq-lawns, Zelle or cash.");

  // A customer with an account sees it on their page.
  const alice = await addCustomer(page, "Alice", "Ames");
  await page.goto(`/customers/${alice}`);
  await page.getByRole("button", { name: "Invite to their account" }).click();
  const inviteUrl = await page.getByLabel("Invite link for Alice Ames").inputValue();
  const customer = await newContext(browser);
  await customer.goto(inviteUrl);
  await customer.getByLabel("Email").fill(uniqueEmail("customer"));
  await customer.getByLabel("Choose a password").fill(PASSWORD);
  await customer.getByRole("button", { name: "Create my account" }).click();
  await expect(customer).toHaveURL(/\/portal$/);
  await expect(customer.getByTestId("public-faq").locator("summary")).toHaveText(["How do I pay?", "What happens if it rains?"]);
  // Customers don't get the business's Help or search.
  await expect(customer.getByRole("search")).toHaveCount(0);

  // Another business's request form and customers don't see this FAQ.
  const other = await newContext(browser);
  await signUpBusiness(other, "Other FAQ Lawns");
  await other.goto("/requests");
  await other.getByRole("button", { name: "Turn on" }).click();
  await expect(other.getByTestId("request-link-panel")).toContainText("On");
  const otherUrl = (await other.getByTestId("request-link").textContent())!.trim();
  await visitor.goto(otherUrl);
  await expect(visitor.getByTestId("public-faq")).toHaveCount(0);
  await other.goto("/settings/faq");
  await expect(other.getByText("No questions yet")).toBeVisible();
  await expect(other.locator("main")).not.toContainText("faq-lawns");
});
