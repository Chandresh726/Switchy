export function stateCliArguments(argv = process.argv.slice(2)): string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}
