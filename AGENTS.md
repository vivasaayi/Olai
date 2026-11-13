# Olai development

Follow `/Users/rajanthegoat/work/.org/environments.md` and the product-environments skill for environment changes and deployment.

The web application uses the Rust server in `server/` and the existing React frontend in `web/`. The server owns durable data. Develop on a feature branch and run the isolated worktree stack with `bash scripts/env worktree up`.

Run `bash scripts/test unit`, `bash scripts/test integration`, and `bash scripts/test ui` before declaring development complete. Verify environment adoption with `bash scripts/test isolation`.

Run each branch in a separate Git worktree. Development and staging run on the Mac Studio and bind to its Tailscale address, so tests and browser links should use the URL returned by `python3 scripts/endpoint`. Preserve per-worktree databases, assets, networks, ports, and images. Host-specific binding overrides belong in private environment configuration as `OLAI_BIND_ADDRESS`.

The actual default branch is `main`. Merge and staging deployment follow user review. Keep a separate clean `main` checkout for staging and run `python3 scripts/update-staging` there after a remote merge. Build staging from the merged clean default branch, then run `bash scripts/deploy staging` and `bash scripts/test staging`. Promote the same tested image to production when requested.
