import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
test("Nusrat and Jashim complete a real trip, recover on refresh, and cancel a matched booking", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const passengerContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const driverContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const passenger = await passengerContext.newPage(),
    driver = await driverContext.newPage();
  const errors: string[] = [];
  for (const page of [passenger, driver])
    page.on("pageerror", (e) => errors.push(e.message));
  async function login(page: Page, email: string) {
    await page.goto("http://localhost:8081/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("DemoOnly!Dhaka2026");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  try {
    await login(passenger, "nusrat@demo.dhaka.test");
    await expect(
      passenger.getByRole("heading", { name: "Request your ride" }),
    ).toBeVisible();
    await login(driver, "jashim@demo.dhaka.test");
    await driver
      .getByRole("button", { name: "Go online", exact: true })
      .click();
    await expect(driver.getByText("Online", { exact: true })).toBeVisible();
    const routes = await passenger
      .getByLabel("Route")
      .locator("option")
      .allTextContents();
    const label = routes.find((s) => s.includes("Banani to Mohakhali"))!;
    await passenger.getByLabel("Route").selectOption({ label });
    await passenger.getByRole("button", { name: "Preview fare" }).click();
    await expect(
      passenger.getByText("50.00 BDT", { exact: true }),
    ).toBeVisible();
    // Let the server commit, then lose the response. Retrying must reuse the saved key.
    let firstKey = "";
    await passenger.route("**/api/v1/ride-requests", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      firstKey = route.request().headers()["idempotency-key"];
      await route.fetch();
      await route.abort("failed");
      await passenger.unroute("**/api/v1/ride-requests");
    });
    await passenger
      .getByRole("button", { name: "Request ride", exact: true })
      .click();
    await expect(passenger.getByRole("alert")).toContainText(
      "request key is retained",
    );
    await passenger.reload();
    // Recovery discovers the already-created request even though the POST response was lost.
    await expect(
      passenger
        .getByRole("heading", { name: "Waiting for a driver", exact: true })
        .first(),
    ).toBeVisible();
    expect(firstKey).toBeTruthy();
    await passenger
      .getByRole("link", { name: "Booking details" })
      .first()
      .click();
    const bookingUrl = passenger.url();
    await expect(
      driver.getByRole("button", { name: "Accept request" }),
    ).toBeVisible({ timeout: 12000 });
    await driver.getByRole("button", { name: "Accept request" }).click();
    await expect(
      driver.getByRole("heading", { name: "Accepted", exact: true }),
    ).toBeVisible();
    await expect(
      passenger.getByRole("heading", { name: "Driver assigned" }),
    ).toBeVisible({ timeout: 12000 });
    await expect(passenger.getByText("Jashim", { exact: true })).toBeVisible();
    await expect(passenger.getByText("Bullet", { exact: true })).toBeVisible();
    await driver.reload();
    await passenger.reload();
    await expect(
      driver.getByRole("button", { name: "Mark arrival" }),
    ).toBeVisible();
    await expect(
      passenger.getByRole("heading", { name: "Driver assigned" }),
    ).toBeVisible();
    mkdirSync("../../docs/images", { recursive: true });
    await passenger.screenshot({
      path: "../../docs/images/ride-passenger-desktop.png",
      fullPage: true,
    });
    await driver.getByRole("button", { name: "Mark arrival" }).click();
    await expect(
      passenger.getByRole("heading", { name: "Driver arrived", exact: true }),
    ).toBeVisible({ timeout: 12000 });
    await expect(passenger.getByText("Final fare:")).toContainText("50.00 BDT");
    await expect(
      passenger.getByRole("button", { name: "Cancel request" }),
    ).toHaveCount(0);
    await driver
      .getByRole("button", { name: "Start trip", exact: true })
      .click();
    await expect(
      driver.getByRole("button", { name: "Mark Nusrat dropped off" }),
    ).toBeVisible();
    await expect(
      driver.getByRole("button", { name: "Complete trip", exact: true }),
    ).toHaveCount(0);
    await driver
      .getByRole("button", { name: "Mark Nusrat dropped off" })
      .click();
    await driver
      .getByRole("button", { name: "Complete trip", exact: true })
      .click();
    await expect(
      driver.getByRole("heading", { name: "Completed", exact: true }),
    ).toBeVisible();
    await expect(
      passenger.getByRole("heading", { name: "Completed", exact: true }),
    ).toBeVisible({ timeout: 12000 });
    await passenger.getByRole("link", { name: "History", exact: true }).click();
    await expect(
      passenger.getByRole("link", { name: "Completed", exact: true }),
    ).toBeVisible();
    await driver.getByRole("link", { name: "History", exact: true }).click();
    await expect(
      driver.getByRole("link", { name: "Completed", exact: true }),
    ).toBeVisible();
    await passenger.goto(bookingUrl);
    await expect(
      passenger.getByRole("heading", { name: "Completed", exact: true }),
    ).toBeVisible();
    await passenger
      .getByRole("link", { name: "Current ride", exact: true })
      .click();
    await passenger.getByLabel("Route").selectOption({ label });
    await passenger.getByLabel("Seats").fill("2");
    await passenger.getByRole("button", { name: "Preview fare" }).click();
    await expect(
      passenger.getByText("100.00 BDT", { exact: true }),
    ).toBeVisible();
    await passenger
      .getByRole("button", { name: "Request ride", exact: true })
      .click();
    await expect(
      passenger.getByRole("heading", {
        name: "Waiting for a driver",
        exact: true,
      }),
    ).toBeVisible();
    await driver
      .getByRole("link", { name: "Current ride", exact: true })
      .click();
    await driver.getByRole("button", { name: "Accept request" }).click();
    await expect(
      driver.getByRole("heading", { name: "Accepted", exact: true }),
    ).toBeVisible();
    await passenger.reload();
    await expect(
      passenger.getByRole("heading", { name: "Driver assigned" }),
    ).toBeVisible();
    await passenger.getByRole("button", { name: "Cancel request" }).click();
    await expect(
      passenger.getByRole("heading", { name: "Cancelled", exact: true }),
    ).toBeVisible();
    await expect(
      driver.getByRole("heading", { name: "Cancelled", exact: true }),
    ).toBeVisible({ timeout: 12000 });
    await expect(
      driver.getByText("Bullet · 0 / 3 seats allocated"),
    ).toBeVisible();
    await driver.setViewportSize({ width: 390, height: 844 });
    await driver.screenshot({
      path: "../../docs/images/ride-driver-mobile.png",
      fullPage: true,
    });
    for (const page of [driver, passenger])
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    await driver
      .getByRole("link", { name: "Current ride", exact: true })
      .click();
    await driver
      .getByRole("button", { name: "Go offline", exact: true })
      .click();
    await expect(driver.getByText("Offline", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await passengerContext.close();
    await driverContext.close();
  }
});
