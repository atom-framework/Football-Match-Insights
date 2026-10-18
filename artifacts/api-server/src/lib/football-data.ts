import type {
  FootballLeague,
  FootballMatch,
  FootballMatchDetail,
  FootballMatchList,
  FootballSources,
  FootballSummary,
  FootballTeam,
  FootballTeamProfile,
  ProviderStatus,
} from "@workspace/api-zod";
import {
  makeHeadToHead,
  makePrediction,
  makeRecentMatches,
} from "./football-prediction";

type ExternalRecord = Record<string, unknown>;
type ProviderName = "TheSportsDB" | "ESPN";

interface CachedJson {
  value: ExternalRecord;
  expiresAt: number;
  staleUntil: number;
}

interface ProviderState {
  status: ProviderStatus["status"];
  lastSuccessAt: string | null;
  message: string | null;
}

interface DayData {
  matches: FootballMatch[];
  seasonEvents: ExternalRecord[];
  sources: ProviderStatus[];
  warnings: string[];
}

const SPORTSDB_URL = "https://www.thesportsdb.com";
const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/soccer";
const SPORTSDB_ATTRIBUTION = "https://www.thesportsdb.com/";
const ESPN_ATTRIBUTION = "https://www.espn.com/soccer/";
const FOOTBALL_METHOD =
  "An internal ensemble combines a Poisson goal model, recent home/away form, and head-to-head results when at least two verified meetings are available. No third-party prediction feed or bookmaker odds are used.";
const PREDICTION_DISCLAIMER =
  "Probabilities are estimates from historical data, not guarantees, official predictions, or bookmaker odds.";

const ESPN_LEAGUES = [
  { code: "eng.1", fallbackName: "English Premier League" },
  { code: "esp.1", fallbackName: "Spanish La Liga" },
  { code: "ita.1", fallbackName: "Italian Serie A" },
  { code: "ger.1", fallbackName: "German Bundesliga" },
  { code: "fra.1", fallbackName: "French Ligue 1" },
  { code: "uefa.champions", fallbackName: "UEFA Champions League" },
];

const cache = new Map<string, CachedJson>();
const pending = new Map<string, Promise<ExternalRecord>>();
const dayCache = new Map<string, { data: DayData; expiresAt: number }>();
const dayPending = new Map<string, Promise<DayData>>();

const providerState: Record<ProviderName, ProviderState> = {
  TheSportsDB: {
    status: process.env.THESPORTSDB_API_KEY ? "ready" : "unavailable",
    lastSuccessAt: null,
    message: process.env.THESPORTSDB_API_KEY
      ? "Configured; awaiting a data request."
      : "TheSportsDB API key is not configured.",
  },
  ESPN: {
    status: "ready",
    lastSuccessAt: null,
    message: "Public scoreboard feed; awaiting a data request.",
  },
};

class SourceUnavailableError extends Error {
  constructor(readonly provider: ProviderName) {
    super(`${provider} is unavailable`);
    this.name = "SourceUnavailableError";
  }
}

function markSuccess(provider: ProviderName): void {
  providerState[provider] = {
    status: "ready",
    lastSuccessAt: new Date().toISOString(),
    message: null,
  };
}

function markFailure(provider: ProviderName, configured = true): void {
  providerState[provider] = {
    status: configured ? "degraded" : "unavailable",
    lastSuccessAt: providerState[provider].lastSuccessAt,
    message: configured
      ? "The latest request failed; previously cached data may be shown."
      : "TheSportsDB API key is not configured.",
  };
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function asInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): ExternalRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as ExternalRecord;
  }
  return null;
}

function records(value: unknown): ExternalRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((item): item is ExternalRecord => item !== null);
}

function sourceIsConfigured(provider: ProviderName): boolean {
  return provider !== "TheSportsDB" || Boolean(process.env.THESPORTSDB_API_KEY);
}

