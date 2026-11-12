# Olai development

Follow `/Users/rajanthegoat/work/.org/environments.md` and the product-environments skill for environment changes and deployment.

The web application uses the Rust server in `server/` and the existing React frontend in `web/`. The server owns durable data. Develop on a feature branch and run the isolated worktree stack with `bash scripts/env worktree up`.

Run `bash scripts/test unit`, `bash scripts/test integration`, and `bash scripts/test ui` before declaring development complete. Verify environment adoption with `bash scripts/test isolation`.

The actual default branch is `main`. Merge and staging deployment follow user review. Build staging from the merged clean default branch, then run `bash scripts/deploy staging` and `bash scripts/test staging`. Promote the same tested image to production when requested.
