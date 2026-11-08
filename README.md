# Larder 🥫

A shared food-stock app for our two phones: what's in the fridge, freezer and cupboard, and what needs eating first.
It's a home-screen web app hosted on GitHub Pages. The stock list lives in the private `larder-data` repo.

- **Sainsbury's orders add themselves.** A scheduled job in `larder-data` reads the e-receipt from the larder
  inbox each hour and adds the items, with real use-by dates where the receipt has them.
- **Reminders** at 8am (use today / tomorrow) and 5pm (must be eaten tonight), plus one when an order is added.
- **Scan** barcodes for anything already in the house; set the date from the pack with one tap.
- Works offline. Both phones stay in sync.

## Adding a phone
Someone already set up taps **Settings → Shared storage → Copy setup link** and sends it. On the new phone:
open the link in Chrome → **Install** → **Turn on reminders**. The welcome card walks through it.

## If an order doesn't arrive by itself
**Import → Choose the email or PDF.** It accepts a saved email (.eml), a PDF of the email, or pasted text.
On Android you can also **Share** a PDF straight to Larder once it's installed.

## Files
`index.html` + `app.js` are the app. `core.js` (receipt reading, shelf-life guesses, sync merge) is shared with the job in
`larder-data`. `config.js` holds public settings only. `vendor/` holds the barcode and PDF readers.
