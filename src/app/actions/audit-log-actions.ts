// /src/app/actions/audit-log-actions.ts
"use server";

// This file is being deprecated.
// The logic for deleting audit logs has been moved to the client-side
// in `src/app/audit-log/page.tsx` to ensure that Firestore operations
// are performed with the user's authenticated context, which is not
// available in server actions using the client SDK.
