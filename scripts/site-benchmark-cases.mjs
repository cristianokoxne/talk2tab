const searchCases = [
  ["wiki-accessibility", "wikipedia", "https://www.wikipedia.org/", "Search for \"web accessibility\" on this site."],
  ["wiki-semantic-html", "wikipedia", "https://www.wikipedia.org/", "Search for \"semantic HTML\" on this site."],
  ["duck-accessibility", "duckduckgo", "https://duckduckgo.com/", "Search for \"web accessibility\" on this site."],
  ["duck-shadow-dom", "duckduckgo", "https://duckduckgo.com/", "Search for \"shadow DOM\" on this site."],
  ["bing-mv3", "bing", "https://www.bing.com/", "Search for \"Manifest V3\" on this site."],
  ["bing-aria", "bing", "https://www.bing.com/", "Search for \"ARIA roles\" on this site."],
  ["google-playwright", "google", "https://www.google.com/", "Search for \"Playwright browser testing\" on this site."],
  ["google-mutation-observer", "google", "https://www.google.com/", "Search for \"JavaScript MutationObserver\" on this site."],
  ["python-asyncio", "python-docs", "https://docs.python.org/3/", "Search for \"asyncio tasks\" in the Python documentation."],
  ["python-pathlib", "python-docs", "https://docs.python.org/3/", "Search for \"pathlib\" in the Python documentation."],
  ["devto-automation", "devto", "https://dev.to/", "Search for \"browser automation testing\" on this site."],
  ["devto-web-performance", "devto", "https://dev.to/", "Search for \"web performance testing\" on this site."],
  ["w3schools-html-form", "w3schools", "https://www.w3schools.com/", "Search for \"HTML forms\" on this site."],
  ["w3schools-css-overflow", "w3schools", "https://www.w3schools.com/", "Search for \"CSS overflow\" on this site."],
  ["chrome-sidepanel", "chrome-developer", "https://developer.chrome.com/", "Search for \"Side Panel API\" in Chrome docs."],
  ["chrome-extension-mv3", "chrome-developer", "https://developer.chrome.com/", "Search for \"Manifest V3 extensions\" in Chrome docs."],
  ["gitlab-ci", "gitlab", "https://about.gitlab.com/", "Search for \"continuous integration\" on GitLab."],
  ["gitlab-security", "gitlab", "https://about.gitlab.com/", "Search for \"application security\" on GitLab."],
  ["jsdelivr-cdn", "jsdelivr", "https://www.jsdelivr.com/", "Search for \"JavaScript CDN packages\" on jsDelivr."],
  ["jsdelivr-npm", "jsdelivr", "https://www.jsdelivr.com/", "Search for \"npm packages\" on jsDelivr."],
  ["w3-accessibility", "w3", "https://www.w3.org/", "Search for \"accessibility\" on the W3C site."],
  ["w3-web-components", "w3", "https://www.w3.org/", "Search for \"web components\" on the W3C site."],
  ["bbc-technology", "bbc", "https://www.bbc.com/", "Search for \"technology news\" on BBC."],
  ["bbc-science", "bbc", "https://www.bbc.com/", "Search for \"science news\" on BBC."],
];

const additionalCases = [
  ["wiki-scroll", "wikipedia", "https://www.wikipedia.org/", "Scroll down this page to inspect more site navigation.", "scroll", "development"],
  ["w3schools-scroll", "w3schools", "https://www.w3schools.com/", "Scroll down to inspect more learning topics on this page.", "scroll", "holdout"],
  ["bing-results", "bing", "https://www.bing.com/search?q=web+accessibility", "Open a result about web accessibility from this results page.", "results", "development"],
  ["google-results", "google", "https://www.google.com/search?q=web+accessibility", "Open an organic result about web accessibility from this results page.", "results", "holdout"],
  ["devto-navigation", "devto", "https://dev.to/", "Open the reading list navigation on this site.", "navigation", "development"],
  ["jsdelivr-navigation", "jsdelivr", "https://www.jsdelivr.com/", "Open the package browsing link on this site.", "navigation", "holdout"],
  ["chrome-menu", "chrome-developer", "https://developer.chrome.com/", "Open the Guides navigation menu.", "menu", "development"],
  ["gitlab-menu", "gitlab", "https://about.gitlab.com/", "Open the Products navigation menu.", "menu", "holdout"],
];

const inputCaseIds = new Set(["python-asyncio", "python-pathlib", "w3schools-html-form", "w3schools-css-overflow"]);
let searchIndex = 0;
export const siteBenchmarkCases = [...searchCases.map(([id, site, url, objective]) => {
  const family = inputCaseIds.has(id) ? "input" : "search";
  const split = family === "input" ? (id === "w3schools-css-overflow" ? "holdout" : "development") : (searchIndex++ < 14 ? "development" : "holdout");
  return {
  id, site, url, objective, family, split,
  query: objective.match(/["“]([^"”]+)["”]/)?.[1] ?? objective.split(" for ").at(-1).replace(/\.$/, ""),
};
}), ...additionalCases.map(([id, site, url, objective, family, split]) => ({ id, site, url, objective, family, split }))];

if (siteBenchmarkCases.length < 30 || new Set(siteBenchmarkCases.map(({ id }) => id)).size !== siteBenchmarkCases.length || new Set(siteBenchmarkCases.map(({ site }) => site)).size < 12 || new Set(siteBenchmarkCases.map(({ family }) => family)).size < 6) {
  throw new Error("Live-site benchmark must include at least 30 unique tasks across 12 domains and six families.");
}
