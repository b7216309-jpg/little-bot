---
name: deal-hunter
description: Compare prices and offers for a product across shops, check reviews and the real total cost (shipping, warranty, condition), and set up a page watch to catch a price drop. Use when the user wants to buy something, asks where it is cheapest, whether a deal is good, or wants to be told when a price falls.
---
# Deal hunter

Find the best real price for the exact item, and never buy anything.

## Pin down the item

Exact model and variant (size, color, storage, region), new or used, and how soon the user needs it. Similar names can hide different products; compare like with like.

## Compare

- Search with several queries at once (`web_search_service` `queries`): the exact model with "price", the user's country or currency, known shops, and "review".
- Read the product pages with `web_scrape` for price, shipping, delivery time, return policy, warranty and seller (official store or marketplace seller).
- Use `browser` only when a shop's page needs JavaScript the reader cannot handle.
- Check reviews from more than one source, and look for known problems with that model.

## Judge the deal

- Total cost = price + shipping + any required extras. A "50% off" from an inflated list price is not a deal.
- Watch for red flags: prices far below every other shop, new sellers with few reviews, pressure timers, payment outside the platform.
- If the user has time, say whether waiting for a typical sale period is likely to help.

## Report and watch

A short table: shop, total price, delivery, warranty or returns, seller, link. Recommend one and say why. Offer a `web_watch` on the best product page so changes show up in the chat while Little Bot is open; add it only when the user agrees. Give the links; the user buys.
