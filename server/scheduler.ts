/**
 * Background job scheduler using node-cron.
 *
 * Jobs:
 *  1. Daily menu scrape at 06:00 AM EST (11:00 UTC)
 *
 * On Railway: These jobs run inside the same Node process.
 * Alternatively, set up a Railway Cron Service that hits POST /api/jobs/scrape
 * with the CRON_SECRET header for external triggering.
 */
import cron from "node-cron";
import { scrapeAllLocations, todayString } from "./scraper.js";

let schedulerStarted = false;

export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Daily WVU menu scrape at 06:00 AM EST = 11:00 UTC
  cron.schedule("0 11 * * *", async () => {
    const dateStr = todayString();
    console.log(`[scheduler] Running daily menu scrape for ${dateStr}...`);
    try {
      await scrapeAllLocations(dateStr);
      console.log(`[scheduler] Daily scrape completed for ${dateStr}`);
    } catch (err) {
      console.error("[scheduler] Daily scrape failed:", err);
    }
  });

  console.log("[scheduler] Background jobs registered");
}
