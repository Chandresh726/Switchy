export const SCRAPER_SETTINGS = {
  filterCountry: {
    key: "scraper_filter_country",
  },
  filterCity: {
    key: "scraper_filter_city",
  },
  filterTitleKeywords: {
    key: "scraper_filter_title_keywords",
  },
  maxParallelScrapes: {
    key: "scraper_max_parallel_scrapes",
    defaultValue: 3,
    minimum: 1,
    maximum: 10,
  },
  keepDeviceAwake: {
    key: "scraper_keep_device_awake",
    defaultValue: true,
  },
  historyRetentionDays: {
    key: "scraper_history_retention_days",
    defaultValue: 60,
    minimum: 7,
    maximum: 3_650,
  },
} as const;
