import { expect, test, type Browser, type Page } from "@playwright/test";

import { addDays, formatShortDate, todayInTimeZone } from "../../src/lib/dates";
import { smsLink } from "../../src/lib/sms";
import { FAKE_PLACES, randomNumber } from "./fakes";
import { PASSWORD, bookService, signUpBusiness, uniqueEmail } from "./helpers";

const TIME_ZONE = "America/New_York";
test.use({ timezoneId: TIME_ZONE });
const today = () => todayInTimeZone(TIME_ZONE);

const weatherCard = (page: Page) => page.locator('[data-card="weather"]');
const textRow = (page: Page, name: string) => page.locator(`.text-row[data-customer="${name}"]`);
const textStatus = (page: Page, name: string) => textRow(page, name).locator("[data-text-status]");
const openText = (page: Page, name: string) => page.getByRole("link", { name: `Open text to ${name}` });

async function setServiceArea(page: Page, zip: string) {
  await page.goto("/weather/area");
  await page.getByLabel("Service area ZIP code").fill(zip);
  await page.getByRole("button", { name: "Save service area" }).click();
  await expect(page.getByText("Service area saved.")).toBeVisible();
}

type TextCustomer = { firstName: string; lastName: string; phone?: string; optIn: boolean };

async function addCustomer(page: Page, c: TextCustomer) {
  await page.goto("/customers/new");
  await page.getByLabel("First name").fill(c.firstName);
  await page.getByLabel("Last name").fill(c.lastName);
  if (c.phone) await page.getByLabel("Phone").fill(c.phone);
  if (c.optIn) await page.getByLabel("Customer has opted in to SMS").check();
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText("Customer added.")).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2];
}

async function bookVisit(page: Page, customerId: string, date: string) {
  await bookService(page, { customerId, frequency: "One time", startDate: date });
}

async function moveDay(page: Page, from: string, to: string) {
  await page.goto(`/weather/move?from=${from}`);
  await page.getByLabel("To").fill(to);
  await page.getByRole("button", { name: "Move visits" }).click();
  await expect(page).toHaveURL(/\/weather\/delays\/[0-9a-f-]{36}/);
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
  return page;
}

async function newOwner(browser: Browser, businessName: string) {
  const page = await (await browser.newContext({ timezoneId: TIME_ZONE })).newPage();
  const { email } = await signUpBusiness(page, businessName);
  return { page, email };
}

test("an owner sets their service area and sees the rainiest of the next 3 days on the dashboard", async ({ page }) => {
  await signUpBusiness(page, "Forecast Lawns");
  await expect(weatherCard(page)).toContainText("Add your service area");
  await weatherCard(page).getByRole("link", { name: "Add your service area" }).click();
  await expect(page).toHaveURL(/\/weather$/);

  const zip = page.getByLabel("Service area ZIP code");
  await zip.fill("1177");
  await page.getByRole("button", { name: "Save service area" }).click();
  await expect(page.locator(".field-error")).toHaveText("Enter a 5-digit ZIP code");
  await zip.fill("00000");
  await page.getByRole("button", { name: "Save service area" }).click();
  await expect(page.locator(".field-error")).toHaveText("We couldn't find that ZIP code");
  await expect(zip).toHaveValue("00000");

  await zip.fill(FAKE_PLACES.ronkonkoma.zip);
  await page.getByRole("button", { name: "Save service area" }).click();
  await expect(page.getByText("Service area saved.")).toBeVisible();
  await expect(page.locator(".pagehead .meta")).toContainText("National Weather Service forecast for Ronkonkoma, NY (11779)");

  const [t0, t1, t2] = FAKE_PLACES.ronkonkoma.rain;
  const day = (offset: number) => page.locator(`[data-forecast-date="${addDays(today(), offset)}"]`);
  await expect(day(0).locator(".big")).toHaveText(`${t0}%`);
  await expect(day(0).locator(".label")).toHaveText("TODAY");
  await expect(day(1).locator(".big")).toHaveText(`${t1}%`);
  await expect(day(1)).toContainText("highest");
  await expect(day(2).locator(".big")).toHaveText(`${t2}%`);

  await page.goto("/dashboard");
  await expect(weatherCard(page).locator(".big")).toHaveText("80%");
  await expect(weatherCard(page)).toContainText("rain chance tomorrow");
  await expect(weatherCard(page)).toContainText("Ronkonkoma, NY · next 3 days");
  await expect(weatherCard(page).getByRole("link", { name: "Move jobs & text customers →" })).toHaveAttribute(
    "href",
    `/weather/move?from=${addDays(today(), 1)}`,
  );
});