async function requestJson(
  provider: ProviderName,
  cacheKey: string,
  url: string,
  freshForMs: number,
  staleForMs: number,
): Promise<ExternalRecord> {
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const existing = pending.get(cacheKey);
  if (existing) return existing;

  const request = (async (): Promise<ExternalRecord> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9_000);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new SourceUnavailableError(provider);

      const payload: unknown = await response.json();
      const result = asRecord(payload);
      if (!result) throw new SourceUnavailableError(provider);

      const receivedAt = Date.now();
      cache.set(cacheKey, {
        value: result,
        expiresAt: receivedAt + freshForMs,
        staleUntil: receivedAt + freshForMs + staleForMs,
      });
      markSuccess(provider);
      return result;
    } catch {
      markFailure(provider, sourceIsConfigured(provider));
      const stale = cache.get(cacheKey);
      if (stale && stale.staleUntil > Date.now()) return stale.value;
      throw new SourceUnavailableError(provider);
    }
  })();

  pending.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (pending.get(cacheKey) === request) pending.delete(cacheKey);
  }
}

function sportsDbUrl(endpoint: string): string {
  const key = process.env.THESPORTSDB_API_KEY;
  if (!key) {
    markFailure("TheSportsDB", false);
    throw new SourceUnavailableError("TheSportsDB");
  }
  return `${SPORTSDB_URL}/api/v1/json/${encodeURIComponent(key)}/${endpoint}`;
}

async function sportsDbJson(
  endpoint: string,
  cacheKey: string,
  freshForMs: number,
  staleForMs: number,
): Promise<ExternalRecord> {
  return requestJson(
    "TheSportsDB",
    `thesportsdb:${cacheKey}`,
    sportsDbUrl(endpoint),
    freshForMs,
    staleForMs,
  );
}

function normalizeTeamName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(afc|fc|cf|sc|football club|club)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeKickoff(value: unknown): string | null {
  const raw = asText(value);
  if (!raw) return null;
  if (/^\d{2}:\d{2}/.test(raw)) return raw.slice(0, 5);
  return raw;
}

function sportsDbStatus(event: ExternalRecord): FootballMatch["status"] {
  const status = (asText(event.strStatus) ?? "").toLowerCase();
  if (status.includes("postpon")) return "postponed";
  if (status.includes("cancel") || status.includes("abandon")) return "canceled";
  if (
    status.includes("half time") ||
    status.includes("1st half") ||
    status.includes("2nd half") ||
    status.includes("live") ||
    status.includes("extra time") ||
    status.includes("penalt")
  ) {
    return "live";
  }
  if (
    status.includes("finished") ||
    status.includes("full time") ||
    status === "ft" ||
    status === "aet" ||
    status === "after extra time"
  ) {
    return "finished";
  }
  if (
    status.includes("not started") ||
    status.includes("scheduled") ||
    status === "ns"
  ) {
    return "upcoming";
  }
  const eventDate = asText(event.dateEvent);
  const hasScore =
    asInteger(event.intHomeScore) !== null &&
    asInteger(event.intAwayScore) !== null;
  if (eventDate && eventDate > new Date().toISOString().slice(0, 10)) {
    return "upcoming";
  }
  if (eventDate && eventDate < new Date().toISOString().slice(0, 10) && hasScore) {
    return "finished";
  }
  return "unknown";
}

function espnStatus(event: ExternalRecord): FootballMatch["status"] {
  const competition = records(event.competitions)[0];
  const status = asRecord(competition?.status);
  const type = asRecord(status?.type);
  const state = (asText(type?.state) ?? "").toLowerCase();
  const detail = (asText(type?.detail) ?? "").toLowerCase();
  if (detail.includes("postpon")) return "postponed";
  if (detail.includes("cancel") || detail.includes("abandon")) return "canceled";
  if (state === "in") return "live";
  if (state === "post") return "finished";
  if (state === "pre") return "upcoming";
  return "unknown";
}

function emptyPrediction(): FootballMatch["prediction"] {
  return {
    probabilities: { home: 47, draw: 28, away: 25 },
    confidence: 22,
    confidenceLabel: "low",
    model: "Goals + home/away form + head-to-head aggregate (v1)",
    factors: [],
    disclaimer: PREDICTION_DISCLAIMER,
  };
}

