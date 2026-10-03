export type ConversationListing = { conversations?: Array<{ sessionId?: string; source?: string }> };

export function isDirectGitHubConversation(listing: ConversationListing, chatId: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(chatId) &&
    listing.conversations?.some((row) => row.sessionId === chatId && row.source === 'direct') === true;
}

export function isGitHubCliToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,512}$/.test(value);
}
