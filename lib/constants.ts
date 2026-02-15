export const APP_VERSION = "0.5.0";
export const DB_PATH = process.env.NODE_ENV === "development" 
  ? "~/.switchy/dev/switchy.db" 
  : "~/.switchy/switchy.db";
