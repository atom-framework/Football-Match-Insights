import type {
  FootballMatch,
  PredictionEstimate,
  RecentMatch,
} from "@workspace/api-zod";

type ExternalEvent = Record<string, unknown>;

interface RecentRecord {
  event: ExternalEvent;
  date: string;
  location: "home" | "away";
  scoreFor: number;
  scoreAgainst: number;
}

const PREDICTION_DISCLAIMER =
  "Model estimates from recorded goals, recent home/away form, and verified head-to-head results when available. These are not bookmaker odds or guarantees.";

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function integer(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function canonicalTeamName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(afc|fc|cf|sc|football club|club)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function sameTeam(
  eventId: unknown,
  eventName: unknown,
  teamId: string | null,
  teamName: string,
): boolean {
  const normalizedEventId = text(eventId);
  if (teamId && normalizedEventId && teamId === normalizedEventId) return true;
  const normalizedEventName = text(eventName);
  return (
    normalizedEventName !== null &&
    canonicalTeamName(normalizedEventName) === canonicalTeamName(teamName)
  );
}

function resultFor(scoreFor: number, scoreAgainst: number): "W" | "D" | "L" {
  if (scoreFor > scoreAgainst) return "W";
  if (scoreFor < scoreAgainst) return "L";
  return "D";
}

function getRecord(
  event: ExternalEvent,
  date: string,
  teamId: string | null,
  teamName: string,
): RecentRecord | null {
  const eventDate = text(event.dateEvent);
  if (!eventDate || eventDate >= date) return null;

  const homeScore = integer(event.intHomeScore);
  const awayScore = integer(event.intAwayScore);
  if (homeScore === null || awayScore === null) return null;

  if (
    sameTeam(event.idHomeTeam, event.strHomeTeam, teamId, teamName)
  ) {
    return {
      event,
      date: eventDate,
      location: "home",
      scoreFor: homeScore,
      scoreAgainst: awayScore,
    };
  }
  if (
    sameTeam(event.idAwayTeam, event.strAwayTeam, teamId, teamName)
  ) {
    return {
      event,
      date: eventDate,
      location: "away",
      scoreFor: awayScore,
      scoreAgainst: homeScore,
    };
  }
  return null;
}

function recentRecords(
  team: FootballMatch["homeTeam"],
  date: string,
  events: ExternalEvent[],
  limit = 5,
): RecentRecord[] {
  const records = events
    .map((event) => {
      const eventDate = text(event.dateEvent);
      if (!eventDate || eventDate >= date) return null;
      return getRecord(event, date, team.id, team.name);
    })
    .filter((record): record is RecentRecord => record !== null)
    .sort((left, right) => right.date.localeCompare(left.date));
  const seen = new Set<string>();
  return records
    .filter((record) => {
      const key = `${record.date}:${record.location}:${record.scoreFor}:${record.scoreAgainst}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function pointsPerGame(records: RecentRecord[]): number | null {
  if (records.length === 0) return null;
  const points = records.reduce((total, record) => {
    const result = resultFor(record.scoreFor, record.scoreAgainst);
    return total + (result === "W" ? 3 : result === "D" ? 1 : 0);
  }, 0);
  return points / records.length;
}

function eventGoals(events: ExternalEvent[], date: string): {
  home: number[];
  away: number[];
} {
  const home: number[] = [];
  const away: number[] = [];
  for (const event of events) {
    const eventDate = text(event.dateEvent);
    if (!eventDate || eventDate >= date) continue;
    const homeScore = integer(event.intHomeScore);
    const awayScore = integer(event.intAwayScore);
    if (homeScore === null || awayScore === null) continue;
    home.push(homeScore);
    away.push(awayScore);
  }
  return { home, away };
}

function poisson(lambda: number, goals: number): number {
  let value = Math.exp(-lambda);
  for (let index = 1; index <= goals; index += 1) {
    value *= lambda / index;
  }
  return value;
}

function goalProbabilities(homeExpectedGoals: number, awayExpectedGoals: number) {
  const maxGoals = 9;
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let homeGoals = 0; homeGoals <= maxGoals; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= maxGoals; awayGoals += 1) {
      const likelihood =
        poisson(homeExpectedGoals, homeGoals) *
        poisson(awayExpectedGoals, awayGoals);
      if (homeGoals > awayGoals) home += likelihood;
      else if (homeGoals < awayGoals) away += likelihood;
      else draw += likelihood;
    }
  }
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

function formProbabilities(difference: number) {
  const tilt = Math.tanh(difference / 1.35);
  const home = 0.46 + 0.15 * tilt;
  const away = 0.25 - 0.09 * tilt;
  const draw = Math.max(0.16, 1 - home - away);
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

function headToHeadProbabilities(
  homeTeam: FootballMatch["homeTeam"],
  awayTeam: FootballMatch["awayTeam"],
  date: string,
  events: ExternalEvent[],
) {
  const counts = { home: 1.6, draw: 1.4, away: 1.2 };
  let matches = 0;
  for (const event of events) {
    const eventDate = text(event.dateEvent);
    if (!eventDate || eventDate >= date) continue;

    const homeScore = integer(event.intHomeScore);
    const awayScore = integer(event.intAwayScore);
    if (homeScore === null || awayScore === null) continue;

    const eventHomeIsCurrentHome = sameTeam(
      event.idHomeTeam,
      event.strHomeTeam,
      homeTeam.id,
      homeTeam.name,
    );
    const eventAwayIsCurrentAway = sameTeam(
      event.idAwayTeam,
      event.strAwayTeam,
      awayTeam.id,
      awayTeam.name,
    );
    const eventHomeIsCurrentAway = sameTeam(
      event.idHomeTeam,
      event.strHomeTeam,
      awayTeam.id,
      awayTeam.name,
    );
    const eventAwayIsCurrentHome = sameTeam(
      event.idAwayTeam,
      event.strAwayTeam,
      homeTeam.id,
      homeTeam.name,
    );

    if (!(eventHomeIsCurrentHome && eventAwayIsCurrentAway) &&
      !(eventHomeIsCurrentAway && eventAwayIsCurrentHome)) {
      continue;
    }

    const currentHomeScore = eventHomeIsCurrentHome ? homeScore : awayScore;
    const currentAwayScore = eventHomeIsCurrentHome ? awayScore : homeScore;
    if (currentHomeScore > currentAwayScore) counts.home += 1;
    else if (currentHomeScore < currentAwayScore) counts.away += 1;
    else counts.draw += 1;
    matches += 1;
  }
  const total = counts.home + counts.draw + counts.away;
  return {
    matches,
    probabilities: {
      home: counts.home / total,
      draw: counts.draw / total,
      away: counts.away / total,
    },
  };
}

function roundedPercentages(probabilities: {
  home: number;
  draw: number;
  away: number;
}) {
  const entries = Object.entries(probabilities) as [
    "home" | "draw" | "away",
    number,
  ][];
  const rounded = entries.map(([key, value]) => ({
    key,
    value: Math.floor(value * 100),
    remainder: value * 100 - Math.floor(value * 100),
  }));
  let left = 100 - rounded.reduce((total, item) => total + item.value, 0);
  rounded
    .slice()
    .sort((first, second) => second.remainder - first.remainder)
    .forEach((item) => {
      if (left > 0) {
        const target = rounded.find((candidate) => candidate.key === item.key);
        if (target) target.value += 1;
        left -= 1;
      }
    });
  return {
    home: rounded.find((item) => item.key === "home")!.value,
    draw: rounded.find((item) => item.key === "draw")!.value,
    away: rounded.find((item) => item.key === "away")!.value,
  };
}

export function makePrediction(
  match: FootballMatch,
  events: ExternalEvent[],
): PredictionEstimate {
  const homeRecent = recentRecords(match.homeTeam, match.date, events);
  const awayRecent = recentRecords(match.awayTeam, match.date, events);
  const leagueGoals = eventGoals(events, match.date);

  const homeAtHome = homeRecent.filter((record) => record.location === "home");
  const awayAway = awayRecent.filter((record) => record.location === "away");
  const homeAttackRecords = homeAtHome.length ? homeAtHome : homeRecent;
  const awayAttackRecords = awayAway.length ? awayAway : awayRecent;
  const homeDefenceRecords = homeAtHome.length ? homeAtHome : homeRecent;
  const awayDefenceRecords = awayAway.length ? awayAway : awayRecent;

  const leagueHomeAverage = average(leagueGoals.home) ?? 1.42;
  const leagueAwayAverage = average(leagueGoals.away) ?? 1.12;
  const homeAttack =
    average(homeAttackRecords.map((record) => record.scoreFor)) ??
    leagueHomeAverage;
  const awayDefence =
    average(awayDefenceRecords.map((record) => record.scoreAgainst)) ??
    leagueHomeAverage;
  const awayAttack =
    average(awayAttackRecords.map((record) => record.scoreFor)) ??
    leagueAwayAverage;
  const homeDefence =
    average(homeDefenceRecords.map((record) => record.scoreAgainst)) ??
    leagueAwayAverage;

  const homeExpectedGoals = Math.min(
    4.5,
    Math.max(0.2, (homeAttack + awayDefence) / 2),
  );
  const awayExpectedGoals = Math.min(
    4.5,
    Math.max(0.2, (awayAttack + homeDefence) / 2),
  );
  const goalsModel = goalProbabilities(homeExpectedGoals, awayExpectedGoals);

  const homeFormRecords = homeAtHome.length ? homeAtHome : homeRecent;
  const awayFormRecords = awayAway.length ? awayAway : awayRecent;
  const homePoints = pointsPerGame(homeFormRecords);
  const awayPoints = pointsPerGame(awayFormRecords);
  const formModel = formProbabilities(
    (homePoints ?? 1.35) - (awayPoints ?? 1.15),
  );

  const headToHead = headToHeadProbabilities(
    match.homeTeam,
    match.awayTeam,
    match.date,
    events,
  );
  const hasHeadToHead = headToHead.matches >= 2;
  const weights = hasHeadToHead
    ? { goals: 0.62, form: 0.26, headToHead: 0.12 }
    : { goals: 0.68, form: 0.32, headToHead: 0 };

  const aggregate = {
    home:
      goalsModel.home * weights.goals +
      formModel.home * weights.form +
      headToHead.probabilities.home * weights.headToHead,
    draw:
      goalsModel.draw * weights.goals +
      formModel.draw * weights.form +
      headToHead.probabilities.draw * weights.headToHead,
    away:
      goalsModel.away * weights.goals +
      formModel.away * weights.form +
      headToHead.probabilities.away * weights.headToHead,
  };
  const total = aggregate.home + aggregate.draw + aggregate.away;
  const probabilities = roundedPercentages({
    home: aggregate.home / total,
    draw: aggregate.draw / total,
    away: aggregate.away / total,
  });

  const hasHomeData = homeRecent.length > 0;
  const hasAwayData = awayRecent.length > 0;
  const confidence = Math.min(
    90,
    22 +
      Math.min(homeRecent.length, 5) * 4 +
      Math.min(awayRecent.length, 5) * 4 +
      Math.min(headToHead.matches, 4) * 2 +
      (leagueGoals.home.length >= 10 ? 10 : 0),
  );
  const confidenceLabel =
    confidence >= 68 ? "good" : confidence >= 45 ? "moderate" : "low";
  const formEffect =
    (homePoints ?? 1.35) - (awayPoints ?? 1.15) > 0.18
      ? "home"
      : (homePoints ?? 1.35) - (awayPoints ?? 1.15) < -0.18
        ? "away"
        : "balanced";
  const goalEffect =
    homeExpectedGoals - awayExpectedGoals > 0.18
      ? "home"
      : homeExpectedGoals - awayExpectedGoals < -0.18
        ? "away"
        : "balanced";

  const factors: PredictionEstimate["factors"] = [
    {
      key: "goals",
      label: "Goal model",
      summary:
        homeRecent.length || awayRecent.length
          ? `Recent scoring and goals conceded suggest ${homeExpectedGoals.toFixed(2)} home and ${awayExpectedGoals.toFixed(2)} away expected goals.`
          : "Recent team results are not available; a low-confidence league scoring baseline is used.",
      effect: homeRecent.length || awayRecent.length ? goalEffect : "unavailable",
      weight: weights.goals,
      available: homeRecent.length > 0 || awayRecent.length > 0,
    },
    {
      key: "form",
      label: "Home/away form",
      summary:
        hasHomeData || hasAwayData
          ? `${match.homeTeam.name}: ${homePoints?.toFixed(2) ?? "—"} points per match at home. ${match.awayTeam.name}: ${awayPoints?.toFixed(2) ?? "—"} away.`
          : "No recent team form was returned by the available feeds.",
      effect: hasHomeData || hasAwayData ? formEffect : "unavailable",
      weight: weights.form,
      available: hasHomeData || hasAwayData,
    },
    {
      key: "head-to-head",
      label: "Head-to-head",
      summary: hasHeadToHead
        ? `${headToHead.matches} prior meeting${headToHead.matches === 1 ? "" : "s"} before this match are included.`
        : `${headToHead.matches} verified prior meeting${headToHead.matches === 1 ? "" : "s"} found; at least two are required for this signal.`,
      effect: hasHeadToHead
        ? headToHead.probabilities.home - headToHead.probabilities.away > 0.12
          ? "home"
          : headToHead.probabilities.away - headToHead.probabilities.home > 0.12
            ? "away"
            : "balanced"
        : "unavailable",
      weight: weights.headToHead,
      available: hasHeadToHead,
    },
  ];

  return {
    probabilities,
    confidence,
    confidenceLabel,
    model: "Goals + home/away form + head-to-head aggregate (v1)",
    factors,
    disclaimer: PREDICTION_DISCLAIMER,
  };
}

export function makeRecentMatches(
  team: FootballMatch["homeTeam"],
  matchDate: string,
  events: ExternalEvent[],
): RecentMatch[] {
  return recentRecords(team, matchDate, events).map((record) => {
    const opponent =
      record.location === "home"
        ? text(record.event.strAwayTeam)
        : text(record.event.strHomeTeam);
    return {
      date: record.date,
      opponent: opponent ?? "Opponent unavailable",
      location: record.location,
      scoreFor: record.scoreFor,
      scoreAgainst: record.scoreAgainst,
      result: resultFor(record.scoreFor, record.scoreAgainst),
      source: text(record.event.source) ?? "TheSportsDB",
    };
  });
}

export function makeHeadToHead(
  homeTeam: FootballMatch["homeTeam"],
  awayTeam: FootballMatch["awayTeam"],
  matchDate: string,
  events: ExternalEvent[],
): RecentMatch[] {
  return events
    .filter((event) => {
      const date = text(event.dateEvent);
      if (!date || date >= matchDate) return false;
      const homeScore = integer(event.intHomeScore);
      const awayScore = integer(event.intAwayScore);
      if (homeScore === null || awayScore === null) return false;
      const homeIsHome = sameTeam(
        event.idHomeTeam,
        event.strHomeTeam,
        homeTeam.id,
        homeTeam.name,
      );
      const awayIsAway = sameTeam(
        event.idAwayTeam,
        event.strAwayTeam,
        awayTeam.id,
        awayTeam.name,
      );
      const homeIsAway = sameTeam(
        event.idHomeTeam,
        event.strHomeTeam,
        awayTeam.id,
        awayTeam.name,
      );
      const awayIsHome = sameTeam(
        event.idAwayTeam,
        event.strAwayTeam,
        homeTeam.id,
        homeTeam.name,
      );
      return (
        (homeIsHome && awayIsAway) ||
        (homeIsAway && awayIsHome)
      );
    })
    .sort((left, right) =>
      String(right.dateEvent).localeCompare(String(left.dateEvent)),
    )
    .filter((event, index, all) => {
      const eventDate = text(event.dateEvent) ?? "";
      const homeScore = integer(event.intHomeScore);
      const awayScore = integer(event.intAwayScore);
      const key = `${eventDate}:${homeScore}:${awayScore}`;
      return (
        all.findIndex((candidate) => {
          const candidateKey = `${text(candidate.dateEvent) ?? ""}:${integer(candidate.intHomeScore)}:${integer(candidate.intAwayScore)}`;
          return candidateKey === key;
        }) === index
      );
    })
    .slice(0, 5)
    .map((event) => {
      const homeScore = integer(event.intHomeScore)!;
      const awayScore = integer(event.intAwayScore)!;
      const homeIsHome = sameTeam(
        event.idHomeTeam,
        event.strHomeTeam,
        homeTeam.id,
        homeTeam.name,
      );
      const homeFor = homeIsHome ? homeScore : awayScore;
      const awayAgainst = homeIsHome ? awayScore : homeScore;
      return {
        date: text(event.dateEvent)!,
        opponent: awayTeam.name,
        location: homeIsHome ? "home" : "away",
        scoreFor: homeFor,
        scoreAgainst: awayAgainst,
        result: resultFor(homeFor, awayAgainst),
        source: text(event.source) ?? "TheSportsDB",
      };
    });
}
