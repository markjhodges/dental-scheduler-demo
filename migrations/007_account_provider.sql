ALTER TABLE app.account ADD COLUMN provider_id uuid REFERENCES app.provider(id);
CREATE UNIQUE INDEX account_unique_provider ON app.account(practice_id,provider_id) WHERE provider_id IS NOT NULL;
