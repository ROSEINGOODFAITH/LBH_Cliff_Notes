-- One-time repair: address-form submitters were mis-filed as raw "Found"
-- (stage 'sourced') by the legacy form path. A form submission is a
-- self-selected, interested person — surface them as a decision instead.
-- ig_handle guard keeps Shopify-seeded / affiliate first_party rows out.
UPDATE "creators" SET "stage" = 'review'
WHERE "stage" = 'sourced' AND "source" = 'first_party' AND "ig_handle" IS NOT NULL;