function normalizeSportsDbEvent(
  event: ExternalRecord,
  requestedDate: string,
): FootballMatch | null {
  const eventId = asText(event.idEvent);
  const homeName = asText(event.strHomeTeam);
  const awayName = asText(event.strAwayTeam);
  if (!eventId || !homeName || !awayName) return null;

  const date = asText(event.dateEvent) ?? requestedDate;
  const leagueName = asText(event.strLeague) ?? "Competition not listed";
  const homeTeam: FootballTeam = {
    id: asText(event.idHomeTeam),
    name: homeName,
    shortName: asText(event.strHomeTeamShort),
    badgeUrl: asText(event.strHomeTeamBadge),
    country: asText(event.strCountry),
  };
  const awayTeam: FootballTeam = {
    id: asText(event.idAwayTeam),
    name: awayName,
    shortName: asText(event.strAwayTeamShort),
    badgeUrl: asText(event.strAwayTeamBadge),
    country: asText(event.strCountry),
  };

  return {
    id: `thesportsdb-${eventId}`,
    sourceEventId: eventId,
    primarySource: "TheSportsDB",
    sources: ["TheSportsDB"],
    sourceUrls: [`https://www.thesportsdb.com/event/${encodeURIComponent(eventId)}`],
    homeTeam,
    awayTeam,
    league: {
      id: asText(event.idLeague),
      name: leagueName,
      country: asText(event.strCountry),
      badgeUrl: asText(event.strLeagueBadge),
      source: "TheSportsDB",
    },
    date,
    kickoffLocal:
      normalizeKickoff(event.strTimeLocal) ?? normalizeKickoff(event.strTime),
    status: sportsDbStatus(event),
    venue: asText(event.strVenue),
    round: asText(event.intRound),
    season: asText(event.strSeason),
    homeScore: asInteger(event.intHomeScore),
    awayScore: asInteger(event.intAwayScore),
    prediction: emptyPrediction(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeEspnEvent(
  event: ExternalRecord,
  leagueCode: string,
  fallbackLeagueName: string,
  requestedDate: string,
): FootballMatch | null {
  const eventId = asText(event.id);
  const competition = records(event.competitions)[0];
  const competitors = records(competition?.competitors);
  const home = competitors.find(
    (competitor) => asText(competitor.homeAway) === "home",
  );
  const away = competitors.find(
    (competitor) => asText(competitor.homeAway) === "away",
  );
  const homeTeamData = asRecord(home?.team);
  const awayTeamData = asRecord(away?.team);
  const homeName =
    asText(homeTeamData?.displayName) ??
    asText(homeTeamData?.name) ??
    asText(home?.displayName);
  const awayName =
    asText(awayTeamData?.displayName) ??
    asText(awayTeamData?.name) ??
    asText(away?.displayName);
  if (!eventId || !homeName || !awayName) return null;

  const eventDate = asText(event.date);
  const kickoff = eventDate ? new Date(eventDate) : null;
  const kickoffText =
    kickoff && !Number.isNaN(kickoff.getTime())
      ? `${new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "UTC",
          hourCycle: "h23",
        }).format(kickoff)} UTC`
      : null;

  const leagueData = records(event.leagues)[0];
  const venue = asRecord(competition?.venue);
  const leagueName =
    asText(leagueData?.name) ?? asText(leagueData?.shortName) ?? fallbackLeagueName;

  return {
    id: `espn-${leagueCode.replace(/[^a-z0-9.-]/gi, "-")}-${eventId}`,
    sourceEventId: eventId,
    primarySource: "ESPN",
    sources: ["ESPN"],
    sourceUrls: [
      `https://www.espn.com/soccer/match/_/gameId/${encodeURIComponent(eventId)}`,
    ],
    homeTeam: {
      id: asText(homeTeamData?.id)
        ? `espn:${asText(homeTeamData?.id)}`
        : null,
      name: homeName,
      shortName: asText(homeTeamData?.shortDisplayName),
      badgeUrl: asText(homeTeamData?.logo),
      country: asText(homeTeamData?.location),
    },
    awayTeam: {
      id: asText(awayTeamData?.id)
        ? `espn:${asText(awayTeamData?.id)}`
        : null,
      name: awayName,
      shortName: asText(awayTeamData?.shortDisplayName),
      badgeUrl: asText(awayTeamData?.logo),
      country: asText(awayTeamData?.location),
    },
    league: {
      id: leagueCode,
      name: leagueName,
      country: asText(leagueData?.abbreviation),
      badgeUrl: asText(leagueData?.logo),
      source: "ESPN",
    },
    date: requestedDate,
    kickoffLocal: kickoffText,
    status: espnStatus(event),
    venue: asText(venue?.fullName),
    round: null,
    season: null,
    homeScore: asInteger(home?.score),
    awayScore: asInteger(away?.score),
    prediction: emptyPrediction(),
    updatedAt: new Date().toISOString(),
  };
}

async function readSportsDbEventsForDate(date: string): Promise<ExternalRecord[]> {
  const params = new URLSearchParams({ d: date, s: "Soccer" });
  const payload = await sportsDbJson(
    `eventsday.php?${params.toString()}`,
    `eventsday:${date}`,
    2 * 60_000,
    30 * 60_000,
  );
  return records(payload.events);
}

async function readEspnEventsForDate(date: string): Promise<{
  events: Array<{ event: ExternalRecord; leagueCode: string; leagueName: string }>;
  failures: number;
  successes: number;
}> {
  const dateParam = date.replaceAll("-", "");
  let cursor = 0;
  const results: Array<{
    event: ExternalRecord;
    leagueCode: string;
    leagueName: string;
  }> = [];
  let successes = 0;
  let failures = 0;

  await Promise.all(
    Array.from({ length: Math.min(3, ESPN_LEAGUES.length) }, async () => {
      while (cursor < ESPN_LEAGUES.length) {
        const league = ESPN_LEAGUES[cursor++];
        if (!league) continue;
        const params = new URLSearchParams({ dates: dateParam });
        try {
          const payload = await requestJson(
            "ESPN",
            `espn:${league.code}:${date}`,
            `${ESPN_URL}/${league.code}/scoreboard?${params.toString()}`,
            2 * 60_000,
            10 * 60_000,
          );
          successes += 1;
          for (const event of records(payload.events)) {
            results.push({
              event,
              leagueCode: league.code,
              leagueName: league.fallbackName,
            });
          }
        } catch {
          failures += 1;
        }
      }
    }),
  );

  if (successes > 0 && failures > 0) {
    markFailure("ESPN");
  } else if (successes > 0) {
    markSuccess("ESPN");
  }
  if (successes === 0) throw new SourceUnavailableError("ESPN");
  return { events: results, failures, successes };
}

function espnCompetitorScore(competitor: ExternalRecord | undefined): number | null {
  const score = asRecord(competitor?.score);
  return (
    asInteger(score?.value) ??
    asInteger(score?.displayValue) ??
    asInteger(competitor?.score)
  );
}

function normalizeEspnHistoryEvent(
  event: ExternalRecord,
  leagueCode: string,
): ExternalRecord | null {
  const eventId = asText(event.id);
  const eventDate = asText(event.date)?.slice(0, 10);
  const competition = records(event.competitions)[0];
  const competitors = records(competition?.competitors);
  const home = competitors.find(
    (competitor) => asText(competitor.homeAway) === "home",
  );
  const away = competitors.find(
    (competitor) => asText(competitor.homeAway) === "away",
  );
  const homeTeam = asRecord(home?.team);
  const awayTeam = asRecord(away?.team);
  const homeName = asText(homeTeam?.displayName) ?? asText(homeTeam?.name);
  const awayName = asText(awayTeam?.displayName) ?? asText(awayTeam?.name);
  const homeScore = espnCompetitorScore(home);
  const awayScore = espnCompetitorScore(away);
  if (
    !eventId ||
    !eventDate ||
    !homeName ||
    !awayName ||
    homeScore === null ||
    awayScore === null
  ) {
    return null;
  }

  return {
    idEvent: `espn-${leagueCode}-${eventId}`,
    dateEvent: eventDate,
    idHomeTeam: asText(homeTeam?.id) ?? asText(home?.id)
      ? `espn:${asText(homeTeam?.id) ?? asText(home?.id)}`
      : null,
    idAwayTeam: asText(awayTeam?.id) ?? asText(away?.id)
      ? `espn:${asText(awayTeam?.id) ?? asText(away?.id)}`
      : null,
    strHomeTeam: homeName,
    strAwayTeam: awayName,
    intHomeScore: homeScore,
    intAwayScore: awayScore,
    source: "ESPN",
  };
}

async function readEspnTeamHistories(
  matches: FootballMatch[],
): Promise<{ events: ExternalRecord[]; failures: number }> {
  const teams = new Map<string, { leagueCode: string; teamId: string }>();
  for (const match of matches) {
    if (match.primarySource !== "ESPN" || !match.league.id) continue;
    for (const team of [match.homeTeam, match.awayTeam]) {
      const rawId = team.id?.replace(/^espn:/, "");
      if (!rawId || !/^\d+$/.test(rawId)) continue;
      teams.set(`${match.league.id}:${rawId}`, {
        leagueCode: match.league.id,
        teamId: rawId,
      });
    }
  }

  let failures = 0;
  const eventSets = await mapWithLimit(
    Array.from(teams.entries()),
    5,
    async ([cacheKey, team]) => {
      try {
        const payload = await requestJson(
          "ESPN",
          `espn-team-schedule:${cacheKey}`,
          `${ESPN_URL}/${team.leagueCode}/teams/${team.teamId}/schedule`,
          30 * 60_000,
          12 * 60 * 60_000,
        );
        return records(payload.events)
          .map((event) => normalizeEspnHistoryEvent(event, team.leagueCode))
          .filter((event): event is ExternalRecord => event !== null);
      } catch {
        failures += 1;
        return [];
      }
    },
  );
  if (failures > 0) markFailure("ESPN");

  const unique = new Map<string, ExternalRecord>();
  for (const event of eventSets.flat()) {
    const id = asText(event.idEvent);
    if (id) unique.set(id, event);
  }
  return { events: Array.from(unique.values()), failures };
}

function seasonForDate(date: string): string {
  const [yearPart, monthPart] = date.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        const item = items[index];
        if (item !== undefined) output[index] = await mapper(item);
      }
    }),
  );
  return output;
}

