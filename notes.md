# CS 260 — Simon DB notes

## November 17, 2026: production connection diagnosis

- EC2 remains a t3.nano with the existing persistent 1 GB swap; no instance or
  system upgrades were made.
- Runtime: Node 22.12.0, MongoDB Node driver 6.12.0, cookie-parser 1.4.7.
- Initial EC2 diagnostics: SRV resolved three nodes and TXT resolved, but each direct
  TLS connection returned `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`. An encoded-URI
  MongoDB ping also failed before authentication. This isolated the initial failure
  to the connection layer; credentials were subsequently verified after access
  was restored. A TLS alert alone did not prove an IP-list issue.
- PM2 logs show Simon repeatedly exits with code 1 about every 30 seconds after
  the failed ping. “Online” and “Listening” alone did not establish DB readiness.
- cookie-parser currently loads successfully. The original deploy script deleted
  a live service directory and installed dependencies while PM2 could restart.
  This creates a plausible partial-package race; the historical package error
  cannot be conclusively reconstructed from flushed logs. No kernel OOM records
  appeared in the available journal query.
- Changes: escape credentials in the URI; wait for the DB ping before HTTP listen;
  use sanitized startup errors; install locked dependencies in a remote staging
  directory and ping Atlas before switching deployments. Preserve the previous
  directory and stop PM2 during the switch. Ignore dbConfig.json at any depth.
- Local validation: frontend production build and JavaScript/Bash syntax checks
  pass. React Bootstrap emits existing ignored `use client` directive warnings.
- Resolution: Atlas allowed only the home IP. The user added
  `44.205.198.203/32` and confirmed it Active. Direct EC2 ping then passed,
  confirming the IP access list caused this connection failure.
- Deployed fixes with locked dependency installation and successful Atlas
  preflight. Production config permissions are 600. Logs now show
  `Connected to database` before `Listening on port 3000`.
- Production HTTPS verification passed registration, correct/incorrect password
  login, score submission, authenticated leaderboard, logout, and unauthorized
  rejection. Direct Atlas reads confirmed the user, bcrypt password hash, and
  score document. After a deliberate PM2 restart, the existing session, a new
  login, and score persistence all passed.
- Verification retained one clearly named example.invalid account and one score
  of 1; no database records were deleted. Startup stayed online with zero restarts.
- The Simon restart counter retains 57 historical/deliberate restarts; the latest
  deliberate verification restart accounts for the increase from 56 to 57.
- Final commit and push follow verification; the course remote must not receive
  student changes.

A backend MongoDB dependency does not need to be installed in the frontend.
TLS verification must stay enabled; opening all IP addresses is unnecessary when
an exact EC2 address can be allowed.