test("each business sees the forecast for its own service area", async ({ page, browser }) => {
  await signUpBusiness(page, "North Shore Lawns");
  await setServiceArea(page, FAKE_PLACES.ronkonkoma.zip);

  const { page: other } = await newOwner(browser, "City Lawns");
  await setServiceArea(other, FAKE_PLACES.newYork.zip);
  await other.goto("/dashboard");
  await expect(weatherCard(other).locator(".big")).toHaveText("65%");
  await expect(weatherCard(other)).toContainText(`rain chance ${formatShortDate(addDays(today(), 2))}`);
  await expect(weatherCard(other)).toContainText("New York, NY");

  // The other business setting its area changed nothing here.
  await page.goto("/dashboard");
  await expect(weatherCard(page).locator(".big")).toHaveText("80%");
  await expect(weatherCard(page)).toContainText("Ronkonkoma, NY");
  await expect(weatherCard(page)).not.toContainText("New York");
});

test("a dry forecast and an unavailable one both read sensibly", async ({ page }) => {
  await signUpBusiness(page, "Sunny Lawns");
  await setServiceArea(page, FAKE_PLACES.beverlyHills.zip);
  await page.goto("/dashboard");
  await expect(weatherCard(page).locator(".big")).toHaveText("0%");
  await expect(weatherCard(page)).toContainText("no rain expected in the next 3 days");

  await setServiceArea(page, FAKE_PLACES.outage.zip);
  await page.goto("/dashboard");
  await expect(weatherCard(page)).toContainText("Forecast unavailable right now");
  // The rest of the dashboard still works.
  await expect(page.locator('[data-card="today"] .big')).toHaveText("0");
  await page.goto("/weather");
  await expect(page.getByText("The forecast is unavailable right now.")).toBeVisible();
});

test("a crew member sees the rain risk, but can't move jobs or text customers", async ({ page, browser }) => {
  await signUpBusiness(page, "Crew Weather Lawns");
  await setServiceArea(page, FAKE_PLACES.ronkonkoma.zip);
  const maria = await joinCrew(browser, await addCrewMember(page, "Maria"));

  await maria.goto("/dashboard");
  await expect(weatherCard(maria).locator(".big")).toHaveText("80%");
  await expect(weatherCard(maria).getByRole("link")).toHaveCount(0);
  await expect(maria.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["Home", "My jobs"]);

  for (const path of ["/weather", "/weather/move", "/weather/area"]) {
    await maria.goto(path);
    await expect(maria).toHaveURL(/\/my-jobs$/);
  }
});

