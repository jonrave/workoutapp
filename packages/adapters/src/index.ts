export * from './manual';
export * from './protocols';
export * from './oura';
export * from './strava';
export * from './parser';
export * from './note';
export * from './schemas';
// Note: ./claude (the LLM-backed parser) is exported separately so importing
// the adapters package never pulls in the Anthropic SDK by default (I2).
