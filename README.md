# Consumables Reorder: GitHub Pages + Firebase

Badge-based reordering for consumable bins. The website is hosted free on **GitHub Pages**, and the data and logins are stored free in **Firebase**. Nothing runs on your NUC except a browser showing the kiosk page.

## Your three links

After setup (step 2 below), with `<user>` = your GitHub username and `<repo>` = the repository name:

| # | System | Link | Login |
|---|--------|------|-------|
| 1 | **Badge kiosk** (NUC + USB badge reader) | `https://<user>.github.io/<repo>/kiosk.html` | Signs in once with a *Kiosk* user, then stays signed in |
| 2 | **Order page** (Pending / Already ordered) + **Admin** | `https://<user>.github.io/<repo>/` | email + password (users you create) |
| 3 | **Public board** (last 14 days) | `https://<user>.github.io/<repo>/board.html` | none |

The links work from anywhere (office, phone, home), with no certificate warnings.

---

## Setup (about 20 minutes, one time)

### 1. Firebase console — https://console.firebase.google.com → project **consumable-reorder**

1. **Turn on email/password sign-in:** go to **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save**.
2. **Create the database:** go to **Build → Firestore Database → Create database**.
   * Pick a location close to you, for example `nam5 (United States)`. It can't be changed later.
   * Choose **Start in production mode**.
3. **Add the security rules:** go to **Firestore Database → Rules**. Delete everything there, paste the full contents of `firestore.rules` from this folder, and click **Publish**.
   * ⚠ These rules decide who can see and change what. Don't skip this step.
4. **Authorize your GitHub address:** go to **Authentication → Settings → Authorized domains → Add domain** and enter `<user>.github.io`.
5. **Stay on the free Spark plan.** Don't upgrade to Blaze. On Spark, Google can never charge you: if a daily limit is ever reached, the site pauses until midnight US Pacific time.

The Firebase settings are already filled in at `js/firebase-config.js`.

### 2. GitHub Pages

1. Sign in to https://github.com and click **New repository**.
   * Name it, for example `consumable-reorder`.
   * Make it **Public**. Free GitHub Pages requires a public repo; if you have GitHub Team/Enterprise, private works too.
   * The code contains no passwords or data. Data is only reachable through Firebase with the rules above.
2. Click **uploading an existing file**. Drag in **all the files and folders inside** this folder (`index.html`, `orders.html`, `css/`, `js/` and the rest), then click **Commit changes**.
3. Go to **Settings → Pages**, set **Source: Deploy from a branch** and **Branch: `main` / `(root)`**, then click **Save**.
4. Wait 1–2 minutes. The page shows *"Your site is live at https://\<user\>.github.io/\<repo\>/"*.

### 3. Create the first admin (you)

1. Open `https://<user>.github.io/<repo>/setup.html`.
2. Choose a password for **kpatel@signifi.com** and click **Create admin login**.
3. Open the verification email from Firebase (check **Junk**), click the link, then come back and press **I clicked the link — finish setup**.
4. You're now the admin. Only this email can do this step, and only after confirming it owns the mailbox.

### 4. Add users (Admin → Users → + Add user)

| Role | Can do |
|------|--------|
| **Admin** | Everything: parts, badges, order links, users |
| **Buyer** | Place orders (Order button), edit PO and expected date, mark received, add/cancel requests |
| **Viewer** | See both tabs, search and export. Can't change anything. |
| **Kiosk** | Only for the badge station. Create one, e.g. `kiosk@signifi.com`. |

* The login is the user's email. **Generate** creates a password; give it to them.
* **Forgot password:** use the *Forgot password?* link on the sign-in page, or as admin go to **Edit user → Send password reset email**.
* **Block someone:** Edit user → untick **Active**. They're signed out right away and the rules block them.
* You can't remove your own admin role or deactivate yourself.

### 5. Parts and badges (Admin → Parts & badges)

* **One by one:** tap a badge on the kiosk. It shows "Badge not set up" and appears in Admin under **New badges tapped**. Choose the part or click **New part**.
* **Many at once:** fill in `parts-template.csv` in Excel and use **Import CSV**.
* For each part set: part number, badge ID, **order qty**, **order page link**, vendor and bin location.

### 6. The NUC kiosk (Lubuntu)

1. Copy `kiosk-setup/setup-kiosk.sh` to the NUC, open a terminal in that folder and run:
   ```bash
   sudo bash setup-kiosk.sh https://<user>.github.io/<repo>/kiosk.html
   ```
