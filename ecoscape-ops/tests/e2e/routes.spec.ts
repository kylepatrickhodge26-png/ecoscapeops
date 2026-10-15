import { expect, test, type Browser, type Page } from "@playwright/test";

import { addDays, todayInTimeZone } from "../../src/lib/dates";
import { geocodeQueries } from "./fakes";
import { PASSWORD, signUpBusiness, uniqueEmail } from "./helpers";

// Route ordering against the fake Census geocoder (tests/e2e/fake-services.mjs). The shop
// is at 61 Clarendon Rd; the stops sit east and west of it:
//   4 West St ·· shop · 1 Near St · · 2 Middle St · · · 3 Far St
// so nearest-first from the shop is Near, Middle, Far, West (not Near, Middle, West, Far,
// which plain distance from the shop would give).
const TIME_ZONE = "America/New_York";
test.use({ timezoneId: TIME_ZONE });
const today = () => todayInTimeZone(TIME_ZONE);
const SHOP = "61 Clarendon Rd, Lake Ronkonkoma, NY";

async function setShop(page: Page, address = SHOP) {
  await page.goto("/settings");
  await page.getByLabel("Shop address").fill(address);
  await page.getByRole("button", { name: "Save shop address" }).click();
  await expect(page.getByText("Shop address saved.")).toBeVisible();
}

async function addCustomer(page: Page, name: string, address: string) {
  await page.goto("/customers/new");
  await page.getByLabel("First name").fill(name);
  await page.getByLabel("Property address").fill(address);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText("Customer added.")).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2];
}

async function book(page: Page, customerId: string, opts: { date?: string; assignee?: string } = {}) {
  await page.goto(`/schedule/new?customer=${customerId}`);
  await page.getByLabel("Service").fill("Mowing");
  await page.getByLabel("Price ($)").fill("65");
  await page.getByLabel("How often").selectOption("One time");
  await page.getByLabel(/First visit|Visit date/).fill(opts.date ?? today());
  if (opts.assignee) await page.getByLabel("Assign to").selectOption({ label: opts.assignee });
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page.getByText(/booked for/)).toBeVisible();
}

async function addCustomers(page: Page, people: [string, string][]) {
  const ids: Record<string, string> = {};
  for (const [name, address] of people) ids[name] = await addCustomer(page, name, address);
  return ids;
}

const route = (page: Page, label: string) => page.locator(`section[data-route="${label}"]`);
const stops = (page: Page, label: string) => route(page, label).locator(".job-table tbody .name-cell");
const myStops = (page: Page) => page.locator(".route-stop .cust");

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

test("an owner sets the shop address, and a day's visits go nearest first from it", async ({ page }) => {
  await signUpBusiness(page, "Route Lawns");

  // The shop has to say its own town and state.
  await page.goto("/settings");
  await page.getByLabel("Shop address").fill("61 Clarendon Rd");
  await page.getByRole("button", { name: "Save shop address" }).click();
  await expect(page.locator("#shop-address-error")).toContainText("Include the town and state");
  await setShop(page);
  await expect(page.getByTestId("shop-found")).toHaveText("Found: 61 CLARENDON RD, LAKE RONKONKOMA, NY, 11779");

  // Customers are looked up as they're saved: bare streets in the shop's town.
  const ids = await addCustomers(page, [
    ["Far", "3 Far St"],
    ["West", "4 West St"],
    ["Near", "1 Near St"],
    ["Middle", "2 Middle St"],
  ]);
  expect(await geocodeQueries()).toEqual(expect.arrayContaining(["3 Far St, Lake Ronkonkoma, NY", "1 Near St, Lake Ronkonkoma, NY"]));
  await page.goto(`/customers/${ids.Far}`);
  await expect(page.getByTestId("geo-problem")).toHaveCount(0);
  await expect(page.getByText("hasn't been looked up")).toHaveCount(0);

  for (const id of Object.values(ids)) await book(page, id);
  await page.goto(`/schedule/day/${today()}`);
  await expect(route(page, "Route").getByTestId("route-start")).toHaveText(`Starting from ${SHOP} (shop)`);
  await expect(stops(page, "Route")).toHaveText(["Near", "Middle", "Far", "West"]);
  await expect(route(page, "Route").getByTestId("stop-number")).toHaveText(["1", "2", "3", "4"]);
  await expect(route(page, "Route")).toContainText("Suggested order: nearest stop first.");

  await page.goto("/settings");
  await expect(page.getByTestId("geo-summary")).toContainText("4 located · 0 waiting · 0 need a look");
});

