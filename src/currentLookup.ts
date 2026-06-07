export function isCurrentLookupRequest(content: string): boolean {
  const message = content.trim().toLowerCase();

  if (!message) {
    return false;
  }

  const currentSignal =
    /\b(latest|live|current|currently|right now|today|tonight|this week|recent|most recent|score|final score|result|standings|odds|weather|news)\b/
      .test(message);

  if (!currentSignal) {
    return false;
  }

  return /\b(what|who|when|where|which|how|find|check|look up|score|result|won|beat|lost)\b/
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
