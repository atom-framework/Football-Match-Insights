import { Router, type IRouter } from "express";
import {
  GetFootballMatchQueryParams,
  GetFootballMatchResponse,
  GetFootballSourcesResponse,
  GetFootballSummaryQueryParams,
  GetFootballSummaryResponse,
  ListFootballLeaguesQueryParams,
  ListFootballLeaguesResponse,
  ListFootballMatchesQueryParams,
  ListFootballMatchesResponse,
} from "@workspace/api-zod";
import {
  getFootballMatchDetail,
  getFootballSources,
  getFootballSummary,
  isSourceUnavailable,
  isValidFootballDate,
  listFootballLeagues,
  listFootballMatches,
} from "../lib/football-data";

const router: IRouter = Router();

function badDate(): { error: string } {
  return { error: "Enter a valid calendar date in YYYY-MM-DD format." };
}

function serviceUnavailable(): { error: string } {
  return {
    error:
      "Football data feeds are temporarily unavailable. Please try again shortly.",
  };
}

router.get("/football/matches", async (req, res): Promise<void> => {
  const parsed = ListFootballMatchesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!isValidFootballDate(parsed.data.date)) {
    res.status(400).json(badDate());
    return;
  }

  try {
    const response = await listFootballMatches(parsed.data);
    res.json(ListFootballMatchesResponse.parse(response));
  } catch (error) {
    if (isSourceUnavailable(error)) {
      req.log.warn("Football data feed unavailable");
      res.status(503).json(serviceUnavailable());
      return;
    }
    req.log.error({ operation: "listFootballMatches" }, "Football request failed");
    res.status(503).json(serviceUnavailable());
  }
});

router.get("/football/match-detail", async (req, res): Promise<void> => {
  const parsed = GetFootballMatchQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!isValidFootballDate(parsed.data.date)) {
    res.status(400).json(badDate());
    return;
  }

  try {
    const response = await getFootballMatchDetail(
      parsed.data.matchId,
      parsed.data.date,
    );
    if (!response) {
      res.status(404).json({ error: "Match not found for the selected date." });
      return;
    }
    res.json(GetFootballMatchResponse.parse(response));
  } catch (error) {
    if (isSourceUnavailable(error)) {
      req.log.warn("Football detail feed unavailable");
      res.status(503).json(serviceUnavailable());
      return;
    }
    req.log.error({ operation: "getFootballMatch" }, "Football request failed");
    res.status(503).json(serviceUnavailable());
  }
});

router.get("/football/leagues", async (req, res): Promise<void> => {
  const parsed = ListFootballLeaguesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!isValidFootballDate(parsed.data.date)) {
    res.status(400).json(badDate());
    return;
  }

  try {
    const response = await listFootballLeagues(parsed.data.date);
    res.json(ListFootballLeaguesResponse.parse(response));
  } catch (error) {
    if (isSourceUnavailable(error)) {
      req.log.warn("Football league feed unavailable");
      res.status(503).json(serviceUnavailable());
      return;
    }
    req.log.error({ operation: "listFootballLeagues" }, "Football request failed");
    res.status(503).json(serviceUnavailable());
  }
});

router.get("/football/summary", async (req, res): Promise<void> => {
  const parsed = GetFootballSummaryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!isValidFootballDate(parsed.data.date)) {
    res.status(400).json(badDate());
    return;
  }

  try {
    const response = await getFootballSummary(parsed.data.date);
    res.json(GetFootballSummaryResponse.parse(response));
  } catch (error) {
    if (isSourceUnavailable(error)) {
      req.log.warn("Football summary feed unavailable");
      res.status(503).json(serviceUnavailable());
      return;
    }
    req.log.error({ operation: "getFootballSummary" }, "Football request failed");
    res.status(503).json(serviceUnavailable());
  }
});

router.get("/football/sources", (_req, res): void => {
  res.json(GetFootballSourcesResponse.parse(getFootballSources()));
});

export default router;
