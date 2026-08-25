import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],

    // The migration runs once per run, before any test file opens a connection.
    globalSetup: ['src/test-support/global-setup.ts'],

    // One test file at a time. Every test empties the database in `beforeEach`, so two
    // files running concurrently would delete each other's fixtures — a failure that
    // reproduces only under load and looks like flakiness rather than like a harness bug.
    fileParallelism: false,

    // A cold Postgres container and a first migration are slower than any assertion here.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
