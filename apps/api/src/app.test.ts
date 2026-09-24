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
