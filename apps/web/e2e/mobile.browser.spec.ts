import { test, expect } from "@playwright/test";
test("mobile registration, validation and keyboard layout", async ({
  page,
}) => {
  await page.goto("/register");
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
  await page.getByLabel("Name", { exact: true }).fill("Mobile Passenger");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../docs/images/auth-register-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
