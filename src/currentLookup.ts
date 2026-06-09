export function isCurrentLookupRequest(content: string): boolean {
  const message = content.trim().toLowerCase();

  if (!message) {
    return false;
  }

  const currentSignal =
    /\b(latest|live|current|currently|right now|today|tonight|this week|recent|most recent|score|final score|result|standings|odds|weather|news|finals?|playoffs?|championship|stanley cup|world series|super bowl|matchup|nhl|nba|nfl|mlb|wnba|epl|bus|train|tram|ferry|metro|transit|transport|timetable|departure|arrival)\b/
      .test(message);

  if (!currentSignal) {
    return false;
  }

  return /\b(what|who|when|where|which|how|find|check|look up|score|result|won|beat|lost|think|predict|will|would|should|take|pick|win)\b/
    .test(message);
}

const CURRENT_LOOKUP_STATUS_MESSAGES = [
  "lemme check",
  "one sec",
  "checking",
  "sec, checking",
  "gimme a sec",
];

export function currentLookupStatusMessage(content: string): string {
  let hash = 0;

  for (const character of content) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return CURRENT_LOOKUP_STATUS_MESSAGES[
    hash % CURRENT_LOOKUP_STATUS_MESSAGES.length
  ];
}

export function isCurrentLookupWaitingOnlyResponse(content: string): boolean {
  const normalized = content.trim().toLowerCase();

  if (!normalized || normalized.length > 140) {
    return false;
  }

  return /^(lemme|let me|one sec|sec|checking|gimme a sec|hold on|hang on|i'?ll check|i'?m checking|i am checking)\b.*\b(check|checking|look|lookup|search|current|live|latest|matchup|score|odds|finals?)\b/
    .test(
      normalized,
    ) ||
    /^(lemme check|let me check|one sec|checking|sec, checking|gimme a sec)\b/
      .test(
        normalized,
      );
}
