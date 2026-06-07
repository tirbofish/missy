import { shouldLookPastClearPoint } from "./history.ts";

function wordCount(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

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

  if (shouldLookPastClearPoint(normalized)) {
    return true;
  }

  if (
    /\b(anything else|what else|who else|where else|something else|another|more|again|continue|go on|from before|earlier|previous|above|last time|last one|you said|your answer)\b/
      .test(normalized)
  ) {
    return true;
  }

  if (
    /\b(hurry up|im waiting|i'm waiting|still waiting|waiting on you|you checking|are you done|done yet|any update|update\?)\b/
      .test(normalized)
  ) {
    return true;
  }

  if (
    /\b(cheaper|less expensive|not too expensive|closer|nearby|instead|same|similar|different|better|worse|narrow it down|make it|do that|that one|this one|those|these|them|it)\b/
      .test(normalized)
  ) {
    return true;
  }

  if (
    /^(yes|yeah|yep|sure|ok|okay|nah|no|nope|please|do it|sounds good)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  return wordCount(normalized) <= 3;
}
