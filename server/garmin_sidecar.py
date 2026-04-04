#!/usr/bin/env python3
"""
Garmin Connect sidecar for wvu-dining-tracker.
Called by Node.js via child_process.spawn.

Usage:
  python3 garmin_sidecar.py login   <tokens_path>  (reads email/password from env GARMIN_EMAIL, GARMIN_PASSWORD)
  python3 garmin_sidecar.py sync    <tokens_path>  [YYYY-MM-DD]
  python3 garmin_sidecar.py sync    <tokens_path>  [YYYY-MM-DD]  (also tries yesterday if today empty)

Output: JSON to stdout. Errors also to stdout as {"ok": false, "error": "..."}.
"""

import sys
import os
import json
import traceback
from datetime import date, timedelta, datetime


def get_api():
    try:
        import garminconnect
        return garminconnect
    except ImportError:
        print(json.dumps({"ok": False, "error": "garminconnect not installed. Run: pip3 install garminconnect curl_cffi ua-generator"}))
        sys.exit(1)


def fmt_date(d):
    return d.strftime("%Y-%m-%d")


def login(tokens_path):
    email = os.environ.get("GARMIN_EMAIL", "")
    password = os.environ.get("GARMIN_PASSWORD", "")
    if not email or not password:
        print(json.dumps({"ok": False, "error": "GARMIN_EMAIL and GARMIN_PASSWORD env vars required"}))
        return

    garminconnect = get_api()
    try:
        api = garminconnect.Garmin(email, password)
        api.login()
        # Save tokens to file
        token_store = api.garth.dumps()
        os.makedirs(os.path.dirname(tokens_path), exist_ok=True)
        with open(tokens_path, "w") as f:
            f.write(token_store)
        print(json.dumps({"ok": True, "tokenPath": tokens_path}))
    except Exception as e:
        err = str(e)
        print(json.dumps({"ok": False, "error": err}))