test("moving a rainy day prepares a text for each opted-in customer, sent from the owner's phone", async ({
  page,
  context,
}) => {
  const business = "Rainy Day Lawns";
  await signUpBusiness(page, business);
  await setServiceArea(page, FAKE_PLACES.ronkonkoma.zip);

  const janePhone = randomNumber();
  const evePhone = randomNumber();
  const people = {
    jane: await addCustomer(page, { firstName: "Jane", lastName: "Adams", phone: janePhone, optIn: true }),
    bob: await addCustomer(page, { firstName: "Bob", lastName: "Baker", phone: randomNumber(), optIn: false }),
    cara: await addCustomer(page, { firstName: "Cara", lastName: "Cole", optIn: true }),
    eve: await addCustomer(page, { firstName: "Eve", lastName: "Evans", phone: evePhone, optIn: true }),
  };
  const rainDay = addDays(today(), 1);
  const newDay = addDays(today(), 2);
  for (const id of Object.values(people)) await bookVisit(page, id, rainDay);

  // From the dashboard's rain-risk card.
  await page.goto("/dashboard");
  await weatherCard(page).getByRole("link", { name: "Move jobs & text customers →" }).click();
  await expect(page.getByLabel("Move visits from")).toHaveValue(rainDay);
  await expect(page.getByLabel("To")).toHaveValue(newDay);
  await expect(page.getByTestId("move-forecast")).toContainText(`80% chance of rain ${formatShortDate(rainDay)}`);
  await page.getByRole("button", { name: "Move visits" }).click();

  await expect(page.getByText(`Moved 4 visits to ${formatShortDate(newDay)}.`)).toBeVisible();
  const visits = page.locator(".visit-table tbody tr");
  await expect(visits).toHaveCount(4);
  await expect(visits.locator(".status-pill")).toHaveText(Array(4).fill("Weather delay"));

  const message = (first: string) =>
    `Hi ${first}, this is ${business}. Due to the weather, we're moving your ${formatShortDate(rainDay)} visit to ` +
    `${formatShortDate(newDay)}. Thanks! Reply STOP to opt out.`;

  // Opted-in customers get their own message and an Open text link to their number.
  await expect(page.getByTestId("texts-opened")).toHaveText("0 of 2 opened");
  await expect(textStatus(page, "Jane Adams")).toHaveText("Not texted yet");
  await expect(textRow(page, "Jane Adams").locator(".text-body")).toHaveText(message("Jane"));
  await expect(openText(page, "Jane Adams")).toHaveAttribute("href", smsLink(janePhone, message("Jane")));
  await expect(openText(page, "Eve Evans")).toHaveAttribute("href", smsLink(evePhone, message("Eve")));

  // Everyone else gets no message and no link, with the reason shown.
  await expect(textStatus(page, "Bob Baker")).toHaveText("Won't be texted");
  await expect(textRow(page, "Bob Baker")).toContainText("Not opted in to texts");
  await expect(textRow(page, "Bob Baker").locator(".text-body")).toHaveCount(0);
  await expect(openText(page, "Bob Baker")).toHaveCount(0);
  await expect(textRow(page, "Cara Cole")).toContainText("No usable mobile number");
  await expect(openText(page, "Cara Cole")).toHaveCount(0);

  // Copy is there for sending from a computer.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy message for Eve Evans" }).click();
  await expect(page.getByRole("button", { name: "Copy message for Eve Evans" })).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(message("Eve"));

  // Opening a text keeps track of who's been texted.
  await openText(page, "Jane Adams").click();
  await expect(textStatus(page, "Jane Adams")).toHaveText(/^Opened \d{1,2}:\d{2} [AP]M$/);
  await expect(page.getByTestId("texts-opened")).toHaveText("1 of 2 opened");
  await expect(textStatus(page, "Eve Evans")).toHaveText("Not texted yet");
  await page.reload();
  await expect(textStatus(page, "Jane Adams")).toHaveText(/^Opened /);

  await page.goto("/weather");
  const row = page.locator(".rain-delay-table tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row.locator("td").nth(1)).toHaveText("4");
  await expect(row.locator("td").nth(2)).toHaveText("1");
});

test("one business's rain delays and texts never reach another business", async ({ page, browser }) => {
  await signUpBusiness(page, "Acme Weather Lawns");
  const shared = randomNumber(); // the same person is a customer of both businesses
  const acmeCustomer = await addCustomer(page, { firstName: "Pat", lastName: "Acme", phone: shared, optIn: true });
  const rainDay = addDays(today(), 1);
  await bookVisit(page, acmeCustomer, rainDay);

  const birch = await newOwner(browser, "Birch Weather Services");
  const birchCustomer = await addCustomer(birch.page, { firstName: "Pat", lastName: "Birch", phone: shared, optIn: true });
  const birchOnly = await addCustomer(birch.page, { firstName: "Quinn", lastName: "Birch", phone: randomNumber(), optIn: true });
  await bookVisit(birch.page, birchCustomer, rainDay);
  await bookVisit(birch.page, birchOnly, rainDay);

  // Acme's rain delay covers only Acme's customer, in Acme's name.
  await moveDay(page, rainDay, addDays(today(), 3));
  const acmeDelayUrl = page.url();
  await expect(page.locator(".visit-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".text-row")).toHaveCount(1);
  await expect(textRow(page, "Pat Acme").locator(".text-body")).toContainText("Hi Pat, this is Acme Weather Lawns.");
  await expect(page.getByText("Quinn Birch")).toHaveCount(0);
  await openText(page, "Pat Acme").click();
  await expect(textStatus(page, "Pat Acme")).toHaveText(/^Opened /);

  // Birch's visits that day didn't move, and Birch has no rain delay.
  await birch.page.goto(`/schedule/day/${rainDay}`);
  await expect(birch.page.getByText("Pat Birch")).toBeVisible();
  await expect(birch.page.getByText("Quinn Birch")).toBeVisible();
  await expect(birch.page.getByText("Weather delay")).toHaveCount(0);
  await birch.page.goto("/weather");
  await expect(birch.page.getByText("No rain delays yet")).toBeVisible();

  // Birch can't open Acme's rain delay, even with its address.
  await birch.page.goto(new URL(acmeDelayUrl).pathname);
  await expect(birch.page.getByText("Rain delay not found")).toBeVisible();
  await expect(birch.page.getByText("Pat Acme")).toHaveCount(0);

  // Birch's own rain delay: Birch's customers, in Birch's name, nothing opened yet.
  await moveDay(birch.page, rainDay, addDays(today(), 2));
  await expect(birch.page.locator(".text-row")).toHaveCount(2);
  for (const name of ["Pat Birch", "Quinn Birch"]) {
    await expect(textRow(birch.page, name).locator(".text-body")).toContainText("this is Birch Weather Services.");
    await expect(textStatus(birch.page, name)).toHaveText("Not texted yet");
  }
});

test("turning off a customer's text opt-in takes away their text", async ({ page }) => {
  await signUpBusiness(page, "Opt Out Lawns");
  const customer = await addCustomer(page, { firstName: "Robin", lastName: "Reyes", phone: randomNumber(), optIn: true });
  await bookVisit(page, customer, addDays(today(), 1));
  await moveDay(page, addDays(today(), 1), addDays(today(), 4));
  const delayUrl = page.url();
  await expect(openText(page, "Robin Reyes")).toBeVisible();

  // e.g. after they reply STOP
  await page.goto(`/customers/${customer}/edit`);
  await page.getByLabel("Customer has opted in to SMS").uncheck();
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${customer}`));

  await page.goto(delayUrl);
  await expect(textStatus(page, "Robin Reyes")).toHaveText("Won't be texted");
  await expect(openText(page, "Robin Reyes")).toHaveCount(0);
  await expect(page.getByText("None of these customers have opted in to texts.")).toBeVisible();
});

test("moving a day with nothing on it, or to the same day, explains what's wrong", async ({ page }) => {
  await signUpBusiness(page, "Empty Day Lawns");
  await page.goto(`/weather/move?from=${addDays(today(), 5)}`);
  await page.getByRole("button", { name: "Move visits" }).click();
  await expect(page.locator(".field-error")).toHaveText("There are no visits to move on that day");

  await page.getByLabel("To").fill(addDays(today(), 5));
  await page.getByRole("button", { name: "Move visits" }).click();
  await expect(page.locator(".field-error")).toHaveText("Choose a different day");
  await expect(page.getByLabel("Move visits from")).toHaveValue(addDays(today(), 5));
});
