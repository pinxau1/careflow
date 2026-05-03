ALTER TABLE queues
  ADD COLUMN IF NOT EXISTS referred_from_queue_id INT NULL,
  ADD COLUMN IF NOT EXISTS transfer_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS transferred_by_user_id INT NULL,
  ADD COLUMN IF NOT EXISTS transferred_at DATETIME NULL;

SET @fk_referred_from_exists = (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'queues'
    AND constraint_name = 'fk_queues_referred_from'
);

SET @sql = IF(
  @fk_referred_from_exists = 0,
  'ALTER TABLE queues ADD CONSTRAINT fk_queues_referred_from FOREIGN KEY (referred_from_queue_id) REFERENCES queues(queue_id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_transferred_by_exists = (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'queues'
    AND constraint_name = 'fk_queues_transferred_by'
);

SET @sql = IF(
  @fk_transferred_by_exists = 0,
  'ALTER TABLE queues ADD CONSTRAINT fk_queues_transferred_by FOREIGN KEY (transferred_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE INDEX IF NOT EXISTS idx_queue_referred_from ON queues(referred_from_queue_id);
