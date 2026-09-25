import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("foundation health contract", () => {
  it("keeps liveness independent of the database", async () => {
    const check = vi
      .fn()
      .mockRejectedValue(new Error("private connection details"));
    const response = await request(createApp(check)).get("/api/v1/health/live");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { status: "ok" } });
    expect(check).not.toHaveBeenCalled();
  });
  it("returns readiness only after the database check succeeds", async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const response = await request(createApp(check)).get(
      "/api/v1/health/ready",
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { status: "ready" } });
    expect(check).toHaveBeenCalledOnce();
  });
  it("returns 503 without exposing database errors", async () => {
    const response = await request(
      createApp(async () => {
        throw new Error("secret");
      }),
    ).get("/api/v1/health/ready");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Database is not ready.",
      },
    });
  });
  it("does not pretend unimplemented booking endpoints work", async () => {
    const response = await request(createApp(async () => {}))
      .post("/api/v1/ride-requests")
      .send({});
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
  it("uses the error envelope for malformed JSON", async () => {
    const response = await request(createApp(async () => {}))
      .post("/api/v1/ride-requests")
      .set("Content-Type", "application/json")
      .send("{");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});


describe("same-origin hosted frontend", () => {
  it("serves frontend deep links while preserving API errors and missing asset errors", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dtp-web-"));
    try {
      writeFileSync(join(directory, "index.html"), '<html><div id="root">Hosted fixture</div></html>');
      writeFileSync(join(directory, "app.js"), "window.hosted = true;");
      writeFileSync(join(directory, ".env"), "PRIVATE_FIXTURE=hidden");
      const app = createApp(async () => {}, undefined, undefined, directory);
      for (const path of ["/", "/login", "/passenger/history", "/passenger/bookings/example", "/driver/trips/example", "/foundation"]) {
        const response = await request(app).get(path);
        expect(response.status).toBe(200);
        expect(response.text).toContain("Hosted fixture");
        expect(response.headers["cache-control"]).toBe("no-store");
      }
      expect((await request(app).get("/app.js")).text).toContain("window.hosted");
      for (const path of ["/api/v1/missing", "/assets/missing.js", "/.env"]) {
        const response = await request(app).get(path);
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe("NOT_FOUND");
        expect(response.text).not.toContain("PRIVATE_FIXTURE");
      }
      expect((await request(app).post("/passenger").send({})).status).toBe(404);
      expect((await request(app).get("/api/v1/health/ready")).body.data.status).toBe("ready");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("fails startup when the frontend build does not exist", () => {
    expect(() => createApp(async () => {}, undefined, undefined, join(tmpdir(), "missing-dtp-" + Date.now()))).toThrow();
  });
});
