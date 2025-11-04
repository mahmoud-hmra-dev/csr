CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  org_kind ENUM('ngo','corporate') NOT NULL,
  org_size ENUM('small','large') NOT NULL,
  org_type VARCHAR(64) NOT NULL,
  annual_budget DECIMAL(18,2),
  extra_json JSON NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS responses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED,
  submitted_at DATETIME NOT NULL,
  lang VARCHAR(8) NOT NULL,
  organization_type VARCHAR(64) NOT NULL,
  answers JSON NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_responses_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS budget_rules (
  id INT NOT NULL PRIMARY KEY,
  ngo_threshold DECIMAL(18,2) NOT NULL,
  corporate_threshold DECIMAL(18,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO budget_rules (id, ngo_threshold, corporate_threshold)
VALUES (1, 1000000, 1000000)
ON DUPLICATE KEY UPDATE
  ngo_threshold = VALUES(ngo_threshold),
  corporate_threshold = VALUES(corporate_threshold);

-- Seed admin user: admin@example.com / //Mahmoud@123
INSERT INTO users (
  email, password_hash, name, role,
  org_kind, org_size, org_type,
  annual_budget, extra_json,
  created_at, updated_at
)
VALUES (
  'admin@example.com',
  '$2a$12$N5.sfrUPaWA6ifaL8TSoku/541zPJFWua6r77k5uun9X.sM9mrgQy', 
  'Admin',
  'admin',
  'ngo',
  'large',
  'large_ngo',
  NULL,
  NULL,
  NOW(),
  NOW()
)
ON DUPLICATE KEY UPDATE email = email;
