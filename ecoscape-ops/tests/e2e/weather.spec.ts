import { expect, test, type Browser, type Page } from "@playwright/test";

import { addDays, formatShortDate, todayInTimeZone } from "../../src/lib/dates";
import { twilioSignature } from "../../src/lib/twilio/signature";
import {
  FAKE_ENV,
  FAKE_PLACES,
  UNDELIVERABLE_NUMBER,
  UNSUBSCRIBED_NUMBER,
  assignTextingNumber,
  randomNumber,
  textsFrom,
} from "./fakes";
import { PASSWORD, bookService, signUpBusiness, uniqueEmail } from "./helpers";

const TIME_ZONE = "America/New_York";
test.use({ timezoneId: TIME_ZONE });
const today = () => todayInTimeZone(TIME_ZONE);

const weatherCard = (page: Page) => page.locator('[data-card="weather"]');
const textRow = (page: Page, name: string) => page.locator(`.text-row[data-customer="${name}"]`);
const smsStatus = (page: Page, name: string) => textRow(page, name).locator("[data-sms-status]");

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

async function sendTexts(page: Page, count: number) {
  await page.getByRole("button", { name: `Text ${count} ${count === 1 ? "customer" : "customers"}` }).click();
  await page.getByRole("button", { name: "Send texts" }).click();
}

async function smsOptIn(page: Page, customerId: string) {
  await page.goto(`/customers/${customerId}`);
  return page.locator("dt", { hasText: "SMS opt-in" }).locator("xpath=following-sibling::dd[1]").textContent();
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

  await zip.fill(FAKE_PLACES.lakeRonkonkoma.zip);
  await page.getByRole("button", { name: "Save service area" }).click();
  await expect(page.getByText("Service area saved.")).toBeVisible();
  await expect(page.locator(".pagehead .meta")).toContainText("Forecast for Lake Ronkonkoma (11779)");

  const [t0, t1, t2] = FAKE_PLACES.lakeRonkonkoma.rain;
  const day = (offset: number) => page.locator(`[data-forecast-date="${addDays(today(), offset)}"]`);
  await expect(day(0).locator(".big")).toHaveText(`${t0}%`);
  await expect(day(0).locator(".label")).toHaveText("TODAY");
  await expect(day(1).locator(".big")).toHaveText(`${t1}%`);
  await expect(day(1)).toContainText("highest");
  await expect(day(2).locator(".big")).toHaveText(`${t2}%`);

  await page.goto("/dashboard");
  await expect(weatherCard(page).locator(".big")).toHaveText("80%");
  await expect(weatherCard(page)).toContainText("rain chance tomorrow");
  await expect(weatherCard(page)).toContainText("Lake Ronkonkoma · next 3 days");
  await expect(weatherCard(page).getByRole("link", { name: "Move jobs & text customers →" })).toHaveAttribute(
    "href",
    `/weather/move?from=${addDays(today(), 1)}`,
  );
});