async function readSeasonEvents(matches: FootballMatch[]): Promise<ExternalRecord[]> {
  const seasons = new Map<string, { leagueId: string; season: string }>();
  for (const match of matches) {
    if (match.primarySource !== "TheSportsDB" || !match.league.id) continue;
    const season = match.season ?? seasonForDate(match.date);
    seasons.set(`${match.league.id}:${season}`, {
      leagueId: match.league.id,
      season,
    });
  }

  const selected = Array.from(seasons.entries()).slice(0, 12);
  let failures = 0;
  const eventSets = await mapWithLimit(selected, 3, async ([cacheKey, value]) => {
    const params = new URLSearchParams({
      id: value.leagueId,
      s: value.season,
    });
    try {
      const payload = await sportsDbJson(
        `eventsseason.php?${params.toString()}`,
        `season:${cacheKey}`,
        6 * 60 * 60_000,
        7 * 24 * 60 * 60_000,
      );
      return records(payload.events);
    } catch {
      failures += 1;
      return [];
    }
  });
  if (failures > 0) markFailure("TheSportsDB");

  const unique = new Map<string, ExternalRecord>();
  for (const event of eventSets.flat()) {
    const id = asText(event.idEvent);
    if (id) unique.set(id, event);
  }
  return Array.from(unique.values());
}

