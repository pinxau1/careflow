-- Subdepartment transfer workflow migration.
-- Run this against the application database selected by your connection.
-- Counters are intentionally untouched; subdepartment queue state is stored in
-- queue_transfers and queue_subdepartment_requirements.

ALTER TABLE queues
  ADD COLUMN IF NOT EXISTS age INT NULL,
  ADD COLUMN IF NOT EXISTS gender VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS referred_from_queue_id INT NULL,
  ADD COLUMN IF NOT EXISTS transfer_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS transferred_by_user_id INT NULL,
  ADD COLUMN IF NOT EXISTS transferred_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS subdepartments (
  subdepartment_id INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NOT NULL,
  name VARCHAR(80) NOT NULL,
  status ENUM('open','break','closed') NOT NULL DEFAULT 'open',
  current_queue_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,

  KEY idx_subdepartments_department (department_id),
  KEY idx_subdepartments_current_queue (current_queue_id),

  CONSTRAINT fk_subdepartments_department
    FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE CASCADE,
  CONSTRAINT fk_subdepartments_current_queue
    FOREIGN KEY (current_queue_id) REFERENCES queues(queue_id) ON DELETE SET NULL
) ENGINE=InnoDB;

ALTER TABLE subdepartments
  ADD COLUMN IF NOT EXISTS current_queue_id INT NULL,
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL;

CREATE INDEX IF NOT EXISTS idx_subdepartments_department
  ON subdepartments(department_id);

CREATE INDEX IF NOT EXISTS idx_subdepartments_current_queue
  ON subdepartments(current_queue_id);

CREATE TABLE IF NOT EXISTS queue_transfers (
  transfer_id INT AUTO_INCREMENT PRIMARY KEY,
  queue_id INT NOT NULL,
  from_department_id INT NOT NULL,
  to_department_id INT NOT NULL,
  status ENUM('waiting_department_call','in_subdepartment','completed','cancelled') NOT NULL DEFAULT 'waiting_department_call',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  called_at DATETIME NULL,
  completed_at DATETIME NULL,

  KEY idx_queue_transfers_queue (queue_id),
  KEY idx_queue_transfers_status (status),
  KEY idx_queue_transfers_target_status (to_department_id, status),

  CONSTRAINT fk_queue_transfers_queue
    FOREIGN KEY (queue_id) REFERENCES queues(queue_id) ON DELETE CASCADE,
  CONSTRAINT fk_queue_transfers_from_department
    FOREIGN KEY (from_department_id) REFERENCES departments(department_id) ON DELETE RESTRICT,
  CONSTRAINT fk_queue_transfers_to_department
    FOREIGN KEY (to_department_id) REFERENCES departments(department_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS queue_subdepartment_requirements (
  requirement_id INT AUTO_INCREMENT PRIMARY KEY,
  transfer_id INT NOT NULL,
  subdepartment_id INT NOT NULL,
  status ENUM('pending','queued','serving','done','skipped') NOT NULL DEFAULT 'pending',
  queued_at DATETIME NULL,
  called_at DATETIME NULL,
  finished_at DATETIME NULL,

  KEY idx_queue_subdepartment_requirements_transfer_status (transfer_id, status),
  KEY idx_queue_subdepartment_requirements_subdepartment_status (subdepartment_id, status),

  CONSTRAINT fk_queue_subdepartment_requirements_transfer
    FOREIGN KEY (transfer_id) REFERENCES queue_transfers(transfer_id) ON DELETE CASCADE,
  CONSTRAINT fk_queue_subdepartment_requirements_subdepartment
    FOREIGN KEY (subdepartment_id) REFERENCES subdepartments(subdepartment_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX IF NOT EXISTS idx_queue_transfers_queue
  ON queue_transfers(queue_id);

CREATE INDEX IF NOT EXISTS idx_queue_transfers_status
  ON queue_transfers(status);

CREATE INDEX IF NOT EXISTS idx_queue_transfers_target_status
  ON queue_transfers(to_department_id, status);

CREATE INDEX IF NOT EXISTS idx_queue_subdepartment_requirements_transfer_status
  ON queue_subdepartment_requirements(transfer_id, status);

CREATE INDEX IF NOT EXISTS idx_queue_subdepartment_requirements_subdepartment_status
  ON queue_subdepartment_requirements(subdepartment_id, status);

CREATE INDEX IF NOT EXISTS idx_queue_referred_from
  ON queues(referred_from_queue_id);

SET @fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'queues'
    AND constraint_name = 'fk_queues_referred_from'
);
SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE queues ADD CONSTRAINT fk_queues_referred_from FOREIGN KEY (referred_from_queue_id) REFERENCES queues(queue_id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'queues'
    AND constraint_name = 'fk_queues_transferred_by'
);
SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE queues ADD CONSTRAINT fk_queues_transferred_by FOREIGN KEY (transferred_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'subdepartments'
    AND constraint_name = 'fk_subdepartments_current_queue'
);
SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE subdepartments ADD CONSTRAINT fk_subdepartments_current_queue FOREIGN KEY (current_queue_id) REFERENCES queues(queue_id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Optional legacy cleanup, intentionally not run by default:
-- Only run these manually if you have confirmed your live database no longer
-- needs the old transfer_groups / transfer_group_items tables or queues.transfer_group_id.
--
-- ALTER TABLE queues DROP FOREIGN KEY fk_queues_transfer_group;
-- ALTER TABLE queues DROP COLUMN IF EXISTS transfer_group_id;
-- DROP TABLE IF EXISTS transfer_group_items;
-- DROP TABLE IF EXISTS transfer_groups;
