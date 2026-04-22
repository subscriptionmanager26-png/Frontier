/**
 * Subscription mental model (convention on A2A — no extra protocol primitive):
 *
 * - The remote task stays non-terminal for the whole subscription lifetime (spec WORKING maps to
 *   our `running` in {@link A2aTaskResult.status}). It must not flip to completed between emissions.
 * - Recurring work is delivered as updates (e.g. TaskArtifactUpdateEvent); each emission can be a
 *   standalone artifact (`append: false`, `lastChunk: false` until the final close).
 * - Schedule and counters belong in task metadata (interval / next emission / emission_count).
 * - CancelTask stops the scheduler and moves the task to a terminal state.
 *
 * Client (this app): when a backend webhook URL is configured, SendMessage includes
 * `configuration.returnImmediately`, `taskPushNotificationConfig`, and a mirrored
 * `pushNotificationConfig` (for agents that only read the A2A-style name). The agent POSTs each
 * emission to the relay; sync uses `GET …?taskId=&since=` with the same Bearer secret as webhook
 * auth when configured. The relay should persist with idempotency on `taskId` + sequence (or
 * artifact id). GetTask returns latest state only — it does not reconstruct full history.
 */

export {};
