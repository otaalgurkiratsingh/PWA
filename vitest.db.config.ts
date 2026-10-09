import { defineConfig } from 'vitest/config';

// Database isolation tests run against a throwaway local PostgreSQL started by scripts/test-db.sh.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
