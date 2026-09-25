import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
test("three passengers share Bullet, a fourth waits, and cancellation removes discount eligibility", async ({
  browser,
  request,
}) => {
  test.setTimeout(150000);
  // Reset only the disposable API limiter so the complete browser suite stays within production limits.
  execFileSync("docker", ["compose", "-f", "compose.e2e.yaml", "restart", "api"], { cwd: resolve("../.."), stdio: "pipe" });
  await expect.poll(async () => (await request.get("/api/v1/health/ready")).status()).toBe(200);
  const contexts = await Promise.all(
    Array.from({ length: 5 }, () =>
      browser.newContext({ viewport: { width: 1280, height: 900 } }),
    ),
  );
  const [n, r, s, extra, d] = await Promise.all(
    contexts.map((c) => c.newPage()),
  );
  const errors: string[] = [];
  for (const p of [n, r, s, extra, d])
    p.on("pageerror", (e) => errors.push(e.message));
  async function login(page: Page, email: string) {
    await page.goto("http://localhost:8081/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("DemoOnly!Dhaka2026");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Welcome,/ })).toBeVisible();
  }
  async function book(page: Page, destination = "Mohakhali") {
    await page.getByRole("link", { name: "Current ride", exact: true }).click();
    const labels = await page
      .getByLabel("Route")
      .locator("option")
      .allTextContents();
    await page
      .getByLabel("Route")
      .selectOption({
        label: labels.find((x) => x.includes("Banani to " + destination))!,
      });
    await page.getByRole("button", { name: "Preview fare" }).click();
    await expect(
      page.getByText(/Provisional shared fare \(20% off\)/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Request ride", exact: true })
      .click();
    await expect(page).toHaveURL(/\/passenger\/bookings\//);
  }
  const active = async (page: Page) =>
    (
      await (
        await page.request.get(
          "http://localhost:8081/api/v1/ride-requests/active",
        )
      ).json()
    ).data;
  try {
    await login(d, "jashim@demo.dhaka.test");
    await d.getByRole("button", { name: "Go online", exact: true }).click();
    await login(n, "nusrat@demo.dhaka.test");
    await book(n);
    await expect(d.getByRole("button", { name: "Accept request" })).toBeVisible(
      { timeout: 12000 },
    );
    await d.getByRole("button", { name: "Accept request" }).click();
    await expect(d.getByRole("button", { name: "Mark arrival" })).toBeVisible();
    await login(r, "rafiq@demo.dhaka.test");
    await book(r, "Gulshan 1");
    await expect(r.getByText(/Shared ride assigned/)).toBeVisible();
    await login(s, "shirin@demo.dhaka.test");
    await book(s);
    await expect(s.getByText(/Shared ride assigned/)).toBeVisible();
    const bn = await active(n),
      br = await active(r),
      bs = await active(s);
    expect(br.pool.id).toBe(bn.pool.id);
    expect(bs.pool.id).toBe(bn.pool.id);
    for (const value of [br.id, "rafiq@demo.dhaka.test", "Rafiq"])
      expect(JSON.stringify(bn)).not.toContain(value);
    await extra.goto("http://localhost:8081/register");
    await extra.getByLabel("Name", { exact: true }).fill("Extra Passenger");
    await extra
      .getByLabel("Email", { exact: true })
      .fill("pool-browser-" + randomUUID() + "@test.invalid");
    await extra
      .getByLabel("Password", { exact: true })
      .fill("DemoOnly!Dhaka2026");
    await extra
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      extra.getByRole("heading", { name: "Request your ride" }),
    ).toBeVisible();
    await book(extra);
    await expect(
      extra.getByRole("heading", { name: "Waiting for a driver", exact: true }),
    ).toBeVisible();
    await expect(d.getByText("Bullet · 3 / 3 seats allocated")).toBeVisible({
      timeout: 12000,
    });
    await expect(
      d.getByRole("heading", { name: "Nusrat", exact: true }),
    ).toBeVisible();
    await expect(
      d.getByRole("heading", { name: "Rafiq", exact: true }),
    ).toBeVisible();
    await expect(
      d.getByRole("heading", { name: "Shirin", exact: true }),
    ).toBeVisible();
    await n.reload();
    await d.reload();
    await expect(n.getByText(/Shared ride assigned/)).toBeVisible();
    mkdirSync("../../docs/images", { recursive: true });
    await n.screenshot({
      path: "../../docs/images/pooling-passenger-desktop.png",
      fullPage: true,
    });
    await d.getByRole("button", { name: "Mark arrival" }).click();
    for (const [page, fare] of [
      [n, "40.00 BDT"],
      [r, "48.00 BDT"],
      [s, "40.00 BDT"],
    ] as const) {
      await expect(page.getByText("Final fare:")).toContainText(fare, {
        timeout: 12000,
      });
      await expect(
        page.getByRole("button", { name: "Cancel request" }),
      ).toHaveCount(0);
    }
    await d.getByRole("button", { name: "Start trip", exact: true }).click();
    await d.setViewportSize({ width: 390, height: 844 });
    await expect(
      d.getByRole("button", { name: "Mark Nusrat dropped off" }),
    ).toBeVisible();
    await d.screenshot({
      path: "../../docs/images/pooling-driver-mobile.png",
      fullPage: true,
    });
    expect(
      await d.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const name of ["Nusrat", "Rafiq", "Shirin"]) {
      await d
        .getByRole("button", { name: "Mark " + name + " dropped off" })
        .click();
      if (name !== "Shirin")
        await expect(
          d.getByRole("button", { name: "Complete trip", exact: true }),
        ).toHaveCount(0);
    }
    await d.getByRole("button", { name: "Complete trip", exact: true }).click();
    await expect(
      d.getByRole("heading", { name: "Completed", exact: true }),
    ).toBeVisible();
    for (const page of [n, r, s]) {
      await page.getByRole("link", { name: "History", exact: true }).click();
      await expect(
        page.getByRole("link", { name: "Completed", exact: true }).first(),
      ).toBeVisible();
    }
    await d.getByRole("link", { name: "History", exact: true }).click();
    await expect(
      d.getByRole("link", { name: "Completed", exact: true }).first(),
    ).toBeVisible();
    expect((await active(extra)).status).toBe("REQUESTED");
    await extra.getByRole("button", { name: "Cancel request" }).click();
    await expect(
      extra.getByRole("heading", { name: "Cancelled", exact: true }),
    ).toBeVisible();
    await book(n);
    await d.getByRole("link", { name: "Current ride", exact: true }).click();
    await d.getByRole("button", { name: "Accept request" }).click();
    await expect(d.getByRole("button", { name: "Mark arrival" })).toBeVisible();
    await book(r, "Gulshan 1");
    await expect(r.getByText(/Shared ride assigned/)).toBeVisible();
    await r.getByRole("button", { name: "Cancel request" }).click();
    await expect(
      r.getByRole("heading", { name: "Cancelled", exact: true }),
    ).toBeVisible();
    await expect(d.getByText("Bullet · 1 / 3 seats allocated")).toBeVisible({
      timeout: 12000,
    });
    await d.getByRole("button", { name: "Mark arrival" }).click();
    await expect(n.getByText("Final fare:")).toContainText("50.00 BDT", {
      timeout: 12000,
    });
    await d.getByRole("button", { name: "Start trip", exact: true }).click();
    await d.getByRole("button", { name: "Mark Nusrat dropped off" }).click();
    await d.getByRole("button", { name: "Complete trip", exact: true }).click();
    await expect(
      d.getByRole("heading", { name: "Completed", exact: true }),
    ).toBeVisible();
    await d.getByRole("link", { name: "Current ride", exact: true }).click();
    await d.getByRole("button", { name: "Go offline", exact: true }).click();
    await expect(d.getByText("Offline", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
