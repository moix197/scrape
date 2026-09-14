// pnpm >=11 forwards the literal `--` separator into the script's argv
// (`pnpm run scrape -- <url>` → argv[0] === '--'); strip it so it isn't
// mistaken for an unknown flag or a positional argument.
export function dropPnpmSeparator(argv) {
  return argv[0] === '--' ? argv.slice(1) : argv;
}
