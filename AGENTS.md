# Repository Guidelines

## Project Structure

The CLI is implemented in TypeScript under `src/`. `src/cli.ts` defines the command surface, `src/config.ts` resolves profiles and bucket aliases, `src/secrets.ts` encrypts local credentials, `src/obs-client.ts` wraps Huawei's SDK, and `src/operations.ts` implements object transfers and pagination.

The npm launcher is `bin/agent-obs-cli.js`. Agent instructions live in `skills/agent-obs-cli/`. Tests are under `tests/`, example configuration under `config/`, and CI workflows under `.github/workflows/`.

## Commands

- `npm run dev -- list`: run the TypeScript CLI from source.
- `npm run check`: type-check without writing output.
- `npm run lint`: run ESLint.
- `npm test`: run the Vitest suite.
- `npm run build`: compile into `dist/`.
- `npm run pack:check`: inspect the publishable npm package.

## Conventions

Use strict TypeScript and ESM. Keep Huawei SDK response normalization inside `obs-client.ts`; keep filesystem and transfer policy in `operations.ts`. Use camelCase for variables/functions and PascalCase for types/classes. Return stable JSON fields and throw `CliError` with a stable code at command boundaries.

Never print AK, SK, SecurityToken, encryption keys, raw authorization headers, or unredacted SDK errors. Upload and download operations must preserve the default no-overwrite policy. Batch uploads must remain dry-run capable and must not follow symbolic links.

## Testing

Add regression tests for configuration resolution, encryption migration, pagination, path mapping, overwrite protection, partial batch failures, masking, and skill installation safety. Unit tests must use fake OBS adapters. Live integration tests must be opt-in and use a disposable prefix.

## Commits and Pull Requests

Use Conventional Commits, such as `feat(cli): add object metadata command` or `fix(upload): preserve checkpoint after failure`. Pull requests should describe behavior changes, list verification commands, and update both language READMEs for user-visible changes. Never commit real credentials, local config, checkpoint files, `node_modules/`, or `dist/`.
