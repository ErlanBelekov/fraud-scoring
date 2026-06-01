CREATE TABLE IF NOT EXISTS transactions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id  UUID        NOT NULL,
  card_token      TEXT        NOT NULL,
  customer_id     TEXT        NOT NULL,
  amount          NUMERIC(18,2) NOT NULL,
  currency        CHAR(3)     NOT NULL,
  ip              INET,
  country         TEXT        NOT NULL,
  device_fingerprint TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  decision        TEXT        NOT NULL,
  score           SMALLINT    NOT NULL,
  triggered_rules TEXT[]      NOT NULL DEFAULT '{}',
  evaluated_at    TIMESTAMPTZ NOT NULL,
  inserted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_transaction_id UNIQUE (transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_tx_id_desc ON transactions (id DESC);
CREATE INDEX IF NOT EXISTS idx_tx_customer_country ON transactions (customer_id, country);
