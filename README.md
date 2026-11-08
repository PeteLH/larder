# Larder 🥫

A shared food-stock app for our two phones: what's in the fridge, freezer and cupboard, and what needs eating first.
It's a home-screen web app hosted on GitHub Pages. The stock list lives in the private `larder-data` repo.

- **Sainsbury's orders add themselves.** A scheduled job in `larder-data` reads the e-receipt from the larder
  inbox each hour and adds the items, with real use-by dates where the receipt has them.
- **Reminders** at 8am (use today / tomorrow) and 5pm (must be eaten tonight), plus one when an order is added.
- **Scan** barcodes for anything already in the house, then **Scan the date** to read the use-by straight off the pack.
  The date reader runs on the phone (Tesseract OCR), cross-checks itself, and always shows what it read so you can confirm.
- Works offline. Both phones stay in sync.

## Adding a phone
Someone already set up taps **Settings → Shared storage → Copy setup link** and sends it. On the new phone:
open the link in Chrome → **Install** → **Turn on reminders**. The welcome card walks through it.

## If an order doesn't arrive by itself
**Import → Choose the email or PDF.** It accepts a saved email (.eml), a PDF of the email, or pasted text.
On Android you can also **Share** a PDF straight to Larder once it's installed.

## Files
`index.html` + `app.js` are the app. `core.js` (receipt reading, shelf-life guesses, sync merge) is shared with the job in
`larder-data`. `style.css` is the look (Direction B). `config.js` holds public settings only. `vendor/` holds the barcode, PDF and date readers; `fonts/` the two typefaces (SIL OFL).

## Releasing a change
Bump `number` (and `date`) in `version.js` and the `CACHE` name in `sw.js` together. Phones compare their running
version with the published `version.js` and offer "update now" in **Settings → About** when they differ.
