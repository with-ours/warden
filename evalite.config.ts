import 'dotenv/config';
import { config } from 'dotenv';
import { defineConfig } from 'evalite/config';

// Load .env.local for API keys (dotenv/config only loads .env)
config({ path: '.env.local' });

export default defineConfig({
  // Each fixture can take a while with LLM calls
  testTimeout: 120000,
  // Run fixtures sequentially to avoid rate limits
  maxConcurrency: 1,
});
