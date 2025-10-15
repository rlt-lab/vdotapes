# Tests

This directory contains test files for the VDOTapes project.

## Running Tests

### Rust Module Integration Test

```bash
node tests/test-rust-modules.js
```

This test verifies:
- ✅ Video Scanner Native module
- ✅ Thumbnail Generator Native module
- ✅ Video Grid WASM module
- ✅ .node binaries
- ✅ Actual functionality

## Test Structure (Future)

```
tests/
├── unit/           # Unit tests
├── integration/    # Integration tests
├── e2e/           # End-to-end tests
└── fixtures/      # Test data
```

## Adding Tests

Consider using:
- **Vitest** - Fast unit testing
- **Playwright** - E2E testing for Electron apps
- **Jest** - Alternative unit testing

## Test Coverage

Run tests before:
- Committing code
- Creating pull requests
- Building releases
