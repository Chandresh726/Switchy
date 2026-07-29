const SWITCHY_PROCESS_TITLE = "Switchy";
const PROCESS_TITLE_STATEMENT = `process.title = "${SWITCHY_PROCESS_TITLE}";`;

export function brandStandaloneServer(source) {
  const normalizedSource = source.endsWith("\n") ? source : `${source}\n`;
  if (normalizedSource.includes(PROCESS_TITLE_STATEMENT)) {
    return normalizedSource;
  }
  return `${normalizedSource}\n${PROCESS_TITLE_STATEMENT}\n`;
}
