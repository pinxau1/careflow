START TRANSACTION;

CREATE TABLE IF NOT EXISTS visits (
  visit_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  visit_date DATE NOT NULL,
  global_number INT NOT NULL,
  status ENUM('active','completed','cancelled','void') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_visits_date_number (visit_date, global_number),
  KEY idx_visits_user_status (user_id, status),
  KEY idx_visits_date_number (visit_date, global_number),
  CONSTRAINT fk_visits_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS visit_daily_counters (
  date DATE PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

ALTER TABLE queues ADD COLUMN IF NOT EXISTS visit_id INT NULL;
ALTER TABLE queues MODIFY code VARCHAR(32) NOT NULL;
CREATE INDEX IF NOT EXISTS idx_queues_visit ON queues(visit_id);

CREATE TEMPORARY TABLE tmp_queue_roots (
  queue_id INT PRIMARY KEY,
  root_queue_id INT NOT NULL
) ENGINE=MEMORY;

INSERT INTO tmp_queue_roots (queue_id, root_queue_id)
WITH RECURSIVE chain AS (
  SELECT queue_id, queue_id AS root_queue_id
  FROM queues
  WHERE referred_from_queue_id IS NULL

  UNION ALL

  SELECT child.queue_id, chain.root_queue_id
  FROM queues child
  JOIN chain ON child.referred_from_queue_id = chain.queue_id
)
SELECT q.queue_id, COALESCE(c.root_queue_id, q.queue_id) AS root_queue_id
FROM queues q
LEFT JOIN chain c ON c.queue_id = q.queue_id;

CREATE TEMPORARY TABLE tmp_visit_seed (
  root_queue_id INT PRIMARY KEY,
  user_id INT NOT NULL,
  visit_date DATE NOT NULL,
  created_at DATETIME NOT NULL,
  global_number INT NOT NULL
) ENGINE=MEMORY;

INSERT INTO tmp_visit_seed (root_queue_id, user_id, visit_date, created_at, global_number)
SELECT
  r.root_queue_id,
  rq.user_id,
  DATE(rq.created_at) AS visit_date,
  rq.created_at,
  ROW_NUMBER() OVER (
    PARTITION BY DATE(rq.created_at)
    ORDER BY rq.created_at, r.root_queue_id
  ) AS global_number
FROM (SELECT DISTINCT root_queue_id FROM tmp_queue_roots) r
JOIN queues rq ON rq.queue_id = r.root_queue_id;

INSERT INTO visits (user_id, visit_date, global_number, status, created_at)
SELECT user_id, visit_date, global_number, 'active', created_at
FROM tmp_visit_seed;

CREATE TEMPORARY TABLE tmp_visit_map (
  root_queue_id INT PRIMARY KEY,
  visit_id INT NOT NULL
) ENGINE=MEMORY;

INSERT INTO tmp_visit_map (root_queue_id, visit_id)
SELECT s.root_queue_id, v.visit_id
FROM tmp_visit_seed s
JOIN visits v
  ON v.visit_date = s.visit_date
 AND v.global_number = s.global_number;

UPDATE queues q
JOIN tmp_queue_roots r ON r.queue_id = q.queue_id
JOIN tmp_visit_map m ON m.root_queue_id = r.root_queue_id
SET q.visit_id = m.visit_id
WHERE q.visit_id IS NULL;

UPDATE visits v
JOIN (
  SELECT
    visit_id,
    SUM(status IN ('waiting','serving')) AS active_count,
    SUM(status = 'cancelled') AS cancelled_count,
    SUM(status IN ('done','no_show','void')) AS terminal_count
  FROM queues
  WHERE visit_id IS NOT NULL
  GROUP BY visit_id
) s ON s.visit_id = v.visit_id
SET v.status = CASE
  WHEN s.active_count > 0 THEN 'active'
  WHEN s.cancelled_count > 0 AND s.terminal_count = 0 THEN 'cancelled'
  WHEN s.terminal_count > 0 THEN 'completed'
  ELSE 'active'
END;

INSERT INTO visit_daily_counters (date, last_number)
SELECT visit_date, MAX(global_number)
FROM visits
GROUP BY visit_date
ON DUPLICATE KEY UPDATE last_number = GREATEST(last_number, VALUES(last_number));

SELECT COUNT(*) AS queues_without_visit_id FROM queues WHERE visit_id IS NULL;

ALTER TABLE queues
  ADD CONSTRAINT fk_queues_visit
  FOREIGN KEY (visit_id) REFERENCES visits(visit_id)
  ON DELETE RESTRICT;

ALTER TABLE queues MODIFY visit_id INT NOT NULL;

COMMIT;
