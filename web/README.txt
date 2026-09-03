Master Admin web dashboard — Phase 2 (web side)
==================================================

admin.html
  Full updated file — adds four sections to the sidenav, each gated
  client-side by the logged-in admin's permissions (state.permissions /
  can()) — the backend re-checks everything with requirePermission()
  regardless, this is just UX.

  - Login now also stores isOwnerAdmin and adminPermissions from
    /api/auth/login (separate fba_isOwnerAdmin / fba_permissions
    localStorage keys), so a delegated admin only sees nav items they
    were actually granted.
  - NEW "Websites & Forms" — every website across every customer,
    search, publish/unpublish, delete.
  - NEW "Telegram" — every connected chat across every customer,
    enable/disable, send a test notification.
  - NEW "Delegated Admins" (full-owner-only nav item) — grant/edit/
    revoke a customer account's delegated-admin status and permission
    checklist via a modal form.
  - NEW "Platform Settings" — general settings form (platform name,
    logo/favicon, payment info, maintenance mode) plus one card per plan
    to edit pricing (initial/monthly amount), form/team-member limits,
    and feature toggles (download, advancedTelegram, crm, dataExport,
    calendar, analytics, teamManagement) — saves immediately via
    /api/admin/plans, no redeploy needed.

index.html (customer app) is unchanged — not included here.
