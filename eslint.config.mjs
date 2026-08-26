// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * The two boundary rules below are not style. They are the compile-time half of
 * decision #9: `PrismaService` being unexported from `PersistenceModule` stops a
 * service resolving the client through DI, and these stop it importing the client
 * directly. Either one alone is trivially bypassable.
 */
const prismaClientImport = {
  group: ['@prisma/client', '@prisma/client/*', '**/generated/prisma', '**/generated/prisma/**'],
  message:
    'The Prisma client may only be imported from a *.repository.ts file. Services talk to repositories, never to Prisma (decision #9).',
};

/** Raw SQL bypasses the soft-delete extension, so it is confined to one reviewable file. */
const rawSqlSelectors = [
  {
    selector:
      'MemberExpression[property.name=/^\\$(queryRaw|queryRawUnsafe|queryRawTyped|executeRaw|executeRawUnsafe)$/]',
    message:
      'Raw SQL is confined to node.repository.ts, where every statement must filter `deleted_at IS NULL` explicitly.',
  },
  {
    selector: "MemberExpression[object.name='Prisma'][property.name=/^(sql|raw|join|empty)$/]",
    message: 'Raw SQL is confined to node.repository.ts.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'apps/api/src/generated/**',
      // Gitignored working material — issue briefs, deviation logs, and the one-off
      // verification script the S1 gate hands to the owner. None of it ships, and none of
      // it is in a tsconfig, so the type-checked rules cannot parse it.
      'notes/**',
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: [prismaClientImport] }],
      'no-restricted-syntax': ['error', ...rawSqlSelectors],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // The persistence layer and the repositories are the only places the Prisma client
  // exists. `prisma.service.ts` and the soft-delete extension are not repositories but
  // must construct and extend the client, so the boundary is drawn around the layer
  // rather than around a filename suffix alone.
  {
    files: ['**/*.repository.ts', '**/persistence/**/*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },

  // And node.repository.ts is the only place raw SQL exists.
  {
    files: ['**/node.repository.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // The SPA runs in a browser, not in Node, and its correctness rules are different:
  // the hooks rules catch a class of bug — conditional hooks, stale closures in
  // dependency arrays — that TypeScript cannot see.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },

  {
    files: ['**/*.config.{ts,mts,js,mjs}', '**/vitest.config.ts', 'eslint.config.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  prettier,
);
