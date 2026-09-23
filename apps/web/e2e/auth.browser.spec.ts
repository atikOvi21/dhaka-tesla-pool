import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

test("complete auth journey against isolated PostgreSQL and Nginx", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/passenger");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  mkdirSync(resolve("../../docs/images"), { recursive: true });
  await page.screenshot({
    path: "../../docs/images/auth-login-desktop.png",
    fullPage: true,
  });

  await page
    .getByLabel("Email", { exact: true })
    .fill("nusrat@demo.dhaka.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("IncorrectPassword2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid email or password.",
  );
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "nusrat@demo.dhaka.test",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");

  await page.getByLabel("Password", { exact: true }).fill("DemoOnly!Dhaka2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/passenger$/);
  await expect(
    page.getByRole("heading", { name: "Welcome, Nusrat." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome, Nusrat." }),
  ).toBeVisible();
  await page.goto("/driver");
  await expect(
    page.getByRole("heading", { name: "This page is for drivers" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Go to your workspace" }).click();

  // Read failures are simulated; login/session/cookies remain the real backend's.
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: { code: "SERVER_ERROR", message: "Temporary test outage." },
      },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Retry connection" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/v1/auth/me");
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Nusrat." }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Retry connection" }),
  ).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Nusrat." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/passenger");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole("link", { name: "Create a passenger account" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Browser Passenger");
  await page
    .getByLabel("Email", { exact: true })
    .fill("browser-" + randomUUID() + "@test.invalid");
  await page.getByLabel("Password", { exact: true }).fill("BrowserDemo!2026");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/passenger$/);
  await expect(
    page.getByRole("heading", { name: "Welcome, Browser Passenger." }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../docs/images/auth-passenger-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome, Browser Passenger." }),
  ).toBeVisible();

  // Expire ONLY this browser session, in the disposable e2e database.
  const sessionCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "dtp.sid",
  )!;
  const sid = decodeURIComponent(sessionCookie.value).slice(2).split(".")[0]!;
  if (!/^[A-Za-z0-9_-]+$/.test(sid))
    throw new Error("Unexpected session ID format.");
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      "compose.e2e.yaml",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "dtp_test",
      "-d",
      "dhaka_tesla_auth_test",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `UPDATE sessions SET expire = now() - interval '1 minute' WHERE sid = '${sid}'`,
    ],
    { cwd: resolve("../.."), stdio: "pipe" },
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("status")).toContainText("Your session expired");

  await page
    .getByLabel("Email", { exact: true })
    .fill("jashim@demo.dhaka.test");
  await page.getByLabel("Password", { exact: true }).fill("DemoOnly!Dhaka2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/driver$/);
  await expect(
    page.getByRole("heading", { name: "Welcome, Jashim." }),
  ).toBeVisible();
  await page.goto("/passenger");
  await expect(
    page.getByRole("heading", { name: "This page is for passengers" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Go to your workspace" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto("/driver");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/foundation");
  await expect(page.getByRole("status")).toContainText("PostgreSQL connected");
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  expect(errors).toEqual([]);
});
