# The £100,000 cliff: UK tax explorer

An interactive, step by step explorer for the UK £100,000 income tax cliff, for the 2026/27 tax year.

You answer a few quick questions (salary, children, pension) and the page walks you through what the cliff does to your own numbers. At the end you can open all of the data: charts, breakdowns, escape routes and a pay rise table.

## What it models

- Personal Allowance taper from £100,000 to £125,140 (an effective 62% rate in England, 69.5% in Scotland)
- Income tax in England, Wales and Northern Ireland, and the six Scottish bands
- Employee National Insurance and student loan plans 1, 2, 4, 5 and Postgraduate
- Child Benefit and the High Income Child Benefit Charge
- Tax Free Childcare and the 30 funded hours in England, which switch off for the whole family at £100,001
- Pension contributions as a percentage of salary, by salary sacrifice or personal pension, with the £60,000 annual allowance
- Gift Aid, partners, and nursery costs entered as a monthly bill (estimated from hours if you do not know it)

Advanced settings (country, student loan, partner, how the pension is paid, employer contribution, Gift Aid, nursery weeks) are tucked away so the main flow stays simple.

## Run it locally

There is no build step and no dependencies. Open `index.html` directly, or serve the folder:

```
npm start
```

then visit http://localhost:8080.

## Tests

The tax engine in `js/tax.js` is a set of pure functions with automated tests checked against hand calculated figures.

```
npm test
```

## Deploy to GitHub Pages

The workflow in `.github/workflows/pages.yml` runs the tests and publishes the site on every push to `main`. One time setup: in the repository go to Settings, then Pages, and set the source to GitHub Actions.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | Page structure and content |
| `css/styles.css` | Styles with automatic light and dark themes |
| `js/tax.js` | Tax engine for 2026/27, also used by the tests |
| `js/charts.js` | Small dependency free SVG chart renderer |
| `js/app.js` | Guided steps, dashboard and interactions |
| `tests/tax.test.js` | Engine tests |

## Updating for a new tax year

All rates and thresholds live in the `RULES` object at the top of `js/tax.js`. Update them, update the figures quoted in `index.html`, and run the tests.

## Disclaimer

This is an educational model with simplifying assumptions, not tax, legal or financial advice. Check figures against HMRC's own calculators or speak to a regulated adviser before making decisions.
