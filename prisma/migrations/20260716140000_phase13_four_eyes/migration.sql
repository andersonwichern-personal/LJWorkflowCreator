CREATE TABLE IF NOT EXISTS "workflow_proposals" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "org_id" TEXT NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "proposed_rule" JSONB NOT NULL,
  "proposed_enabled" BOOLEAN,
  "proposer_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "task_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workflow_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "workflow_proposals_org_id_workflow_id_idx"
  ON "workflow_proposals"("org_id", "workflow_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workflow_proposals_workflow_id_fkey'
  ) THEN
    ALTER TABLE "workflow_proposals"
      ADD CONSTRAINT "workflow_proposals_workflow_id_fkey"
      FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "workflow_proposals" ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS "Allow tenant-scoped access by org_id" ON "workflow_proposals";
CREATE POLICY "Allow tenant-scoped access by org_id" ON "workflow_proposals"
  FOR ALL
  USING (auth.jwt() ->> 'org_id' = org_id)
  WITH CHECK (auth.jwt() ->> 'org_id' = org_id);
