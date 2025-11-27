# Frontend Implementation Notes

This file captures UI and client-side behavior specifics. The product spec (`product.md`) holds the broad capabilities.

## Navigation & header
- Global header shows brand plus a profile avatar icon (icon only, no text). When unauthenticated, show `Sign In`/`Sign Up` links, hiding the link for the page currently shown.
- When authenticated, hide auth links and show the avatar dropdown with `Edit profile` and `Log out`.
- Dropdown closes when: clicking Edit profile, clicking outside the menu, or navigating. Clicking the avatar toggles it.
- Edit profile navigation should dismiss the menu and land on the profile page; logout should clear session and close the menu.

## Auth flows
- Use consistent labels: `Sign In` and `Sign Up`.
- Dedicated pages for sign in, sign up, and logout (logout clears stored session and redirects to sign in).
- JWT stored client-side (localStorage) and sent via auth interceptor as `Authorization: Bearer <token>`.

## Profile experience
- `/profile` shows a left-side tab list with `My Profile` first (additional tabs can be added later).
- Tabs include `My Profile` and `Patients`; notifications tab is placeholder/disabled.
- My Profile lets the caregiver update display name and unit preferences.
- Patients tab lists the user’s patients with their relationship and whether the signed-in user is the owner. Offers an “Add patient” action; create form routes back to the patients tab after creation. Handle API responses that may return either an array or `{ patients: [...] }`.
- Patient detail page:
  - Shows/edit patient info (name, DOB, sex at birth, notes). Save updates via PATCH.
  - Displays care team list with relationship per caregiver and owner indicator.
  - Care team actions: add caregiver (search by email, choose role, add), change relationship inline via dropdown, delete caregiver (except owner), and promote a caregiver to owner from the table (updates patient `ownedById`).
  - Add caregiver uses a modal overlay; care team API responses may be array or `{ careTeam: [...] }`.
- Accessed via the avatar dropdown’s Edit profile action.

## App shell & routing
- Basic routing for auth, profile, and dashboard; auth routes should not surface profile/logout affordances.
- Typed HTTP client for API calls; auth interceptor attaches JWT to requests and handles logout on invalid tokens.
