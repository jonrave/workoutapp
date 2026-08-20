export * from './manual';
export * from './protocols';
export * from './oura';
export * from './oura-auth';
export * from './oura-gate';
export * from './strava';
export * from './parser';
export * from './schemas';
export * from './chat';
// Note: ./claude (the LLM-backed parser) and ./claude-chat (chat + memory
// distillation) are exported separately so importing the adapters package
// never pulls in the Anthropic SDK by default (I2).
