CREATE TABLE IF NOT EXISTS documents (id text PRIMARY KEY, title text NOT NULL, body text NOT NULL);
CREATE TABLE IF NOT EXISTS records (id serial PRIMARY KEY, name text NOT NULL, email text NOT NULL, company text NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scenario text NOT NULL,
 status text NOT NULL CHECK(status IN ('running','waiting_for_approval','completed','failed')),
 policy jsonb NOT NULL, proposals jsonb NOT NULL, started_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES runs(id), step_index integer NOT NULL,
 tool_name text NOT NULL, arguments jsonb NOT NULL, status text NOT NULL CHECK(status IN ('proposed','blocked','waiting_for_approval','approved','rejected','executing','succeeded','failed')),
 policy_decision text, reason_code text, reason_text text, rule_fired text, tool_result jsonb, error text,
 proposed_at timestamptz NOT NULL DEFAULT clock_timestamp(), decided_at timestamptz, executed_at timestamptz,
 UNIQUE(run_id,step_index)
);
CREATE TABLE IF NOT EXISTS approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), step_id uuid NOT NULL UNIQUE REFERENCES steps(id),
 decision text NOT NULL CHECK(decision IN ('approved','rejected')), approver_name text NOT NULL, note text,
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS email_drafts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), step_id uuid UNIQUE NOT NULL REFERENCES steps(id), recipient text NOT NULL, subject text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS outbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), step_id uuid UNIQUE NOT NULL REFERENCES steps(id), recipient text NOT NULL, subject text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS payment_drafts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), step_id uuid UNIQUE NOT NULL REFERENCES steps(id), payee text NOT NULL, amount_cents integer NOT NULL, memo text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
-- Proposal/decision fields become immutable once the policy decision is recorded.
CREATE OR REPLACE FUNCTION protect_trace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Trace history cannot be deleted'; END IF;
 IF OLD.policy_decision IS NOT NULL AND
 (NEW.run_id,NEW.step_index,NEW.tool_name,NEW.arguments,NEW.policy_decision,NEW.reason_code,NEW.reason_text,NEW.rule_fired,NEW.proposed_at,NEW.decided_at)
 IS DISTINCT FROM
 (OLD.run_id,OLD.step_index,OLD.tool_name,OLD.arguments,OLD.policy_decision,OLD.reason_code,OLD.reason_text,OLD.rule_fired,OLD.proposed_at,OLD.decided_at)
 THEN RAISE EXCEPTION 'Proposal and decision are immutable'; END IF;
 IF NEW.status <> OLD.status AND NOT (
 (OLD.status='proposed' AND NEW.status IN ('blocked','waiting_for_approval','executing')) OR
 (OLD.status='waiting_for_approval' AND NEW.status IN ('approved','rejected')) OR
 (OLD.status='approved' AND NEW.status='executing') OR
 (OLD.status='executing' AND NEW.status IN ('succeeded','failed'))
 ) THEN RAISE EXCEPTION 'Invalid step status transition'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS steps_protect ON steps;
CREATE TRIGGER steps_protect BEFORE UPDATE OR DELETE ON steps FOR EACH ROW EXECUTE FUNCTION protect_trace();
