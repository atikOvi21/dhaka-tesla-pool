# Six-minute demo and submission checklist

Deadline: **27 September 2026 at 23:59 Bangladesh time (UTC+06:00)**. Aim to finish upload and link checks well before then. Record **release/v1.0.0**, and show the actual commit used by the deployment/video. Do not call a local site publicly deployed.

## Prepare before recording

Use independent browser profiles for Jashim, Nusrat, Rafiq, Shirin and an extra test passenger. Log in beforehand, close unrelated tabs, hide secrets and notifications, and enlarge text. Finish/cancel prior active demo requests through the app; never reset development data. For a clean rehearsal use the isolated :8081 stack. Have architecture/ERD, the last-seat test result and the branch graph ready. Warm the free service once immediately before recording; no artificial keep-alive service is required.

## Timed outline (maximum 6:00)

| Time | Show and explain in your own words |
|---|---|
| 0:00-1:00 | Explain the Banani problem: Jashim's three-seat Bullet, Nusrat and Rafiq's compatible destinations, separate fares/statuses, no overselling. State the simplified configured-route assumption. |
| 1:00-1:35 | Architecture: React + Router -> same-origin Express -> PostgreSQL. Distinguish local Nginx from optional hosted static serving. Mention PG sessions and CSRF. |
| 1:35-2:15 | ERD: users/vehicle, requests, pools and retained memberships/events. Explain one active booking and one active vehicle pool, including cancelled history. |
| 2:15-2:45 | Lifecycle and money: arrival closes boarding; 5000/6000 poisha solo become 4000/4800 with two active bookings. Integer half-up rounding; fare snapshots do not change after drop-off. |
| 2:45-3:00 | Trade-off: one PostgreSQL advisory lock serializes mutations across API instances. Show the meaningful incremental branch graph; finer locks are a later scaling improvement. |
| 3:00-3:40 | Jashim goes online. Nusrat selects Banani-Mohakhali, previews 50 maximum / 40 conditional and requests. Jashim accepts. |
| 3:40-4:10 | Rafiq requests Banani-Gulshan 1 and joins the same pool. Switch profiles to show each person's own route/status/conditional fare and the driver's two members. |
| 4:10-4:40 | Shirin takes seat three. An extra passenger requests and stays waiting: demonstrate capacity. Briefly show the automated last-seat race result; manual clicks are not the concurrency proof. |
| 4:40-5:20 | Mark arrival: show Nusrat 40 and Rafiq 48 final. Start and drop off separately; show another booking still in progress and no premature pool completion. Complete after all drop-offs. |
| 5:20-5:45 | Show both histories, refresh/direct navigation, and the waiting passenger still unassigned. Cancel that waiting request to leave a tidy demo. |
| 5:45-6:00 | Show verified live URL if available, otherwise explain the documented free-hosting constraint and Docker fallback. State key limitations and close before 6:00. |

Optional alternate edge case: before arrival, cancel Rafiq with only Nusrat remaining; the final fare becomes 50 BDT unless a replacement joins. Do not add this as a seventh minute. Rehearse the flow and shorten narration rather than hiding broken behavior with cuts.

## Submission checklist

- [ ] Confirm repository is public or the evaluator has explicit access; test the link signed out.
- [ ] Check origin has master, pre-release and release/v1.0.0 with preserved incremental feature history.
- [ ] Review README setup, demo credentials, API overview, architecture/ERD, matching/fare model, tests, screenshots and limitations.
- [ ] Confirm only example/demo credentials are tracked; no real .env, cloud database URL, session secret, cookies or tokens.
- [ ] Check the release verification record and understand the capacity/concurrency tests personally.
- [ ] Complete the free deployment procedure and verify the real HTTPS URL, or state the actual hosting constraint with the tested Docker fallback.
- [ ] Provide a real **maximum-six-minute** video URL prominently in README. Verify it plays without requesting access; do not leave the placeholder at submission.
- [ ] Finish the AI Usage examples with your actual accepted and changed/rejected suggestions **and your reasons**. Review all code you intend to defend in the interview.
- [ ] Ensure video, deployment and release commit correspond; any final docs correction should be a new commit carried forward normally, never amended history.
- [ ] Open every submitted link in a signed-out session before the deadline.
- [ ] Submit the application form yourself. No form submission or video publication is performed by the coding agent.

Needed from the candidate: actual public app URL after verification (or the concrete free-hosting failure), actual video URL, any evaluator access requirements, and completed personal AI-example reasons. Do not send secrets in chat.