2. Turn on auto-login so the kiosk comes back after a power cut. Use Lubuntu **Preferences → LXQt settings → Login settings**, or add this to `/etc/sddm.conf`:
   ```
   [Autologin]
   User=<nuc-username>
   Session=Lubuntu
   ```
3. Reboot. The kiosk opens full screen and asks to sign in **once**. Use the *Kiosk* user, and it stays signed in after that.
4. Plug in the USB badge reader (keyboard mode) and tap a badge.
   * Exit the kiosk with **Alt+F4**. Start it again with `parts-kiosk`.
   * A small "sign out kiosk" link sits in the bottom-right corner.

---

## How it works

1. An empty bin's badge is tapped on the kiosk. A **pending request** is created with the order qty from Admin. The screen turns green and beeps.
   * Tapping the same bin again while it's pending shows yellow "Already requested" and creates no duplicate.
   * An unknown badge turns red and appears in Admin.
2. Everyone with the **Orders** page or the **Board** open hears a chime instantly. These are live updates, not polling.
3. A buyer presses **🛒 Order**. The vendor link opens in a new tab, and they fill in qty, PO number, vendor and expected date. *Ordered by* is set from their login.
4. **Already ordered** shows request date, order date, qty, when coming (late dates turn red), PO number, vendor and ordered by, with **Edit** and **Received** buttons.
5. **Search and filters:** the part-number search covers all history, and the from–to date filter narrows results. **Export CSV** saves what's on screen.
6. The **public board** shows only part, description, qty, status and dates. PO numbers, vendors and names are **not** sent to the public page.

## Staying inside the free Firebase limits

The free Spark plan allows **50,000 reads, 20,000 writes and 20,000 deletes per day**, and 1 GB of storage. The site is built to use a small fraction of that:

| What | Firebase cost |
|------|---------------|
| Badge tap | about 3–4 reads + 3–4 writes (security checks count as reads too) |
| Place / edit / receive an order | 2–3 writes |
| Orders page open | 1 read per pending request, then **only changes** (live listener, no polling) |
| "Already ordered" tab | 50 rows at a time, only when opened. **Load more** gets the next 50. |
| Board on a TV all day | one load (≤ 300 rows), then only changes. It refreshes once a day at 4 AM. |
| Kiosk all day | 6 rows for "recent requests", then only changes |
| Admin page | reads the parts list once per visit |

Rough estimate: 100 taps and 20 people checking the site a few times a day comes to **about 5,000–10,000 reads per day**, well under 50,000.

To watch usage, go to Firebase console → **Firestore Database → Usage**.

Tips to keep usage low:
* Use **date filters** or a **part number** search instead of pressing **Load more** many times.
* Don't leave dozens of browser tabs open on the Orders page. One per person is fine.

## Optional hardening

* **Lock the API key to your site:** go to https://console.cloud.google.com → project *consumable-reorder* → **APIs & Services → Credentials → Browser key → Application restrictions: Websites**, and add `https://<user>.github.io/*`. If you test locally, also add `http://localhost:*`.
* **Sign-in protection:** Firebase automatically blocks repeated wrong passwords ("too many attempts").

## Updating the site

Edit a file on GitHub, or upload a new version and commit. GitHub Pages updates in about a minute. If you change `firestore.rules`, paste it into the Firebase console again and click **Publish**.

## Troubleshooting

| Problem | Fix |
|---|---|
| "You don't have permission to do that" | Check that the rules from `firestore.rules` are published (setup step 1.3), and check the user's role and Active status. |
| "Your login has no access yet" | The user exists in Firebase Authentication but wasn't added in Admin → Users. Add them there. |
| "This email already has a Firebase login" when adding a user | Delete it in Firebase console → Authentication → Users, then add the user again. |
| Verification or reset email not arriving | Check Junk. The sender is `noreply@consumable-reorder.firebaseapp.com`. |
| "Daily free Firebase limit reached" | It resets at midnight US Pacific. See the tips above. |
| Badge tap does nothing | Click once on the kiosk screen so it has focus. Check that the reader types numbers and Enter in a text editor. |

## Files

```
index.html         sign-in page
orders.html        Pending / Already ordered tabs
admin.html         parts, badges, users, links
account.html       change own password
board.html         public board (no login)
kiosk.html         badge station
setup.html         one-time first admin setup
css/app.css        styles
js/firebase-config.js   Firebase project settings + site settings (name, board days)
js/*.js            page logic
firestore.rules    security rules -> paste into Firebase console
parts-template.csv example for bulk part import
kiosk-setup/setup-kiosk.sh   turns the NUC into the kiosk
```
