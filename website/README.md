# Hippocampus Website

Marketing and documentation site for Hippocampus, built with Astro and Tailwind.

## Development

```sh
npm install
npm run dev
```

The dev server starts on `http://localhost:4321`.

## Build And Preview

```sh
npm run build
npm run preview
```

## Structure

```text
website/
	src/
		components/    # Landing and docs UI components
		layouts/       # Base, page, and docs layouts
		pages/         # Routes (home + docs pages)
		styles/        # Global Tailwind/CSS styling
	public/          # Static assets
```

## Notes

- Astro `site` and `base` are configured for GitHub Pages deployment in `astro.config.mjs`.
- Documentation routes live in `src/pages/docs/` and are used by the docs sidebar navigation.
