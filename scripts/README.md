# Scripts

Utility scripts for building, testing, and maintaining the VDOTapes project.

## Available Scripts

All scripts can be run via npm:

```bash
npm run <script-name>
```

See `package.json` for the full list.

## Common Tasks

### Development
```bash
npm run dev              # Start in development mode
npm run build:ts         # Build TypeScript
npm run build:native     # Build Rust modules
```

### Testing
```bash
npm run lint             # Check code style
npm run format           # Format code
node tests/test-rust-modules.js  # Test Rust modules
```

### Building
```bash
npm run build            # Build for current platform
npm run build:mac        # Build for macOS
npm run build:win        # Build for Windows
```

## Future Scripts

Add utility scripts here for:
- Database migrations
- Cache clearing
- Development setup
- Release automation
