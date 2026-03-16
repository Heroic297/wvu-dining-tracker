/**
 * Background job scheduler using node-cron.
 *
 * Jobs:
 *  1. Daily menu scrape at 06:00 AM EST (11:00 UTC)
 *  2. Wearable sync every hour
 *
 * On Railway: These jobs run inside the same Node process.
 * Alternatively, set up a Railway Cron Service that hits POST /api/jobs/scrape
 * with the CRON_SECRET header for external triggering.
 */
import cron from "node-cron";
import { scrapeAllLocations, todayString } from "./scraper.js";
import { syncAllWearables } from "./wearables.js";

let schedulerStarted = false;

export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Daily WVU menu scrape at 06:00 AM EST = 11:00 UTC
  cron.schedule("0 11 * * *", async () => {
    console.log("[scheduler] Running daily menu scrape...");
    try {
      await scrapeAllLocations(todayString());
    } catch (err) {
      console.error("[scheduler] Daily scrape failed:", err);
    }
  });

  // Wearable sync every hour at :30
  cron.schedule("30 * * * *", async () => {
    console.log("[scheduler] Running wearable sync...");
    try {
      await syncAllWearables();
    } catch (err) {
      console.error("[scheduler] Wearable sync failed:", err);
    }
  });

  console.log("[scheduler] Background jobs registered");
}
