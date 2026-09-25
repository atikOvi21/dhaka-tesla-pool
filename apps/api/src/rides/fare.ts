import { AuthError } from "../auth/service.js";
export const PRICING_VERSION = "demo-pool-v1";
export const BASE_POISHA = 2000;
export const RATE_POISHA = 1000;
export function soloFare(
  seats: number,
  meters: number,
  base = BASE_POISHA,
  rate = RATE_POISHA,
) {
  if (
    ![seats, meters, base, rate].every(Number.isSafeInteger) ||
    seats < 1 ||
    meters < 1 ||
    base < 0 ||
    rate < 0
  )
    throw new AuthError(400, "VALIDATION_ERROR", "Invalid fare inputs.");
  const numerator =
    BigInt(seats) * (BigInt(base) * 1000n + BigInt(meters) * BigInt(rate));
  const fare = (numerator + 500n) / 1000n;
  if (fare > 2147483647n)
    throw new AuthError(
      400,
      "VALIDATION_ERROR",
      "Fare exceeds the supported range.",
    );
  return Number(fare);
}

// Round half-up from the already-rounded solo quote.
export function sharedFare(soloPoisha: number) {
  if (!Number.isSafeInteger(soloPoisha) || soloPoisha < 0)
    throw new AuthError(400, "VALIDATION_ERROR", "Invalid solo fare.");
  return Number((BigInt(soloPoisha) * 8000n + 5000n) / 10000n);
}
