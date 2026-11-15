# React + TypeScript + Vite

## EVAde sign-in and API

The website reads and writes everything through the `evade-api` Worker (`../cloud/worker`, D1 `evade-db`).
The only build setting is the public `VITE_API_URL` (see `.env.example`); never put secrets in `VITE_*` values,
because they ship to every browser. The USDA key and Access settings live in the Worker.

- **Sign-in:** The API advertises the available sign-in options. Astronauts use `/auth/access`, and approved staff
  use `/auth/access/staff`. **Try the demo** opens the synthetic read-only account when the API enables it.
- **Sign-out:** Ends the EVAde session and opens Cloudflare Access logout for personal accounts. If the login
  page opens the wrong account, choose **Use a different email**, then return to the login page and enter your own email.
- **Signed-in routes:** `AppFrame` checks `/auth/me` and redirects to `/login` on 401.
- **Staff console:** `/admin` requires a staff session. Ship the matching API from `evade-cloud` first.
- **Points:** task, tutorial, meal, water and measurement XP is decided and capped by the Worker.
- **Selfies:** stored privately in R2 through `/media` (shows a notice until the R2 bucket is enabled).
- **New users:** panels show "No readings yet" until data syncs.

### Local development

1. `cd ../cloud/worker`, copy `.dev.vars.example` to `.dev.vars` (localhost origin), then
   `npx wrangler d1 migrations apply evade-db --local` and
   `npx wrangler dev --port 8787 --local-upstream localhost:8787 --upstream-protocol http`.
2. Here: `VITE_API_URL=http://localhost:8787 npm run dev -- --port 5179`.

Cloudflare Access can't sit in front of localhost, so the local site has no sign-in; signed-in pages are tested
against the deployed API. Scripts can call the local API with the `X-EVAde-Key` header.

Run `npm ci`, `npm run lint`, and `npm run build` from this folder. The website host should serve `index.html` for SPA routes, including `/login` and `/dashboard`.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.
You can also try [the experimental native React Compiler support in plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#rust-react-compiler) by using `compiler: true` in the plugin options instead of using the Babel plugin.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
