# Administrator provisioning

TapTalk has no self-service path to the `administrator` role. Every account registers as `user`. An operator with access to the server's database promotes it with the `set-role` command. No credentials are hardcoded or seeded.

## Promote an account

1. The future administrator registers normally in the app and picks their own password.
2. On the server, run the following with the same `DATABASE_PATH` the API uses:

   ```sh
   DATABASE_PATH=./database/taptalk.db npm run set-role --workspace @taptalk/api -- <username> administrator
   ```

3. The change takes effect on the account's next request. No new login is needed, because the role is read on every request.

Use `user` instead of `administrator` to revoke the role. Usernames are matched case-insensitively.

## Exit codes

| Code | Meaning                                           |
| ---- | ------------------------------------------------- |
| 0    | Role changed                                      |
| 1    | No account with that username exists              |
| 2    | Missing `DATABASE_PATH`, username or a valid role |

The command applies pending migrations before it changes anything, just as the API does at startup.

## How the role is enforced

- The server authorizes every request in one place: the `preHandler` guard in `apps/api/src/auth.ts`, which uses the pure `authorize(user, access)` policy.
- Every route under `/api/v1/admin/` requires `administrator`. That requirement comes from the path, so a route configuration cannot weaken it. Other `/api` routes require a signed-in user unless they are explicitly `public`.
- The role is read from the database on every request, so promotion and demotion apply immediately.
- The web app hides the "Import vocabulary" tab from regular users only for convenience. The API returns `403 FORBIDDEN` regardless of what the UI shows.
- Registration ignores any `role` field and always creates a `user`.