function mergeMatches(primary: FootballMatch[], supplemental: FootballMatch[]) {
  const combined = new Map<string, FootballMatch>();
  for (const match of primary) {
    const key = `${match.date}:${normalizeTeamName(match.homeTeam.name)}:${normalizeTeamName(match.awayTeam.name)}`;
    combined.set(key, match);
  }

  for (const supplementalMatch of supplemental) {
    const key = `${supplementalMatch.date}:${normalizeTeamName(supplementalMatch.homeTeam.name)}:${normalizeTeamName(supplementalMatch.awayTeam.name)}`;
    const existing = combined.get(key);
    if (!existing) {
      combined.set(key, supplementalMatch);
      continue;
    }
    existing.sources = Array.from(
      new Set([...existing.sources, ...supplementalMatch.sources]),
    );
    existing.sourceUrls = Array.from(
      new Set([...existing.sourceUrls, ...supplementalMatch.sourceUrls]),
    );
    if (existing.homeScore === null) existing.homeScore = supplementalMatch.homeScore;
    if (existing.awayScore === null) existing.awayScore = supplementalMatch.awayScore;
    if (existing.status === "unknown") existing.status = supplementalMatch.status;
    if (existing.venue === null) existing.venue = supplementalMatch.venue;
    if (existing.kickoffLocal === null) {
      existing.kickoffLocal = supplementalMatch.kickoffLocal;
    }
    if (existing.homeTeam.badgeUrl === null) {
      existing.homeTeam.badgeUrl = supplementalMatch.homeTeam.badgeUrl;
    }
    if (existing.awayTeam.badgeUrl === null) {
      existing.awayTeam.badgeUrl = supplementalMatch.awayTeam.badgeUrl;
    }
  }
  return Array.from(combined.values()).sort((left, right) => {
    const kickoffOrder = (left.kickoffLocal ?? "").localeCompare(
      right.kickoffLocal ?? "",
    );
    return kickoffOrder || left.league.name.localeCompare(right.league.name);
  });
}

