USE s25101336_test;

CREATE TABLE users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  contact_number VARCHAR(50) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'patient') NOT NULL DEFAULT 'patient',
  full_name VARCHAR(150),
  age INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE departments (
  department_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  code VARCHAR(10) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE counters (
  counter_id INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NOT NULL,

  name VARCHAR(50) NOT NULL,

  status ENUM('open','break','closed') NOT NULL DEFAULT 'open',
  break_until TIME NULL,

  current_queue_id INT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (department_id) REFERENCES departments(department_id)
    ON DELETE CASCADE
) ENGINE=InnoDB;


CREATE TABLE queues (
  queue_id INT AUTO_INCREMENT PRIMARY KEY,

  full_name VARCHAR(150),
  user_id INT NOT NULL,
  department_id INT NOT NULL,

  code VARCHAR(10) NOT NULL,

  category ENUM(
    'general','support','priority','complaint'
  ) NOT NULL,

  status ENUM('waiting','serving','done','no_show','void')
    DEFAULT 'waiting',

  visit_description TEXT NULL,

  is_priority BOOLEAN DEFAULT FALSE,
  is_emergency BOOLEAN DEFAULT FALSE,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  called_at DATETIME NULL,
  finished_at DATETIME NULL,

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE queue_logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,

  queue_id INT NOT NULL,
  actor_user_id INT NULL,

  action ENUM('created','called','skipped','no_show','void','recall') NOT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (queue_id) REFERENCES queues(queue_id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;


CREATE TABLE daily_counters (
  id INT AUTO_INCREMENT PRIMARY KEY,

  date DATE NOT NULL,
  department_id INT NOT NULL,
  last_number INT DEFAULT 0,

  UNIQUE KEY unique_date_department (date, department_id),

  FOREIGN KEY (department_id) REFERENCES departments(department_id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE system_settings (
  id INT PRIMARY KEY DEFAULT 1,

  queue_status ENUM('open','pause','closed') DEFAULT 'open',

  max_slots INT DEFAULT 50,
  current_slots INT DEFAULT 0,

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;




CREATE INDEX idx_queue_status ON queues(status);
CREATE INDEX idx_queue_user ON queues(user_id);
CREATE INDEX idx_queue_created ON queues(created_at);

CREATE INDEX idx_logs_queue ON queue_logs(queue_id);
CREATE INDEX idx_logs_actor ON queue_logs(actor_user_id);