test("a match in the wrong country, or too far away, is flagged instead of used", async ({ page }) => {
  await signUpBusiness(page, "Careful Lawns");
  await setShop(page);
  const ids = await addCustomers(page, [
    ["Downing", "10 Downing St"],
    ["Dallas", "12 Clarendon Rd, Dallas, TX"],
    ["Nowhere", "99 Nowhere Ln"],
    ["Grove", "5 Lake Ave, Lake Grove"],
    ["Near", "1 Near St"],
  ]);

  // The bare street was anchored to the shop's town, the geocoder still matched London:
  // caught. The address that named its own town kept it.
  const queries = await geocodeQueries();
  expect(queries).toContain("10 Downing St, Lake Ronkonkoma, NY");
  expect(queries).toContain("5 Lake Ave, Lake Grove, NY");
  expect(queries).not.toContain("5 Lake Ave, Lake Grove, Lake Ronkonkoma, NY");
  await page.goto(`/customers/${ids.Downing}`);
  await expect(page.getByTestId("geo-problem")).toContainText("This address matched “10 Downing St, London SW1A 2AA, United Kingdom”, 3,");
  await expect(page.getByTestId("geo-problem")).toContainText("miles from your shop, so it isn't used for routes.");
  await page.goto(`/customers/${ids.Dallas}`);
  await expect(page.getByTestId("geo-problem")).toContainText("“12 CLARENDON RD, DALLAS, TX, 75201”, 1,");
  await page.goto(`/customers/${ids.Nowhere}`);
  await expect(page.getByTestId("geo-problem")).toContainText("We couldn't find this address on the map.");
  await page.goto(`/customers/${ids.Grove}`);
  await expect(page.getByTestId("geo-problem")).toHaveCount(0);

  // On the route, a flagged customer's visit goes last, marked, instead of being placed in London.
  for (const name of ["Downing", "Near", "Grove"]) await book(page, ids[name]);
  await page.goto(`/schedule/day/${today()}`);
  await expect(stops(page, "Route")).toHaveText(["Near", "Grove", "Downing"]);
  await expect(route(page, "Route").locator("tbody tr").last()).toContainText("Location not found");

  await page.goto("/settings");
  await expect(page.getByTestId("geo-summary")).toContainText("2 located · 0 waiting · 3 need a look");
  for (const name of ["Downing", "Dallas", "Nowhere"]) await expect(page.locator(".geo-problems")).toContainText(name);

  // Fixing the address places it.
  await page.goto(`/customers/${ids.Downing}/edit`);
  await page.getByLabel("Property address").fill("4 West St");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect(page.getByTestId("geo-problem")).toHaveCount(0);
});

