export function isStandaloneCasualMessage(content: string): boolean {
  const normalized = content.trim().toLowerCase().replace(/[!.?]+$/g, "");

  return /^(hi|hello|hey|yo|sup|wass|what'?s up|howdy|gm|good morning|good afternoon|good evening|holla|holla at me|ping|test|ha+|haha+|hahaha+|lol|lmao|lmfao|rofl)$/
    .test(normalized);
}

export function shouldUsePriorConversation(content: string): boolean {
  const normalized = content.trim().toLowerCase();

  if (!normalized || isStandaloneCasualMessage(normalized)) {
    return false;
  }

  return true;
}