function dedupeHistoricalEvents(events: ExternalRecord[]): ExternalRecord[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const date = asText(event.dateEvent);
    const homeName = asText(event.strHomeTeam);
    const awayName = asText(event.strAwayTeam);
    const homeScore = asInteger(event.intHomeScore);
    const awayScore = asInteger(event.intAwayScore);
    if (
      !date ||
      !homeName ||
      !awayName ||
      homeScore === null ||
      awayScore === null
    ) {
      return true;
    }
    const key = [
      date,
      normalizeTeamName(homeName),
      normalizeTeamName(awayName),
      homeScore,
      awayScore,
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function providerStatuses(): ProviderStatus[] {
  return [
    {
      name: "TheSportsDB",
      status: providerState.TheSportsDB.status,
      attributionUrl: SPORTSDB_ATTRIBUTION,
      purpose: "Primary fixtures, event details, team profiles, and historical match results.",
      lastSuccessAt: providerState.TheSportsDB.lastSuccessAt,
      message: providerState.TheSportsDB.message,
    },
    {
      name: "ESPN",
      status: providerState.ESPN.status,
      attributionUrl: ESPN_ATTRIBUTION,
      purpose: "Supplementary scoreboards, team schedules, and result cross-checks for selected competitions.",
      lastSuccessAt: providerState.ESPN.lastSuccessAt,
      message: providerState.ESPN.message,
    },
  ];
}

async function getDayData(date: string): Promise<DayData> {
  const now = Date.now();
  const existingDay = dayCache.get(date);
  if (existingDay && existingDay.expiresAt > now) return existingDay.data;
  const existingRequest = dayPending.get(date);
  if (existingRequest) return existingRequest;

  const request = (async (): Promise<DayData> => {
    const warnings: string[] = [];
    const [sportsDbResult, espnResult] = await Promise.allSettled([
      readSportsDbEventsForDate(date),
      readEspnEventsForDate(date),
    ]);

    let sportsDbEvents: ExternalRecord[] = [];
    let espnEvents: Array<{
      event: ExternalRecord;
      leagueCode: string;
      leagueName: string;
    }> = [];
    if (sportsDbResult.status === "fulfilled") {
      sportsDbEvents = sportsDbResult.value;
    } else {
      warnings.push(
        "TheSportsDB did not respond. Available ESPN data is shown where possible.",
      );
    }
    let espnFailures = 0;
    if (espnResult.status === "fulfilled") {
      espnEvents = espnResult.value.events;
      espnFailures = espnResult.value.failures;
      if (espnFailures > 0) {
        warnings.push(
          "ESPN returned partial coverage; some supported competitions may be missing.",
        );
      }
    } else {
      warnings.push(
        "The supplementary ESPN feed is unavailable. Fixture coverage may be incomplete.",
      );
    }

    if (
      sportsDbResult.status === "rejected" &&
      espnResult.status === "rejected"
    ) {
      throw new SourceUnavailableError("TheSportsDB");
    }

    const primary = sportsDbEvents
      .map((event) => normalizeSportsDbEvent(event, date))
      .filter((match): match is FootballMatch => match !== null);
    const supplemental = espnEvents
      .map(({ event, leagueCode, leagueName }) =>
        normalizeEspnEvent(event, leagueCode, leagueName, date),
      )
      .filter((match): match is FootballMatch => match !== null);
    const matches = mergeMatches(primary, supplemental);
    const [sportsDbHistory, espnHistory] = await Promise.all([
      readSeasonEvents(matches),
      readEspnTeamHistories(supplemental),
    ]);
    if (espnHistory.failures > 0) {
      warnings.push(
        "Some ESPN team schedules were unavailable; affected estimates use less recent-form data.",
      );
    }
    const seasonEvents = dedupeHistoricalEvents([
      ...sportsDbHistory,
      ...espnHistory.events,
    ]);
    for (const match of matches) {
      match.prediction = makePrediction(match, seasonEvents);
    }

    if (espnFailures > 0 && espnFailures === ESPN_LEAGUES.length) {
      markFailure("ESPN");
    }
    const data = {
      matches,
      seasonEvents,
      sources: providerStatuses(),
      warnings,
    };
    dayCache.set(date, { data, expiresAt: Date.now() + 90_000 });
    return data;
  })();

  dayPending.set(date, request);
  try {
    return await request;
  } finally {
    if (dayPending.get(date) === request) dayPending.delete(date);
  }
}

export async function listFootballMatches(options: {
  date: string;
  league?: string;
  search?: string;
  status?: string;
}): Promise<FootballMatchList> {
  const data = await getDayData(options.date);
  const league = options.league?.trim().toLocaleLowerCase();
  const search = options.search?.trim().toLocaleLowerCase();
  const status = options.status ?? "all";

  const matches = data.matches.filter((match) => {
    if (
      league &&
      league !== "all" &&
      match.league.name.toLocaleLowerCase() !== league &&
      match.league.id?.toLocaleLowerCase() !== league
    ) {
      return false;
    }
    if (
      status === "upcoming" &&
      match.status !== "upcoming" &&
      match.status !== "unknown"
    ) {
      return false;
    }
    if (
      status === "live" &&
      match.status !== "live" &&
      match.status !== "paused"
    ) {
      return false;
    }
    if (
      status === "finished" &&
      match.status !== "finished"
    ) {
      return false;
    }
    if (
      search &&
      !`${match.homeTeam.name} ${match.awayTeam.name} ${match.league.name}`
        .toLocaleLowerCase()
        .includes(search)
    ) {
      return false;
    }
    return true;
  });

  return {
    date: options.date,
    matches,
    sources: data.sources,
    warnings: data.warnings,
    refreshedAt: new Date().toISOString(),
  };
}

export async function listFootballLeagues(
  date: string,
): Promise<{ date: string; leagues: FootballLeague[] }> {
  const data = await getDayData(date);
  const leagues = new Map<string, FootballLeague>();
  for (const match of data.matches) {
    const key = `${match.league.id ?? match.league.name}:${match.league.name}`;
    leagues.set(key, match.league);
  }
  return {
    date,
    leagues: Array.from(leagues.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

export async function getFootballSummary(date: string): Promise<FootballSummary> {
  const data = await getDayData(date);
  const totals = data.matches.reduce(
    (result, match) => {
      if (match.status === "live" || match.status === "paused") result.live += 1;
      else if (match.status === "finished") result.finished += 1;
      else result.upcoming += 1;
      result.home += match.prediction.probabilities.home;
      result.draw += match.prediction.probabilities.draw;
      result.away += match.prediction.probabilities.away;
      return result;
    },
    { live: 0, finished: 0, upcoming: 0, home: 0, draw: 0, away: 0 },
  );
  const count = data.matches.length;
  return {
    date,
    totalMatches: count,
    upcomingMatches: totals.upcoming,
    liveMatches: totals.live,
    finishedMatches: totals.finished,
    averageHomeProbability: count ? Math.round(totals.home / count) : 0,
    averageDrawProbability: count ? Math.round(totals.draw / count) : 0,
    averageAwayProbability: count ? Math.round(totals.away / count) : 0,
    sources: data.sources,
  };
}

export function getFootballSources(): FootballSources {
  return {
    providers: providerStatuses(),
    predictionMethod: FOOTBALL_METHOD,
    predictionDisclaimer: PREDICTION_DISCLAIMER,
  };
}

function fallbackTeamProfile(
  team: FootballTeam,
  match: FootballMatch,
  recentMatches: FootballTeamProfile["recentMatches"],
): FootballTeamProfile {
  return {
    id: team.id,
    name: team.name,
    country: team.country,
    badgeUrl: team.badgeUrl,
    stadium: null,
    formedYear: null,
    description: null,
    recentMatches,
  };
}

async function getSportsDbTeamProfile(
  team: FootballTeam,
  match: FootballMatch,
  recentMatches: FootballTeamProfile["recentMatches"],
): Promise<FootballTeamProfile> {
  if (
    match.primarySource !== "TheSportsDB" ||
    !team.id ||
    !/^\d+$/.test(team.id)
  ) {
    return fallbackTeamProfile(team, match, recentMatches);
  }

  const params = new URLSearchParams({ id: team.id });
  try {
    const payload = await sportsDbJson(
      `lookupteam.php?${params.toString()}`,
      `team:${team.id}`,
      24 * 60 * 60_000,
      7 * 24 * 60 * 60_000,
    );
    const source = records(payload.teams)[0];
    if (!source) return fallbackTeamProfile(team, match, recentMatches);
    return {
      id: asText(source.idTeam) ?? team.id,
      name: asText(source.strTeam) ?? team.name,
      country: asText(source.strCountry) ?? team.country,
      badgeUrl:
        asText(source.strBadge) ??
        asText(source.strTeamBadge) ??
        team.badgeUrl,
      stadium: asText(source.strStadium),
      formedYear: asText(source.intFormedYear),
      description:
        asText(source.strDescriptionEN) ?? asText(source.strDescription),
      recentMatches,
    };
  } catch {
    return fallbackTeamProfile(team, match, recentMatches);
  }
}

export async function getFootballMatchDetail(
  matchId: string,
  date: string,
): Promise<FootballMatchDetail | null> {
  const data = await getDayData(date);
  const match = data.matches.find((candidate) => candidate.id === matchId);
  if (!match) return null;

  const homeRecent = makeRecentMatches(
    match.homeTeam,
    match.date,
    data.seasonEvents,
  );
  const awayRecent = makeRecentMatches(
    match.awayTeam,
    match.date,
    data.seasonEvents,
  );
  const [homeTeamProfile, awayTeamProfile] = await Promise.all([
    getSportsDbTeamProfile(match.homeTeam, match, homeRecent),
    getSportsDbTeamProfile(match.awayTeam, match, awayRecent),
  ]);
  const headToHead = makeHeadToHead(
    match.homeTeam,
    match.awayTeam,
    match.date,
    data.seasonEvents,
  );

  return {
    match,
    homeTeamProfile,
    awayTeamProfile,
    headToHead,
    sources: providerStatuses(),
    warnings: data.warnings,
  };
}

export function isSourceUnavailable(error: unknown): boolean {
  return error instanceof SourceUnavailableError;
}

export function isValidFootballDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
