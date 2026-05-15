# Contributing to Ritsu

First off, thank you for considering contributing to Ritsu! It's people like you that make Ritsu such a great tool.

## Development Setup

Ritsu is a Node.js project. You will need:
- Node.js 18 or higher
- npm

### Clone and Install

```bash
git clone https://github.com/3kaiu/Ritsu.git
cd Ritsu/runtime
npm install
```

### Running Tests

```bash
npm test
```

### Type Checking

```bash
npx tsc --noEmit
```

## Pull Request Process

1.  **Fork the repository** and create your branch from `main`.
2.  **Make your changes**. Ensure code style matches existing patterns.
3.  **Add tests** for any new functionality or bug fixes.
4.  **Verify everything passes**: Run `npm run build` and `npm test`.
5.  **Submit a Pull Request**. Provide a clear description of the changes and link any related issues.

## Conventional Commits

Ritsu follows the [Conventional Commits](https://www.conventionalcommits.org/) specification for commit messages:

- `feat:` for a new feature
- `fix:` for a bug fix
- `docs:` for documentation changes
- `chore:` for maintenance tasks
- `refactor:` for code refactoring

## Skill Development

If you are contributing a new Skill:
1.  Create a directory in `skills/`.
2.  Provide a `SKILL.md` file with clear instructions.
3.  Ensure it aligns with the `_shared/skill-common-steps.md` protocol.

## Code of Conduct

Please be respectful and professional in all interactions within the Ritsu project.
