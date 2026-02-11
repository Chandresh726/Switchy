-- Migration: Move job preferences from profile to settings
-- Created: 2025-02-11

-- Move preferredCountry from profile to settings (idempotent with conflict handling)
INSERT INTO settings (key, value, updated_at)
SELECT 'scraper_filter_country', preferred_country, updated_at
FROM profile
WHERE preferred_country IS NOT NULL AND preferred_country != ''
LIMIT 1
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;

-- Move preferredCity from profile to settings (idempotent with conflict handling)
INSERT INTO settings (key, value, updated_at)
SELECT 'scraper_filter_city', preferred_city, updated_at
FROM profile
WHERE preferred_city IS NOT NULL AND preferred_city != ''
LIMIT 1
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;

-- Set default country to India if no preference exists (idempotent)
INSERT INTO settings (key, value, updated_at)
SELECT 'scraper_filter_country', 'India', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'scraper_filter_country')
ON CONFLICT(key) DO NOTHING;
