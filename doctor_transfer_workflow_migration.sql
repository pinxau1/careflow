USE s25101336_test;

ALTER TABLE users
  MODIFY role ENUM('owner','admin','staff','doctor','patient') NOT NULL DEFAULT 'patient';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department_id INT NULL AFTER gender;

ALTER TABLE queues
  ADD COLUMN IF NOT EXISTS counter_id INT NULL AFTER department_id;

CREATE INDEX IF NOT EXISTS idx_queues_counter_status ON queues(counter_id, status);

ALTER TABLE queues
  ADD CONSTRAINT fk_queues_counter
  FOREIGN KEY (counter_id) REFERENCES counters(counter_id)
  ON DELETE SET NULL;
