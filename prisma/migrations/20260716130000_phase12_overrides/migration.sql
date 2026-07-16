ALTER TABLE "approval_authorities"
  ADD COLUMN IF NOT EXISTS "overage_tolerance_percent" DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "overage_tolerance_amount" DOUBLE PRECISION DEFAULT 0;

CREATE TABLE IF NOT EXISTS "delegations" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "org_id" TEXT NOT NULL,
  "from_user_id" TEXT NOT NULL,
  "to_user_id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "delegations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "delegations_org_id_from_user_id_idx"
  ON "delegations"("org_id", "from_user_id");

ALTER TABLE "delegations" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    CREATE SCHEMA auth;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'auth' AND p.proname = 'jwt'
  ) THEN
    CREATE FUNCTION auth.jwt() RETURNS jsonb AS 'SELECT ''{}''::jsonb;' LANGUAGE SQL;
  END IF;
END $$;

DROP POLICY IF EXISTS "Allow tenant-scoped access by org_id" ON "delegations";
CREATE POLICY "Allow tenant-scoped access by org_id" ON "delegations"
  FOR ALL
  USING (auth.jwt() ->> 'org_id' = org_id)
  WITH CHECK (auth.jwt() ->> 'org_id' = org_id);