test("the arrows override the order, the override is kept, and new visits go at the end", async ({ page }) => {
  await signUpBusiness(page, "Arrow Lawns");
  await setShop(page);
  const ids = await addCustomers(page, [
    ["Near", "1 Near St"],
    ["Middle", "2 Middle St"],
    ["Far", "3 Far St"],
    ["West", "4 West St"],
  ]);
  for (const name of ["Near", "Middle", "Far"]) await book(page, ids[name]);

  const day = `/schedule/day/${today()}`;
  await page.goto(day);
  await expect(stops(page, "Route")).toHaveText(["Near", "Middle", "Far"]);
  await expect(page.getByRole("button", { name: "Move Near up" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move Far down" })).toBeDisabled();
  await page.getByRole("button", { name: "Move Near down" }).click();
  await expect(stops(page, "Route")).toHaveText(["Middle", "Near", "Far"]);
  await page.getByRole("button", { name: "Move Far up" }).click();
  await expect(stops(page, "Route")).toHaveText(["Middle", "Far", "Near"]);
  await expect(route(page, "Route")).toContainText("Order set by hand.");

  await page.reload();
  await expect(stops(page, "Route")).toHaveText(["Middle", "Far", "Near"]);

  // A visit booked later goes at the end; the hand-set order stays.
  await book(page, ids.West);
  await page.goto(day);
  await expect(stops(page, "Route")).toHaveText(["Middle", "Far", "Near", "West"]);

  await page.getByRole("button", { name: "Reset to suggested order" }).click();
  await expect(stops(page, "Route")).toHaveText(["Near", "Middle", "Far", "West"]);
  await expect(page.getByRole("button", { name: "Reset to suggested order" })).toHaveCount(0);
});

test("a different start for one day reorders that day, without changing the shop", async ({ page }) => {
  await signUpBusiness(page, "Start Lawns");
  await setShop(page);
  const ids = await addCustomers(page, [
    ["Near", "1 Near St"],
    ["Middle", "2 Middle St"],
    ["Far", "3 Far St"],
    ["West", "4 West St"],
  ]);
  for (const id of Object.values(ids)) await book(page, id);
  const tomorrow = addDays(today(), 1);
  await book(page, ids.Near, { date: tomorrow });

  await page.goto(`/schedule/day/${today()}`);
  await page.getByRole("button", { name: "Start Route route somewhere else this day" }).click();
  // A start that lands in another country is refused.
  await page.getByLabel("Starting address for Route route this day").fill("10 Downing St");
  await page.getByRole("button", { name: "Start here this day" }).click();
  await expect(route(page, "Route").getByRole("alert")).toContainText("isn't in the US");
  await page.getByLabel("Starting address for Route route this day").fill("8 Home Rd");
  await page.getByRole("button", { name: "Start here this day" }).click();
  await expect(route(page, "Route").getByTestId("route-start")).toHaveText("Starting from 8 Home Rd (this day only)");
  await expect(stops(page, "Route")).toHaveText(["West", "Near", "Middle", "Far"]);

  // The saved shop address is unchanged, and other days still start from it.
  await page.goto("/settings");
  await expect(page.getByLabel("Shop address")).toHaveValue(SHOP);
  await page.goto(`/schedule/day/${tomorrow}`);
  await expect(route(page, "Route").getByTestId("route-start")).toHaveText(`Starting from ${SHOP} (shop)`);

  await page.goto(`/schedule/day/${today()}`);
  await page.getByRole("button", { name: "Start from the shop" }).click();
  await expect(route(page, "Route").getByTestId("route-start")).toHaveText(`Starting from ${SHOP} (shop)`);
  await expect(stops(page, "Route")).toHaveText(["Near", "Middle", "Far", "West"]);
});

test("a crew member's My jobs is their own route, and the owner sees it too", async ({ page, browser }) => {
  await signUpBusiness(page, "Crew Route Lawns");
  await setShop(page);
  const maria = await joinCrew(browser, await addCrewMember(page, "Maria"));
  const ids = await addCustomers(page, [
    ["Near", "1 Near St"],
    ["Middle", "2 Middle St"],
    ["West", "4 West St"],
    ["Far", "3 Far St"],
  ]);
  for (const name of ["West", "Near", "Middle"]) await book(page, ids[name], { assignee: "Maria" });
  await book(page, ids.Far, { assignee: "Kyle (you)" });

  // Maria's route: only her visits, nearest first from the shop.
  await maria.goto("/my-jobs");
  await expect(myStops(maria)).toHaveText(["Near", "Middle", "West"]);
  await expect(maria.locator("main")).not.toContainText("Far");
  await expect(maria.getByTestId("route-start")).toHaveText(`Starting from ${SHOP} (shop)`);

  // She reorders her own route; the owner sees her order.
  await maria.getByRole("button", { name: "Move Near down" }).click();
  await expect(myStops(maria)).toHaveText(["Middle", "Near", "West"]);
  await page.goto(`/schedule/day/${today()}`);
  await expect(stops(page, "Maria")).toHaveText(["Middle", "Near", "West"]);
  await expect(route(page, "Maria")).toContainText("Order set by hand.");
  await expect(stops(page, "Kyle (you)")).toHaveText(["Far"]);

  // The owner can reorder Maria's route too, and Maria sees it.
  await route(page, "Maria").getByRole("button", { name: "Move West up" }).click();
  await expect(stops(page, "Maria")).toHaveText(["Middle", "West", "Near"]);
  await maria.reload();
  await expect(myStops(maria)).toHaveText(["Middle", "West", "Near"]);

  // Maria starts from home today: only her route changes.
  await maria.getByRole("button", { name: "Reset to suggested order" }).click();
  await maria.getByRole("button", { name: "Start your route somewhere else this day" }).click();
  await maria.getByLabel("Starting address for your route this day").fill("8 Home Rd");
  await maria.getByRole("button", { name: "Start here this day" }).click();
  await expect(maria.getByTestId("route-start")).toHaveText("Starting from 8 Home Rd (this day only)");
  await expect(myStops(maria)).toHaveText(["West", "Near", "Middle"]);
  await page.reload();
  await expect(route(page, "Maria").getByTestId("route-start")).toHaveText("Starting from 8 Home Rd (this day only)");
  await expect(route(page, "Kyle (you)").getByTestId("route-start")).toHaveText(`Starting from ${SHOP} (shop)`);

  // Settings (and the shop address) are owner-only.
  await maria.goto("/settings");
  await expect(maria).toHaveURL(/\/my-jobs$/);
});

test("another business never sees this business's shop, customers' locations or routes", async ({ page, browser }) => {
  await signUpBusiness(page, "Acme Route Lawns");
  await setShop(page);
  const ids = await addCustomers(page, [["Secret", "1 Near St"]]);
  await book(page, ids.Secret);
  await page.goto(`/schedule/day/${today()}`);
  await expect(stops(page, "Route")).toHaveText(["Secret"]);

  const other = await (await browser.newContext({ timezoneId: TIME_ZONE })).newPage();
  await signUpBusiness(other, "Nosy Route Lawns");
  await other.goto("/settings");
  await expect(other.getByLabel("Shop address")).toHaveValue("");
  await expect(other.getByTestId("shop-found")).toHaveCount(0);
  await expect(other.getByTestId("geo-summary")).toContainText("Save your shop address first.");
  await other.goto(`/schedule/day/${today()}`);
  await expect(other.getByText("Nothing scheduled")).toBeVisible();
  await expect(other.getByText("Secret")).toHaveCount(0);
  await other.goto(`/customers/${ids.Secret}`);
  await expect(other.getByText("Customer not found")).toBeVisible();
});
