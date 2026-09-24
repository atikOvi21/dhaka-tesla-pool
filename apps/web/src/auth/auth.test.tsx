vi.mock("../rides/RideWorkspace", () => ({ RideWorkspace: () => null }));
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";

const passenger = {
  id: "p1",
  name: "Nusrat",
  email: "nusrat@demo.dhaka.test",
  role: "PASSENGER",
};
const driver = {
  ...passenger,
  id: "d1",
  name: "Jashim",
  email: "jashim@demo.dhaka.test",
  role: "DRIVER",
};
const ok = (data: unknown) =>
  new Response(JSON.stringify({ data }), { status: 200 });
const fail = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), { status });
function mount(path = "/login") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
async function fillLogin() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), passenger.email);
  await user.type(screen.getByLabelText("Password"), "DemoOnly!Dhaka2026");
  return user;
}
function anonymous() {
  return fail(401, "UNAUTHENTICATED", "Sign in to continue.");
}

describe("authentication UI", () => {
  it("shows loading without a login flash, then restores a protected session", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) =>
        path.endsWith("/me")
          ? new Promise<Response>((resolve) => {
              finish = resolve;
            })
          : Promise.resolve(ok({ csrfToken: "fresh" })),
      ),
    );
    mount("/passenger");
    expect(
      screen.getByRole("heading", { name: "Checking your session" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    await act(async () => {
      finish(ok(passenger));
    });
    expect(
      await screen.findByRole("heading", { name: "Welcome, Nusrat." }),
    ).toBeVisible();
  });

  it.each(["network", "server"])(
    "offers recovery for %s restoration failure instead of showing login",
    async (kind) => {
      let healthy = false;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string) => {
          if (!healthy) {
            if (kind === "network") throw new TypeError("offline");
            return fail(503, "DATABASE_UNAVAILABLE", "Database unavailable.");
          }
          return path.endsWith("/me")
            ? ok(passenger)
            : ok({ csrfToken: "fresh" });
        }),
      );
      mount("/passenger");
      expect(
        await screen.findByRole("button", { name: "Retry connection" }),
      ).toBeVisible();
      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
      healthy = true;
      await userEvent.click(
        screen.getByRole("button", { name: "Retry connection" }),
      );
      expect(
        await screen.findByRole("heading", { name: "Welcome, Nusrat." }),
      ).toBeVisible();
    },
  );

  it.each([passenger, driver])(
    "redirects successful login to the $role landing and refreshes CSRF",
    async (account) => {
      let posts = 0,
        csrf = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string, options: RequestInit) => {
          if (path.endsWith("/me")) return anonymous();
          if (path.endsWith("/csrf")) {
            csrf++;
            return ok({ csrfToken: "token-" + csrf });
          }
          expect(options.credentials).toBe("same-origin");
          expect(options.headers).toEqual({
            "Content-Type": "application/json",
            "X-CSRF-Token": "token-1",
          });
          posts++;
          return ok(account);
        }),
      );
      mount();
      const user = await fillLogin();
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      expect(
        await screen.findByRole("heading", {
          name: "Welcome, " + account.name + ".",
        }),
      ).toBeVisible();
      expect(posts).toBe(1);
      expect(csrf).toBe(2);
    },
  );

  it("validates registration fields before sending a request", async () => {
    const fetch = vi.fn(async () => anonymous());
    vi.stubGlobal("fetch", fetch);
    mount("/register");
    await userEvent.click(
      await screen.findByRole("button", { name: "Create account" }),
    );
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(screen.getByText("Enter a valid email address.")).toBeVisible();
    expect(screen.getByText(/Use 12–128/)).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("registers only name/email/password and opens the passenger page", async () => {
    let payload;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) => {
        if (path.endsWith("/me")) return anonymous();
        if (path.endsWith("/csrf")) return ok({ csrfToken: "csrf" });
        payload = JSON.parse(options.body as string);
        return ok({ ...passenger, name: "New Passenger" });
      }),
    );
    mount("/register");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "New Passenger");
    await user.type(screen.getByLabelText("Email"), "new@test.invalid");
    await user.type(screen.getByLabelText("Password"), "  Exact password  ");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(
      await screen.findByRole("heading", { name: "Welcome, New Passenger." }),
    ).toBeVisible();
    expect(payload).toEqual({
      name: "New Passenger",
      email: "new@test.invalid",
      password: "  Exact password  ",
    });
  });

  it.each(["network", "credentials", "csrf"])(
    "preserves email, clears password, and never replays a failed %s mutation",
    async (kind) => {
      let posts = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string) => {
          if (path.endsWith("/me")) return anonymous();
          if (path.endsWith("/csrf")) return ok({ csrfToken: "csrf" });
          posts++;
          if (kind === "network") throw new TypeError("offline");
          return kind === "csrf"
            ? fail(403, "CSRF_INVALID", "Invalid token.")
            : fail(401, "INVALID_CREDENTIALS", "Invalid email or password.");
        }),
      );
      mount();
      const user = await fillLogin();
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      expect(await screen.findByRole("alert")).toBeVisible();
      expect(screen.getByLabelText("Email")).toHaveValue(passenger.email);
      expect(screen.getByLabelText("Password")).toHaveValue("");
      expect(posts).toBe(1);
      // Checking the session is a GET recovery, and keeps the draft on 401.
      await user.click(screen.getByRole("button", { name: "Check session" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible(),
      );
      expect(screen.getByLabelText("Email")).toHaveValue(passenger.email);
      expect(posts).toBe(1);
    },
  );

  it("prevents duplicate submissions while a request is pending", async () => {
    let finish!: (response: Response) => void;
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path.endsWith("/me")) return anonymous();
        if (path.endsWith("/csrf")) return ok({ csrfToken: "csrf" });
        posts++;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }),
    );
    mount();
    const user = await fillLogin();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByRole("button", { name: "Please wait…" }),
    ).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
    expect(posts).toBe(1);
    await act(async () => {
      finish(ok(passenger));
    });
    expect(
      await screen.findByRole("heading", { name: "Welcome, Nusrat." }),
    ).toBeVisible();
  });

  it.each([
    [passenger, "/driver", "drivers"],
    [driver, "/passenger", "passengers"],
  ] as const)(
    "blocks the wrong role for %s",
    async (account, route, roleName) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string) =>
          path.endsWith("/me") ? ok(account) : ok({ csrfToken: "csrf" }),
        ),
      );
      mount(route);
      expect(
        await screen.findByRole("heading", {
          name: "This page is for " + roleName,
        }),
      ).toBeVisible();
      expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    },
  );

  it("does not report logout success during an outage and allows a user retry", async () => {
    let healthy = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path.endsWith("/me")) return ok(passenger);
        if (path.endsWith("/csrf")) return ok({ csrfToken: "csrf" });
        return healthy
          ? ok(null)
          : fail(503, "SERVER_ERROR", "Server unavailable.");
      }),
    );
    mount("/passenger");
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Server unavailable.",
    );
    expect(
      screen.getByRole("heading", { name: "Welcome, Nusrat." }),
    ).toBeVisible();
    healthy = true;
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "You have signed out.",
    );
  });

  it("notices expiry on focus and explains why sign-in is needed again", async () => {
    let expired = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path.endsWith("/me")
          ? expired
            ? anonymous()
            : ok(passenger)
          : ok({ csrfToken: "csrf" }),
      ),
    );
    mount("/passenger");
    await screen.findByRole("heading", { name: "Welcome, Nusrat." });
    expired = true;
    fireEvent(window, new Event("focus"));
    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your session expired",
    );
  });

  it("recovers after authentication succeeds but token refresh fails without repeating login", async () => {
    let signedIn = false,
      csrf = 0,
      posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path.endsWith("/me")) return signedIn ? ok(passenger) : anonymous();
        if (path.endsWith("/csrf")) {
          csrf++;
          return csrf === 2
            ? fail(503, "SERVER_ERROR", "Unavailable.")
            : ok({ csrfToken: "csrf" });
        }
        posts++;
        signedIn = true;
        return ok(passenger);
      }),
    );
    mount();
    const user = await fillLogin();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(
      await screen.findByRole("button", { name: "Retry connection" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Welcome, Nusrat." }),
    ).toBeVisible();
    expect(posts).toBe(1);
  });
});