test("each business sees the forecast for its own service area", async ({ page, browser }) => {
  await signUpBusiness(page, "North Shore Lawns");
  await setServiceArea(page, FAKE_PLACES.lakeRonkonkoma.zip);

  const { page: other } = await newOwner(browser, "City Lawns");
  await setServiceArea(other, FAKE_PLACES.newYork.zip);
  await other.goto("/dashboard");
  await expect(weatherCard(other).locator(".big")).toHaveText("65%");
  await expect(weatherCard(other)).toContainText(`rain chance ${formatShortDate(addDays(today(), 2))}`);
  await expect(weatherCard(other)).toContainText("New York");

  // The other business setting its area changed nothing here.
  await page.goto("/dashboard");
  await expect(weatherCard(page).locator(".big")).toHaveText("80%");
  await expect(weatherCard(page)).toContainText("Lake Ronkonkoma");
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
  await setServiceArea(page, FAKE_PLACES.lakeRonkonkoma.zip);
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

test("moving a rainy day texts only the opted-in customers, each their own message", async ({ page }) => {
  const business = "Rainy Day Lawns";
  const { email } = await signUpBusiness(page, business);
  const number = await assignTextingNumber(email);
  await setServiceArea(page, FAKE_PLACES.lakeRonkonkoma.zip);

  const janePhone = randomNumber();
  const bobPhone = randomNumber();
  const people = {
    jane: await addCustomer(page, { firstName: "Jane", lastName: "Adams", phone: janePhone, optIn: true }),
    bob: await addCustomer(page, { firstName: "Bob", lastName: "Baker", phone: bobPhone, optIn: false }),
    cara: await addCustomer(page, { firstName: "Cara", lastName: "Cole", optIn: true }),
    sam: await addCustomer(page, { firstName: "Sam", lastName: "Stone", phone: UNSUBSCRIBED_NUMBER, optIn: true }),
    uma: await addCustomer(page, { firstName: "Uma", lastName: "Ueda", phone: UNDELIVERABLE_NUMBER, optIn: true }),
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

  await expect(page.getByText(`Moved 5 visits to ${formatShortDate(newDay)}.`)).toBeVisible();
  const visits = page.locator(".visit-table tbody tr");
  await expect(visits).toHaveCount(5);
  await expect(visits.locator(".status-pill")).toHaveText(Array(5).fill("Weather delay"));

  const message = (first: string) =>
    `Hi ${first}, this is ${business}. Due to the weather, we're moving your ${formatShortDate(rainDay)} visit to ` +
    `${formatShortDate(newDay)}. Thanks! Reply STOP to opt out.`;
  await expect(smsStatus(page, "Jane Adams")).toHaveText("Not sent yet");
  await expect(textRow(page, "Jane Adams").locator(".text-body")).toHaveText(message("Jane"));
  await expect(smsStatus(page, "Bob Baker")).toHaveText("Won't be texted");
  await expect(textRow(page, "Bob Baker")).toContainText("Not opted in to texts");
  await expect(textRow(page, "Bob Baker").locator(".text-body")).toHaveCount(0);
  await expect(textRow(page, "Cara Cole")).toContainText("No usable mobile number");

  await sendTexts(page, 3);
  await expect(page.getByText("Sent 2 texts. 1 couldn't be sent — see below.")).toBeVisible();

  // Exactly what reached Twilio: from this business's number, to the opted-in customers.
  const sent = await textsFrom(number);
  expect(sent.map((m) => m.to).sort()).toEqual([janePhone, UNDELIVERABLE_NUMBER].sort());
  expect(sent.find((m) => m.to === janePhone)!.body).toBe(message("Jane"));
  expect(sent.find((m) => m.to === UNDELIVERABLE_NUMBER)!.body).toBe(message("Uma"));
  for (const m of sent) expect(m.statusCallback).toBe("http://localhost:3000/api/twilio/status");

  // Sam had replied STOP to this number before: Twilio refused, and he's opted out now.
  await expect(smsStatus(page, "Sam Stone")).toHaveText("Failed");
  await expect(textRow(page, "Sam Stone")).toContainText("Replied STOP, so they're opted out now");

  // Twilio's delivery updates arrive a moment later.
  await expect(async () => {
    await page.reload();
    await expect(smsStatus(page, "Jane Adams")).toHaveText("Delivered", { timeout: 500 });
    await expect(smsStatus(page, "Uma Ueda")).toHaveText("Not delivered", { timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await expect(textRow(page, "Uma Ueda")).toContainText("Blocked by the carrier's spam filter");
  for (const m of await textsFrom(number)) expect(m.callbacks.map((c) => c.httpStatus)).toEqual([204, 204]);

  // Nobody is left to text, and nobody got a second text.
  await expect(page.getByRole("button", { name: /^Text \d/ })).toHaveCount(0);
  await expect(page.getByText("Everyone who can be texted has been.")).toBeVisible();
  expect(await textsFrom(number)).toHaveLength(2);

  expect(await smsOptIn(page, people.sam)).toBe("No");
  expect(await smsOptIn(page, people.jane)).toBe("Yes");

  await page.goto("/weather");
  await expect(page.locator(".rain-delay-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".rain-delay-table tbody tr")).toContainText("1 sent · 2 failed");
});

test("one business's rain delays and texts never reach another business", async ({ page, browser }) => {
  const { email } = await signUpBusiness(page, "Acme Weather Lawns");
  const acmeNumber = await assignTextingNumber(email);
  const shared = randomNumber(); // the same person is a customer of both businesses
  const acmeCustomer = await addCustomer(page, { firstName: "Pat", lastName: "Acme", phone: shared, optIn: true });
  const rainDay = addDays(today(), 1);
  await bookVisit(page, acmeCustomer, rainDay);

  const birch = await newOwner(browser, "Birch Weather Services");
  const birchNumber = await assignTextingNumber(birch.email);
  const birchCustomer = await addCustomer(birch.page, { firstName: "Pat", lastName: "Birch", phone: shared, optIn: true });
  const birchOnly = await addCustomer(birch.page, { firstName: "Quinn", lastName: "Birch", phone: randomNumber(), optIn: true });
  await bookVisit(birch.page, birchCustomer, rainDay);
  await bookVisit(birch.page, birchOnly, rainDay);

  // Acme moves its day and texts. Only Acme's customer hears about it, from Acme's number.
  await moveDay(page, rainDay, addDays(today(), 3));
  const acmeDelayUrl = page.url();
  await expect(page.locator(".visit-table tbody tr")).toHaveCount(1);
  await sendTexts(page, 1);
  await expect(page.getByText("Sent 1 text.")).toBeVisible();
  const acmeTexts = await textsFrom(acmeNumber);
  expect(acmeTexts.map((m) => [m.to, m.body.slice(0, 36)])).toEqual([[shared, "Hi Pat, this is Acme Weather Lawns. "]]);

  // Birch's visits that day didn't move, and Birch has no rain delay or texts.
  await birch.page.goto(`/schedule/day/${rainDay}`);
  await expect(birch.page.getByText("Pat Birch")).toBeVisible();
  await expect(birch.page.getByText("Quinn Birch")).toBeVisible();
  await expect(birch.page.getByText("Weather delay")).toHaveCount(0);
  await birch.page.goto("/weather");
  await expect(birch.page.getByText("No rain delays yet")).toBeVisible();
  expect(await textsFrom(birchNumber)).toEqual([]);

  // Birch can't open Acme's rain delay, even with its address.
  await birch.page.goto(new URL(acmeDelayUrl).pathname);
  await expect(birch.page.getByText("Rain delay not found")).toBeVisible();
  await expect(birch.page.getByText("Pat Acme")).toHaveCount(0);

  // Birch's own rain delay texts Birch's customers, from Birch's number, in Birch's name.
  await moveDay(birch.page, rainDay, addDays(today(), 2));
  await sendTexts(birch.page, 2);
  await expect(birch.page.getByText("Sent 2 texts.")).toBeVisible();
  const birchTexts = await textsFrom(birchNumber);
  expect(birchTexts).toHaveLength(2);
  for (const m of birchTexts) expect(m.body).toContain("this is Birch Weather Services.");
  expect(await textsFrom(acmeNumber)).toHaveLength(1);
});

test("a STOP reply opts the customer out of that business's texts only", async ({ page, browser, request }) => {
  const { email } = await signUpBusiness(page, "Stop Lawns");
  const stopNumber = await assignTextingNumber(email);
  const phone = randomNumber();
  const stopCustomer = await addCustomer(page, { firstName: "Robin", lastName: "Reyes", phone, optIn: true });

  const other = await newOwner(browser, "Keep Lawns");
  const keepNumber = await assignTextingNumber(other.email);
  const keepCustomer = await addCustomer(other.page, { firstName: "Robin", lastName: "Reyes", phone, optIn: true });

  const url = "http://localhost:3000/api/twilio/inbound";
  const reply = (to: string, body: string, token = FAKE_ENV.TWILIO_AUTH_TOKEN) => {
    const params = {
      AccountSid: FAKE_ENV.TWILIO_ACCOUNT_SID,
      Body: body,
      From: phone,
      MessageSid: `SM${Date.now()}`,
      NumMedia: "0",
      To: to,
    };
    return request.post("/api/twilio/inbound", {
      form: params,
      headers: { "X-Twilio-Signature": twilioSignature(token, url, params) },
    });
  };

  // A forged request (not signed with our Twilio auth token) is refused and changes nothing.
  expect((await reply(keepNumber, "STOP", "not-the-real-token")).status()).toBe(403);
  const unsigned = await request.post("/api/twilio/inbound", {
    form: { AccountSid: FAKE_ENV.TWILIO_ACCOUNT_SID, Body: "STOP", From: phone, To: keepNumber },
  });
  expect(unsigned.status()).toBe(403);

  // An ordinary reply changes nothing either.
  expect((await reply(stopNumber, "Thanks, see you then")).status()).toBe(200);
  expect(await smsOptIn(page, stopCustomer)).toBe("Yes");

  const stop = await reply(stopNumber, "Stop");
  expect(stop.status()).toBe(200);
  expect(await stop.text()).toContain("<Response></Response>");
  expect(await smsOptIn(page, stopCustomer)).toBe("No");
  // Same person, other business: still opted in.
  expect(await smsOptIn(other.page, keepCustomer)).toBe("Yes");
});

test("without a texting number, the owner can move a day but not text", async ({ page }) => {
  await signUpBusiness(page, "Quiet Lawns");
  const customer = await addCustomer(page, { firstName: "Nia", lastName: "Nolan", phone: randomNumber(), optIn: true });
  await bookVisit(page, customer, addDays(today(), 1));

  await page.goto("/weather");
  await expect(page.getByTestId("texting-number")).toContainText("Texting isn't set up for your business yet");

  await moveDay(page, addDays(today(), 1), addDays(today(), 4));
  await expect(page.getByText("Moved 1 visit to")).toBeVisible();
  await expect(page.getByText("Texting isn't set up for your business yet")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Text \d/ })).toHaveCount(0);
  await expect(smsStatus(page, "Nia Nolan")).toHaveText("Not sent yet");
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