def sync(tokens_path, target_date_str=None):
    garminconnect = get_api()

    if not os.path.exists(tokens_path):
        print(json.dumps({"ok": False, "error": "No saved session — please reconnect via username/password"}))
        return

    try:
        api = garminconnect.Garmin()
        with open(tokens_path, "r") as f:
            token_store = f.read()
        api.garth.loads(token_store)
        api.display_name  # trigger token validation
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Session load failed: {str(e)} — please reconnect"}))
        return

    if target_date_str:
        target_date = datetime.strptime(target_date_str, "%Y-%m-%d").date()
    else:
        target_date = date.today()

    yesterday = target_date - timedelta(days=1)

    result = {
        "ok": True,
        "date": fmt_date(target_date),
        "categories": [],
        "summary": {},
        "rawPayload": {},
    }

    summary = result["summary"]
    raw = result["rawPayload"]
    cats = result["categories"]

    # ── Steps ──────────────────────────────────────────────────────────────────
    try:
        steps_data = api.get_steps_data(fmt_date(target_date))
        if steps_data:
            total = 0
            for entry in steps_data:
                total += entry.get("steps", 0)
            if total > 0:
                summary["totalSteps"] = total
                cats.append("steps")
                raw["steps"] = steps_data
    except Exception as e:
        pass  # non-fatal

    # ── Daily Summary (calories, active minutes) ───────────────────────────────
    try:
        daily = api.get_user_summary(fmt_date(target_date))
        if daily:
            if daily.get("totalKilocalories"):
                summary["caloriesBurned"] = int(daily["totalKilocalories"])
            if daily.get("activeSeconds"):
                summary["activeMinutes"] = int(daily["activeSeconds"] / 60)
            if not summary.get("totalSteps") and daily.get("totalSteps"):
                summary["totalSteps"] = daily["totalSteps"]
                cats.append("steps")
            raw["dailySummary"] = daily
    except Exception as e:
        pass

    # ── Sleep (try today then yesterday) ──────────────────────────────────────
    sleep_fetched = False
    for sleep_date in [target_date, yesterday]:
        if sleep_fetched:
            break
        try:
            sleep = api.get_sleep_data(fmt_date(sleep_date))
            dto = sleep.get("dailySleepDTO") if sleep else None
            if dto:
                sleep_time = dto.get("sleepTimeSeconds")
                if sleep_time:
                    summary["sleepDurationMin"] = round(sleep_time / 60)
                    if dto.get("deepSleepSeconds"):
                        summary["deepSleepMin"] = round(dto["deepSleepSeconds"] / 60)
                    if dto.get("lightSleepSeconds"):
                        summary["lightSleepMin"] = round(dto["lightSleepSeconds"] / 60)
                    if dto.get("remSleepSeconds"):
                        summary["remSleepMin"] = round(dto["remSleepSeconds"] / 60)
                    if dto.get("awakeSleepSeconds"):
                        summary["awakeSleepMin"] = round(dto["awakeSleepSeconds"] / 60)
                    scores = dto.get("sleepScores", {})
                    if scores and scores.get("overall", {}).get("value"):
                        summary["sleepScore"] = scores["overall"]["value"]
                    if dto.get("avgSleepStress"):
                        summary["avgStress"] = round(dto["avgSleepStress"])
                    raw["sleep"] = dto
                    if sleep.get("sleepLevels"):
                        raw["sleepLevels"] = sleep["sleepLevels"]
                    if dto.get("sleepStartTimestampGMT"):
                        raw["sleepStartGMT"] = dto["sleepStartTimestampGMT"]
                    if dto.get("sleepEndTimestampGMT"):
                        raw["sleepEndGMT"] = dto["sleepEndTimestampGMT"]
                    if dto.get("sleepStartTimestampLocal"):
                        raw["sleepStartLocal"] = dto["sleepStartTimestampLocal"]
                    if dto.get("sleepEndTimestampLocal"):
                        raw["sleepEndLocal"] = dto["sleepEndTimestampLocal"]
                    cats.append("sleep")
                    sleep_fetched = True

                # HRV from sleep response
                if sleep and sleep.get("avgOvernightHrv") and not summary.get("avgOvernightHrv"):
                    summary["avgOvernightHrv"] = sleep["avgOvernightHrv"]
                    if sleep.get("hrvStatus"):
                        summary["hrvStatus"] = sleep["hrvStatus"]
                    if "hrv" not in cats:
                        cats.append("hrv")

                # Body battery from sleep
                bb = sleep.get("sleepBodyBattery", []) if sleep else []
                if bb and not summary.get("bodyBatteryHigh"):
                    values = [b["value"] for b in bb if b.get("value", 0) > 0]
                    if values:
                        summary["bodyBatteryHigh"] = max(values)
                        summary["bodyBatteryLow"] = min(values)
                        if "body_battery" not in cats:
                            cats.append("body_battery")

                if dto and dto.get("restingHeartRate") and not summary.get("restingHeartRate"):
                    summary["restingHeartRate"] = dto["restingHeartRate"]

        except Exception as e:
            pass

    # ── Heart Rate (try today then yesterday) ──────────────────────────────────
    hr_fetched = bool(summary.get("restingHeartRate"))
    for hr_date in [target_date, yesterday]:
        if hr_fetched:
            break
        try:
            hr = api.get_heart_rates(fmt_date(hr_date))
            if hr:
                if hr.get("restingHeartRate"):
                    summary["restingHeartRate"] = hr["restingHeartRate"]
                    hr_fetched = True
                if hr.get("maxHeartRate"):
                    summary["maxHeartRate"] = hr["maxHeartRate"]
                if hr.get("restingHeartRate") or hr.get("maxHeartRate"):
                    raw["heartRate"] = {"resting": hr.get("restingHeartRate"), "max": hr.get("maxHeartRate")}
                    if "heart_rate" not in cats:
                        cats.append("heart_rate")
        except Exception as e:
            pass

    # ── Weight ─────────────────────────────────────────────────────────────────
    try:
        weight_data = api.get_body_composition(fmt_date(target_date))
        entries = weight_data.get("dateWeightList", []) if weight_data else []
        if entries:
            w = entries[0]
            # Garmin returns weight in grams
            weight_g = w.get("weight")
            if weight_g:
                weight_kg = round(weight_g / 1000, 1)
                if 20 < weight_kg < 300:
                    summary["weightKg"] = weight_kg
                    if w.get("bodyFat"):
                        summary["bodyFatPct"] = round(w["bodyFat"], 1)
                    cats.append("weight")
                    raw["weight"] = w
    except Exception as e:
        pass

    # ── Activities ─────────────────────────────────────────────────────────────
    try:
        activities = api.get_activities(0, 5)
        if activities:
            recent = []
            today_cal = 0
            for a in activities:
                recent.append({
                    "name": a.get("activityName") or a.get("activityType", {}).get("typeKey", "Activity"),
                    "type": a.get("activityType", {}).get("typeKey", "unknown"),
                    "durationMin": round(a["duration"] / 60) if a.get("duration") else 0,
                    "calories": a.get("calories", 0),
                })
                start = a.get("startTimeLocal", "")
                if start.startswith(fmt_date(target_date)):
                    today_cal += a.get("calories", 0)
            summary["recentActivities"] = recent
            if today_cal > 0 and not summary.get("caloriesBurned"):
                summary["caloriesBurned"] = today_cal
            cats.append("activities")
            raw["activities"] = recent
    except Exception as e:
        pass

    # Save refreshed tokens
    try:
        with open(tokens_path, "w") as f:
            f.write(api.garth.dumps())
    except Exception:
        pass

    print(json.dumps(result))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: garmin_sidecar.py <login|sync> <tokens_path> [date]"}))
        sys.exit(1)

    command = sys.argv[1]
    tokens_path = sys.argv[2]
    date_arg = sys.argv[3] if len(sys.argv) > 3 else None

    if command == "login":
        login(tokens_path)
    elif command == "sync":
        sync(tokens_path, date_arg)
    else:
        print(json.dumps({"ok": False, "error": f"Unknown command: {command}"}))
        sys.exit(1)
