// Fingerprints left by common browser-automation frameworks. Real browsers
// don't set these; Selenium/Puppeteer/Playwright (and PhantomJS/Nightmare/
// Cypress) do by default. Stealth-patched automation can hide them — see the
// note in AutomationGuard.

const AUTOMATION_GLOBALS = [
  "_phantom",
  "__nightmare",
  "callPhantom",
  "callSelenium",
  "_selenium",
  "__webdriver_evaluate",
  "__selenium_evaluate",
  "__webdriver_script_function",
  "__webdriver_script_func",
  "__webdriver_script_fn",
  "__fxdriver_evaluate",
  "__driver_unwrapped",
  "__webdriver_unwrapped",
  "__driver_evaluate",
  "__selenium_unwrapped",
  "__fxdriver_unwrapped",
  "domAutomation",
  "domAutomationController",
  "__playwright",
  "__pwInitScripts",
  "__puppeteer_evaluation_script__",
  "Cypress",
];

/** Returns the list of automation signals found (empty array = looks human). */
export function detectAutomation(): string[] {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return [];
  }

  const signals: string[] = [];
  const nav = navigator as Navigator & { webdriver?: boolean };
  const w = window as unknown as Record<string, unknown>;

  // 1. W3C WebDriver flag — Selenium/Puppeteer/Playwright set this by default.
  if (nav.webdriver === true) signals.push("navigator.webdriver");

  // 2. Headless user-agent (older headless Chrome, PhantomJS, etc.).
  if (/headless|phantomjs|slimerjs/i.test(nav.userAgent)) {
    signals.push("headless-ua");
  }

  // 3. Framework globals.
  for (const key of AUTOMATION_GLOBALS) {
    if (w[key]) signals.push(`window.${key}`);
  }

  // 4. ChromeDriver injects a `$cdc_...` property on document.
  try {
    for (const key of Object.getOwnPropertyNames(document)) {
      if (/^[$_]?cdc_/i.test(key) || /^\$[a-z]dc_/i.test(key)) {
        signals.push(`document.${key}`);
      }
    }
  } catch {
    // ignore
  }

  // 5. Selenium/WebDriver attributes on <html>.
  for (const attr of ["webdriver", "selenium", "driver"]) {
    try {
      if (document.documentElement.getAttribute(attr) != null) {
        signals.push(`html[${attr}]`);
      }
    } catch {
      // ignore
    }
  }

  return signals;
}
