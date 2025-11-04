# CSR Tripetto-style Assessment

- White & blue theme
- Language switch (Arabic / English)
- Organization type selector (small_ngo, large_ngo, small_corporate, large_corporate)
- Questions filtered by `organization_type`
- One page per section (all its questions shown together)

## Run

```bash
npm install
npm start
# open http://localhost:3000
```
## Docker

Build and run with Docker + MySQL:

```bash
docker compose up --build
```

This will start:
- `csr-mysql` (MySQL 8, DB: `csr_db`, user: `csr_user` / `csr_pass`)
- `csr-app` (Node, on port 3000, connected to MySQL)
```

The `responses` table stores each submission:
- `submitted_at` (DATETIME)
- `lang` (ar/en)
- `organization_type` (small_ngo / large_ngo / small_corporate / large_corporate)
- `answers` (JSON with all question IDs and selected answers)


## Registration & Dashboards

- On first visit, a popup lets the user choose to register as **NGO** or **Corporate**.
- Registration form collects organization information, annual budget, and login credentials.
- Backend computes `org_size` (small/large) from the budget and current budget rules, and derives `org_type` (small_ngo, large_corporate, ...).
- The survey questions shown to the user are filtered automatically by that `org_type`.

### Admin dashboard

- Open `/admin.html`.
- Login with the default admin user created by `init.sql`: **admin@example.com / admin123**.
- You can:
  - View and edit **budget thresholds** for NGOs and Corporates (which control when an org becomes "large").
  - See a table of all **responses** with user/org info and answers JSON.

### User dashboard

- Open `/profile.html`.
- Login with the same email/password used at registration.
- The user can:
  - See basic profile and organization classification (kind/size/type).
  - Update their display name and change password.

