export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EVAde · Crew Health Monitor</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1020;
         color: #e6ebf5; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 560px; padding: 32px; text-align: center; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  p { color: #8e9ab5; line-height: 1.5; }
  a.btn { display: inline-block; margin-top: 16px; padding: 12px 22px; border-radius: 99px;
          background: #5b8cff; color: #fff; font-weight: 700; text-decoration: none; }
  small { display: block; margin-top: 28px; color: #8e9ab5; }
</style>
</head>
<body>
<main>
  <h1>🛰️ EVAde</h1>
  <p>Onboard crew health co-pilot. Daily voice check-in with Grok, by phone or in the browser.</p>
  <a class="btn" href="/voice/">Talk to EVAde</a>
  <small>Decision support only, not a medical device. NASA Space Apps 2026.</small>
</main>
</body>
</html>
`;
