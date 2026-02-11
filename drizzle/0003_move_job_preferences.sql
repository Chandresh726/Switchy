-- Migration: Move job preferences from profile to settings
-- Created: 2025-02-11

-- Move preferredCountry from profile to settings
INSERT INTO settings (key, value, updated_at)
SELECT 'scraper_filter_country', preferred_country, updated_at
FROM profile
WHERE preferred_country IS NOT NULL AND preferred_country != '';

-- Move preferredCity from profile to settings
INSERT INTO settings (key, value, updated_at)
SELECT 'scraper_filter_city', preferred_city, updated_at
FROM profile
WHERE preferred_city IS NOT NULL AND preferred_city != '';

-- Set default country to India if no preference exists
INSERT INTO settings (key, value, updated_at)
SELECT 'scraper_filter_country', 'India', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'scraper_filter_country');
