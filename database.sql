CREATE DATABASE IF NOT EXISTS hospitaldb;
USE hospitaldb;

CREATE TABLE IF NOT EXISTS users(
  userID INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(225) NOT NULL,
  create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS queues(
  queueID INT PRIMARY KEY,
  department VARCHAR(20) NOT NULL,
  userID INT NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status ENUM ('pending', 'done', 'cancelled') DEFAULT 'pending',
  FOREIGN KEY (userID) REFERENCES users(userID),
  UNIQUE (userID, department)
);
