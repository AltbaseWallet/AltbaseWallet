(() => {
  const MARKET_REFRESH_MS = 30 * 60 * 1000;
  const MARKET_CACHE_PREFIX = "altbase:asset-market:v9:";
  const MARKET_API_VERSION = "20261114-complete-e";
  const CHART_CACHE_PREFIX = "altbase:asset-chart:v2:";
  const ASSET_PROFILE_SUMMARY = "Market data, trading venues, aggregators and official links for this supported asset.";
  const CHART_PERIODS = [
    { label: "24H", days: 1 },
    { label: "7D", days: 7 },
    { label: "30D", days: 30 },
    { label: "90D", days: 90 },
  ];

  const catalog = window.AltbaseAssetCatalog;
  if (!catalog?.assets?.length) throw Error('The website asset catalog is unavailable');
  const assets = catalog.assets.map(asset => ({...asset}));
  const historicalSlug = location.pathname.match(/^\/assets\/([^/]+)$/)?.[1];
  const archived = catalog.archivedAssets.find(asset => asset.slug === historicalSlug || asset.id === historicalSlug);
  if (archived) assets.push({...archived, delisted:true});
  const grid = document.querySelector("[data-asset-grid]");
  const profile = document.querySelector("[data-asset-profile]");
  const searchInput = document.querySelector("[data-asset-search]");
  const resultCount = document.querySelector("[data-asset-count]");
  const emptyState = document.querySelector("[data-asset-empty]");
  const searchPanel = document.querySelector(".asset-search-panel");
  const calculatorPanel = document.querySelector("[data-asset-calculator]");
  const calculatorAsset = document.querySelector("[data-calculator-asset]");
  const calculatorAmount = document.querySelector("[data-calculator-amount]");
  const calculatorOutput = document.querySelector("[data-calculator-output]");
  const calculatorRate = document.querySelector("[data-calculator-rate]");
  const directoryHead = document.querySelector(".asset-directory-head");
  const requestPanel = document.querySelector(".asset-request-panel");
  if (!grid || !profile) return;

  const marketCache = new Map();
  const pendingMarkets = new Map();
  const visibleMarketCards = new Set();
  const chartCache = new Map();
  const pendingCharts = new Map();
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const assetBySlug = new Map(assets.flatMap((asset) => [[asset.slug, asset], [asset.id, asset]]));
  const assetSearchIndex = new Map(assets.map((asset) => [
    asset.id,
    [
      asset.id,
      asset.slug,
      asset.name,
      asset.ticker,
      asset.marketTicker,
    ].filter(Boolean).join(" ").toLowerCase(),
  ]));
  const pathAssetMatch = window.location.pathname.match(/^\/assets\/([^/]+)$/);
  const pathAssetSlug = pathAssetMatch ? decodeURIComponent(pathAssetMatch[1]) : "";
  const hashAssetSlug = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  const detailAsset = assetBySlug.get(pathAssetSlug);
  const legacyHashAsset = !pathAssetMatch ? assetBySlug.get(hashAssetSlug) : null;
  const isDetailPage = Boolean(pathAssetMatch);
  let selectedId = null;
  let selectedChartDays = 30;

  if (legacyHashAsset) {
    window.location.replace(`/assets/${legacyHashAsset.slug}`);
    return;
  }

  const moneyFormat = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  });

  const compactMoneyFormat = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  });

  const calculatorMoneyFormat = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function applyTranslations(root = document.body) {
    window.AltbaseI18n?.apply?.(root);
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function formatUsd(value, compact = false) {
    if (!Number.isFinite(value)) return "No data";
    if (value > 0 && value < 0.000001) {
      const fixed = value.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
      return fixed !== "0" ? `$${fixed}` : `$${value.toExponential(2)}`;
    }
    return compact ? compactMoneyFormat.format(value) : moneyFormat.format(value);
  }

  function formatVolume(value) {
    return Number.isFinite(value) ? compactMoneyFormat.format(value) : "No data";
  }

  function formatMarketCap(value) {
    return Number.isFinite(value) && value > 0 ? compactMoneyFormat.format(value) : "N/A";
  }

  function formatCalculatorUsd(value) {
    if (!Number.isFinite(value)) return "No data";
    if (value > 0 && value < 0.000001) return formatUsd(value);
    if (value > 0 && value < 0.01) return `$${value.toFixed(6)}`;
    if (Math.abs(value) >= 1000000000000000) return `$${value.toExponential(2).replace("e+", "e")}`;
    if (Math.abs(value) >= 1000000000) return compactMoneyFormat.format(value);
    return calculatorMoneyFormat.format(value);
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return "No data";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  }

  function classForPercent(value) {
    if (!Number.isFinite(value) || value === 0) return "";
    return value > 0 ? "positive" : "negative";
  }

  function labelForType(type) {
    const labels = {
      announcement: "Bitcointalk",
      blog: "Blog",
      chat: "Chat",
      discord: "Discord",
      explorer: "Explorer",
      facebook: "Facebook",
      market: "Market",
      market_data: "Market data",
      reddit: "Reddit",
      source_code: "GitHub",
      telegram: "Telegram",
      twitter: "X / Twitter",
      wallet: "Wallet",
      website: "Website",
      youtube: "YouTube",
    };
    return labels[type] || String(type || "Link").replaceAll("_", " ");
  }

  function isBitcointalkLink(url) {
    return String(url || "").toLowerCase().includes("bitcointalk.org");
  }

  function linkPill(link) {
    const url = safeUrl(link.url);
    if (!url) return "";
    const label = link.label || (url.includes("github.com") ? "GitHub" : isBitcointalkLink(url) ? "Bitcointalk" : labelForType(link.type));
    return `<a class="asset-link-pill" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }

  function linkPriority(link) {
    const url = String(link.url || "").toLowerCase();
    if (link.type === "source_code" || url.includes("github.com")) return 0;
    if (link.type === "website") return 1;
    if (link.type === "announcement" || isBitcointalkLink(url)) return 2;
    if (link.type === "twitter" || link.type === "discord" || link.type === "telegram") return 3;
    if (link.type === "explorer") return 4;
    if (link.type === "market" || link.type === "market_data") return 5;
    return 6;
  }

  function mergeLinks(asset, market) {
    const seen = new Set();
    const links = [];
    for (const link of [...asset.aggregators, ...(market?.links || [])]) {
      const url = safeUrl(link.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      links.push({ ...link, url });
    }
    return links.sort((a, b) => linkPriority(a) - linkPriority(b));
  }

  function requestJson(url) {
    if (typeof window.fetch === "function") {
      return window.fetch(url, { headers: { "Accept": "application/json" }, signal: window.AbortSignal?.timeout?.(20000) }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
        return data;
      });
    }

    return new Promise((resolve, reject) => {
      if (typeof window.XMLHttpRequest !== "function") {
        reject(new Error("Live market data is not available in this browser."));
        return;
      }

      const request = new window.XMLHttpRequest();
      request.open("GET", url);
      request.setRequestHeader("Accept", "application/json");
      request.onload = () => {
        try {
          const data = JSON.parse(request.responseText || "{}");
          if (request.status < 200 || request.status >= 300) {
            reject(new Error(data.error || `Request failed: ${request.status}`));
            return;
          }
          resolve(data);
        } catch (error) {
          reject(error);
        }
      };
      request.timeout = 20000;
      request.ontimeout = () => reject(new Error("Market request timed out."));
      request.onerror = () => reject(new Error("Market request failed."));
      request.send();
    });
  }

  function persistentKey(prefix, assetId, suffix = "") {
    return `${prefix}${assetId}${suffix}`;
  }

  function chartCacheKey(assetId, days = selectedChartDays) {
    return `${assetId}:${days}`;
  }

  function readPersistentCache(key) {
    try {
      const raw = window.localStorage?.getItem(key);
      if (!raw) return null;

      const cached = JSON.parse(raw);
      if (!cached || !cached.data || !Number.isFinite(cached.expiresAt)) return null;

      if (cached.expiresAt <= Date.now()) {
        window.localStorage?.removeItem(key);
        return null;
      }

      return cached;
    } catch (error) {
      return null;
    }
  }

  function writePersistentCache(key, data, ttlMs = MARKET_REFRESH_MS) {
    try {
      window.localStorage?.setItem(key, JSON.stringify({
        data,
        expiresAt: Date.now() + ttlMs,
      }));
    } catch (error) {
      // Storage can be unavailable in private modes; the in-memory cache still works.
    }
  }

  function getFreshMarketEntry(assetId) {
    const cached = marketCache.get(assetId);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const persistent = readPersistentCache(persistentKey(MARKET_CACHE_PREFIX, assetId));
    if (persistent) {
      marketCache.set(assetId, persistent);
      return persistent;
    }

    return null;
  }

  function getFreshChartEntry(assetId, days = 30) {
    const cacheKey = chartCacheKey(assetId, days);
    const cached = chartCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const persistent = readPersistentCache(persistentKey(CHART_CACHE_PREFIX, assetId, `:${days}`));
    if (persistent) {
      chartCache.set(cacheKey, persistent);
      return persistent;
    }

    return null;
  }

  function renderGrid() {
    grid.innerHTML = `
      <div class="asset-list-head" aria-hidden="true">
        <span>Coin</span>
        <span>Price</span>
        <span>24h</span>
        <span>Volume</span>
        <span>Markets</span>
        <span>Market Cap</span>
        <span>ATH</span>
      </div>
      ${assets.map((asset) => `
      <a id="${escapeHtml(asset.slug)}" class="asset-market-row" data-asset-id="${escapeHtml(asset.id)}" href="/assets/${escapeHtml(asset.slug)}" aria-label="Open ${escapeHtml(asset.name)} market profile">
        <div class="asset-market-coin">
          <img class="asset-logo" src="${escapeHtml(asset.icon)}" alt="">
          <div>
            <strong>${escapeHtml(asset.name)}</strong>
            <span>${escapeHtml(asset.marketTicker ? `${asset.ticker} / ${asset.marketTicker}` : asset.ticker)}</span>
          </div>
        </div>
        <strong class="asset-market-price" data-card-price>Pending</strong>
        <span class="asset-market-change" data-card-change>--</span>
        <strong class="asset-market-volume" data-card-volume>Pending</strong>
        <span class="asset-market-count" data-card-markets>--</span>
        <strong class="asset-market-cap" data-card-marketcap>Pending</strong>
        <strong class="asset-market-ath" data-card-ath>Pending</strong>
      </a>
      `).join("")}
    `;
  }

  function filterAssets(query) {
    const terms = String(query || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return assets;
    return assets.filter((asset) => {
      const index = assetSearchIndex.get(asset.id) || "";
      return terms.every((term) => index.includes(term));
    });
  }

  function applyAssetFilter() {
    const matches = filterAssets(searchInput?.value || "");
    const visibleIds = new Set(matches.map((asset) => asset.id));

    grid.querySelectorAll("[data-asset-id]").forEach((card) => {
      card.hidden = !visibleIds.has(card.dataset.assetId);
      if (card.hidden) visibleMarketCards.delete(card);
    });

    if (resultCount) {
      resultCount.textContent = `${matches.length} / ${assets.length}`;
    }

    if (emptyState) {
      emptyState.hidden = matches.length > 0;
    }

    updateActiveCard();
    scanVisibleMarketCards();
  }

  function populateCalculator(defaultAssetId = assets[0]?.id) {
    if (!calculatorAsset) return;
    calculatorAsset.innerHTML = assets.map((asset) => {
      const ticker = asset.marketTicker ? `${asset.ticker} / ${asset.marketTicker}` : asset.ticker;
      return `<option value="${escapeHtml(asset.id)}">${escapeHtml(asset.name)} (${escapeHtml(ticker)})</option>`;
    }).join("");
    if (defaultAssetId && assetById.has(defaultAssetId)) {
      calculatorAsset.value = defaultAssetId;
    }
  }

  function parseAssetAmount(value) {
    const normalized = String(value || "").trim().replace(",", ".");
    if (!normalized) return 0;
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }

  function updateCalculator(options = {}) {
    if (!calculatorAsset || !calculatorAmount || !calculatorOutput || !calculatorRate) return;
    const asset = assetById.get(calculatorAsset.value) || assets[0];
    if (!asset) return;

    const cached = getFreshMarketEntry(asset.id);
    const market = cached?.data;
    const isFresh = cached && cached.expiresAt > Date.now();
    const hasAmount = String(calculatorAmount.value || "").trim() !== "";
    const amount = parseAssetAmount(calculatorAmount.value);

    if (!hasAmount) {
      calculatorOutput.textContent = "Enter amount";
      calculatorRate.textContent = market && isFresh && Number.isFinite(market.priceUsd)
        ? `1 ${asset.ticker} ~ ${formatUsd(market.priceUsd)}`
        : "Choose an asset and enter amount.";
      return;
    }

    if ((!market || !isFresh) && options.allowFetch !== false) {
      calculatorOutput.textContent = "Loading";
      calculatorRate.textContent = `Loading ${asset.ticker} price...`;
      loadMarket(asset).finally(() => updateCalculator({ allowFetch: false }));
      return;
    }

    const price = market?.priceUsd;
    if (!isFresh || !Number.isFinite(price)) {
      calculatorOutput.textContent = "No data";
      calculatorRate.textContent = "Price is not available.";
      return;
    }

    calculatorOutput.textContent = formatCalculatorUsd(amount * price);
    calculatorRate.textContent = `1 ${asset.ticker} ~ ${formatUsd(price)}`;
  }

  function updateActiveCard() {
    grid.querySelectorAll("[data-asset-id]").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.assetId === selectedId);
    });
  }

  function updateCardMarket(assetId, market, error) {
    const card = grid.querySelector(`[data-asset-id="${assetId}"]`);
    if (!card) return;

    const price = card.querySelector("[data-card-price]");
    const volume = card.querySelector("[data-card-volume]");
    const change = card.querySelector("[data-card-change]");
    const markets = card.querySelector("[data-card-markets]");
    const marketCap = card.querySelector("[data-card-marketcap]");
    const ath = card.querySelector("[data-card-ath]");

    if (error) {
      if (price) price.textContent = "No data";
      if (volume) volume.textContent = "No data";
      if (change) change.textContent = "--";
      if (markets) markets.textContent = "--";
      if (marketCap) marketCap.textContent = "No data";
      if (ath) ath.textContent = "No data";
      return;
    }

    if (price) price.textContent = formatUsd(market?.priceUsd);
    if (volume) volume.textContent = formatVolume(market?.volume24h);
    if (change) {
      change.textContent = formatPercent(market?.change24h);
      change.classList.toggle("positive", Number(market?.change24h) > 0);
      change.classList.toggle("negative", Number(market?.change24h) < 0);
    }
    if (markets) markets.textContent = !market?.unavailable && !market?.statsUnavailable && Number.isFinite(market?.markets?.length) ? String(market.markets.length) : "--";
    if (marketCap) marketCap.textContent = formatMarketCap(market?.marketCap);
    if (ath) ath.textContent = formatUsd(market?.athPrice);
  }

  function metric(label, value, className = "") {
    return `<div class="asset-metric"><span>${escapeHtml(label)}</span><strong class="${escapeHtml(className)}">${escapeHtml(value)}</strong></div>`;
  }

  function fact(label, value) {
    return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  }

  function renderChangeBadge(value, state) {
    if (state === "loading") return `<span class="asset-change-badge">Loading</span>`;
    if (!Number.isFinite(value)) return `<span class="asset-change-badge">No 24h change</span>`;
    return `<span class="asset-change-badge ${escapeHtml(classForPercent(value))}">${escapeHtml(formatPercent(value))} 24h</span>`;
  }

  function renderMarkets(market) {
    if (!market) return `<div class="asset-empty">Loading trading venues...</div>`;
    if (market.unavailableReason === "no_market_source") {
      return `<div class="asset-empty">No verified market price source is currently configured for this asset.</div>`;
    }
    if (!market.markets?.length) {
      return `<div class="asset-empty">No public trading venues were returned by the selected market source.</div>`;
    }

    return `
      <table class="asset-market-table">
        <thead>
          <tr><th>Market</th><th>Exchange</th><th>Price</th><th>24h volume</th></tr>
        </thead>
        <tbody>
          ${market.markets.map((row) => {
            const exchange = escapeHtml(row.exchange);
            const marketUrl = safeUrl(row.url);
            const pair = escapeHtml(row.pair || "Market");
            const pairCell = marketUrl
              ? `<a href="${escapeHtml(marketUrl)}" target="_blank" rel="noopener noreferrer">${pair}</a>`
              : pair;
            const exchangeCell = marketUrl
              ? `<a href="${escapeHtml(marketUrl)}" target="_blank" rel="noopener noreferrer">${exchange}</a>`
              : exchange;
            return `
              <tr>
                <td>${pairCell}</td>
                <td>${exchangeCell}</td>
                <td>${escapeHtml(formatUsd(row.priceUsd))}</td>
                <td>${escapeHtml(formatVolume(row.volume24h))}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  function chartRange(points) {
    const prices = points.map((point) => Number(point.priceUsd)).filter(Number.isFinite);
    if (prices.length < 2) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return { min, max: max === min ? max * 1.01 : max };
  }

  function chartPath(points, width, height, range) {
    const min = range.min;
    const max = range.max;
    const span = max - min || 1;
    const lastIndex = Math.max(points.length - 1, 1);
    return points.map((point, index) => {
      const x = (index / lastIndex) * width;
      const y = height - ((Number(point.priceUsd) - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(" ");
  }

  function chartPeriodLabel(days = selectedChartDays) {
    return CHART_PERIODS.find((period) => period.days === Number(days))?.label || "30D";
  }

  function renderChartTabs() {
    return CHART_PERIODS.map((period) => {
      const active = period.days === selectedChartDays;
      return `
        <button class="${active ? "is-active" : ""}" type="button" data-chart-days="${period.days}" aria-pressed="${active ? "true" : "false"}">
          ${escapeHtml(period.label)}
        </button>
      `;
    }).join("");
  }

  function renderPriceChart(data, days = selectedChartDays) {
    const points = Array.isArray(data?.points) ? data.points : [];
    const range = chartRange(points);
    const periodLabel = chartPeriodLabel(days);
    if (!range) {
      return `
        <div class="asset-chart-empty">
          <strong>No chart data</strong>
          <span>Not enough public historical price data is available for this chart.</span>
        </div>
      `;
    }

    const width = 720;
    const height = 250;
    const line = chartPath(points, width, height, range);
    const area = `${line} L${width} ${height} L0 ${height} Z`;
    const first = points[0];
    const last = points[points.length - 1];
    const change = ((Number(last.priceUsd) - Number(first.priceUsd)) / Number(first.priceUsd)) * 100;
    const start = new Date(first.time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const end = new Date(last.time).toLocaleDateString(undefined, { month: "short", day: "numeric" });

    return `
      <div class="asset-chart-meta">
        <span>${escapeHtml(start)} - ${escapeHtml(end)}</span>
        <strong class="${escapeHtml(classForPercent(change))}">${escapeHtml(formatPercent(change))}</strong>
      </div>
      <svg class="asset-price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(periodLabel)} price chart">
        <defs>
          <linearGradient id="assetChartFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="currentColor" stop-opacity=".22"></stop>
            <stop offset="100%" stop-color="currentColor" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <path class="asset-chart-gridline" d="M0 62.5H720 M0 125H720 M0 187.5H720"></path>
        <path class="asset-chart-area" d="${escapeHtml(area)}"></path>
        <path class="asset-chart-line" d="${escapeHtml(line)}"></path>
      </svg>
      <div class="asset-chart-axis">
        <span>${escapeHtml(formatUsd(range.min))}</span>
        <span>${escapeHtml(formatUsd(range.max))}</span>
      </div>
    `;
  }

  function setChartPanel(html) {
    const chartBody = profile.querySelector("[data-asset-chart-body]");
    if (chartBody) chartBody.innerHTML = html;
  }

  async function loadChart(asset, days = selectedChartDays) {
    const safeDays = CHART_PERIODS.some((period) => period.days === Number(days)) ? Number(days) : 30;
    const requestKey = chartCacheKey(asset.id, safeDays);
    const cached = getFreshChartEntry(asset.id, safeDays);
    if (cached) {
      setChartPanel(renderPriceChart(cached.data, safeDays));
      return cached.data;
    }

    const pending = pendingCharts.get(requestKey);
    if (pending) return pending;

    const request = requestJson(`/api/asset-chart?id=${encodeURIComponent(asset.id)}&days=${safeDays}`)
      .then((data) => {
        const entry = {
          data,
          expiresAt: Date.now() + MARKET_REFRESH_MS,
        };
        chartCache.set(requestKey, entry);
        writePersistentCache(persistentKey(CHART_CACHE_PREFIX, asset.id, `:${safeDays}`), data);
        if (selectedId === asset.id && selectedChartDays === safeDays) {
          setChartPanel(renderPriceChart(data, safeDays));
        }
        return data;
      })
      .catch(() => {
        if (selectedId === asset.id && selectedChartDays === safeDays) {
          setChartPanel(`
            <div class="asset-chart-empty">
              <strong>No chart data</strong>
              <span>Historical ${escapeHtml(chartPeriodLabel(safeDays))} price data is unavailable for this asset right now.</span>
            </div>
          `);
        }
        return null;
      })
      .finally(() => {
        pendingCharts.delete(requestKey);
      });

    pendingCharts.set(requestKey, request);
    return request;
  }

  function renderProfile(asset, market, state = "ready", error = "") {
    const links = mergeLinks(asset, market);
    const heroLinks = links.slice(0, 4);
    const actionLinks = heroLinks.map(linkPill).join("");
    const allLinks = links.map(linkPill).join("");
    const explorers = links.filter((link) => link.type === "explorer").map(linkPill).join("");
    const change = market?.change24h;
    const marketContent = state === "error"
      ? `<div class="asset-empty">Market data could not be loaded: ${escapeHtml(error)}</div>`
      : renderMarkets(market);
    const priceText = state === "loading" ? "Loading" : formatUsd(market?.priceUsd);
    const volumeText = state === "loading" ? "Loading" : formatVolume(market?.volume24h);
    const marketCount = !market?.unavailable && !market?.statsUnavailable && Number.isFinite(market?.markets?.length) ? String(market.markets.length) : "--";
    const marketTicker = asset.marketTicker || market?.symbol || asset.ticker;

    profile.innerHTML = `
      <a class="asset-back-link" href="/assets">Back to all assets</a>
      <div class="asset-profile-shell">
        <section class="asset-coin-header">
          <div class="asset-coin-main">
            <div class="asset-profile-title">
              <img src="${escapeHtml(asset.icon)}" alt="${escapeHtml(asset.name)}">
              <div>
                <span class="asset-profile-ticker">${escapeHtml(asset.ticker)}${asset.marketTicker ? ` / ${escapeHtml(asset.marketTicker)}` : ""}</span>
                <h2>${escapeHtml(asset.name)}</h2>
                <div class="asset-coin-tags">
                  <span>Altbase ${escapeHtml(asset.ticker)}</span>
                  ${asset.marketTicker ? `<span>Markets ${escapeHtml(asset.marketTicker)}</span>` : ""}
                </div>
              </div>
            </div>
            <p class="asset-profile-copy">${escapeHtml(asset.summary)}</p>
          </div>
          <div class="asset-price-card">
            <span>Price in USD</span>
            <strong>${escapeHtml(priceText)}</strong>
            ${renderChangeBadge(change, state)}
            <div class="asset-profile-actions">${actionLinks}</div>
          </div>
        </section>
        <div class="asset-metric-strip">
          ${metric("24h volume", volumeText)}
          ${metric("Market cap", state === "loading" ? "Loading" : formatMarketCap(market?.marketCap))}
          ${metric("All-time high", state === "loading" ? "Loading" : formatUsd(market?.athPrice))}
          ${metric("Markets", marketCount)}
        </div>
        <div class="asset-lcw-layout">
          <div class="asset-main-column">
            <section class="asset-chart-panel">
              <div class="asset-panel-head">
                <div>
                  <span class="eyebrow">${escapeHtml(marketTicker)} <span>Price Chart</span></span>
                  <h3 data-asset-chart-title>${escapeHtml(chartPeriodLabel(selectedChartDays))} <span>USD chart</span></h3>
                </div>
                <div class="asset-chart-tabs" aria-label="Chart range">${renderChartTabs()}</div>
              </div>
              <div class="asset-chart-body" data-asset-chart-body>
                <div class="asset-chart-empty"><strong>Loading chart</strong><span>Fetching historical price data.</span></div>
              </div>
            </section>
            <section class="asset-market-panel">
              <div class="asset-panel-head">
                <div>
                  <span class="eyebrow">${escapeHtml(marketTicker)} <span>Markets</span></span>
                  <h3>Trading venues</h3>
                </div>
              </div>
              ${marketContent}
            </section>
          </div>
          <aside class="asset-side-rail">
            <section class="asset-info-panel">
              <span class="eyebrow"><span>All About</span> ${escapeHtml(asset.ticker)}</span>
              <h3>${escapeHtml(asset.name)}</h3>
              <dl class="asset-fact-list">
                ${fact("Price in USD", priceText)}
                ${fact("24h volume", volumeText)}
                ${fact("Market cap", state === "loading" ? "Loading" : formatMarketCap(market?.marketCap))}
                ${fact("All-time high", state === "loading" ? "Loading" : formatUsd(market?.athPrice))}
              </dl>
            </section>
            ${explorers ? `
              <section class="asset-info-panel">
                <span class="eyebrow">Explorers</span>
                <div class="asset-link-grid">${explorers}</div>
              </section>
            ` : ""}
            <section class="asset-info-panel">
              <span class="eyebrow">Links</span>
              <h3>Sources and community</h3>
              <div class="asset-link-grid">${allLinks || `<span class="asset-empty">No public links returned.</span>`}</div>
            </section>
          </aside>
        </div>
      </div>
    `;
    applyTranslations(profile);
    loadChart(asset, selectedChartDays);
  }

  async function loadMarket(asset, options = {}) {
    const cached = !options.force ? getFreshMarketEntry(asset.id) : null;
    if (cached) {
      updateCardMarket(asset.id, cached.data);
      if (calculatorAsset?.value === asset.id) updateCalculator({ allowFetch: false });
      if (selectedId === asset.id) renderProfile(asset, cached.data);
      return cached.data;
    }

    const pending = pendingMarkets.get(asset.id);
    if (pending) return pending;

    const request = (async () => {
      const market = await requestJson(`/api/asset-market?id=${encodeURIComponent(asset.id)}&v=${encodeURIComponent(MARKET_API_VERSION)}`);
      const entry = {
        data: market,
        expiresAt: Date.now() + (market?.fallback || !Number.isFinite(market?.priceUsd) ? 30000 : MARKET_REFRESH_MS),
      };
      marketCache.set(asset.id, entry);
      writePersistentCache(persistentKey(MARKET_CACHE_PREFIX, asset.id), market, market?.fallback || !Number.isFinite(market?.priceUsd) ? 30000 : MARKET_REFRESH_MS);
      updateCardMarket(asset.id, market);
      if (calculatorAsset?.value === asset.id) updateCalculator({ allowFetch: false });
      if (selectedId === asset.id) renderProfile(asset, market);
      return market;
    })().catch((error) => {
      updateCardMarket(asset.id, null, error);
      if (selectedId === asset.id) renderProfile(asset, null, "error", error.message);
      return null;
    }).finally(() => {
      pendingMarkets.delete(asset.id);
    });

    pendingMarkets.set(asset.id, request);
    return request;
  }

  function loadCardMarket(card, options = {}) {
    if (!card || card.hidden) return;
    const asset = assetById.get(card.dataset.assetId);
    if (asset) loadMarket(asset, options);
  }

  function isCardInViewport(card) {
    const rect = card.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
  }

  function scanVisibleMarketCards(options = {}) {
    grid.querySelectorAll("[data-asset-id]").forEach((card) => {
      if (!card.hidden && isCardInViewport(card)) {
        visibleMarketCards.add(card);
        loadCardMarket(card, options);
      } else {
        visibleMarketCards.delete(card);
      }
    });
  }

  function setupLazyMarketCards() {
    const cards = [...grid.querySelectorAll("[data-asset-id]")];

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const card = entry.target;
          if (entry.isIntersecting && !card.hidden) {
            visibleMarketCards.add(card);
            loadCardMarket(card);
          } else {
            visibleMarketCards.delete(card);
          }
        });
      }, { threshold: 0.16 });

      cards.forEach((card) => observer.observe(card));
    }

    scanVisibleMarketCards();
    window.addEventListener("scroll", () => scanVisibleMarketCards(), { passive: true });
    window.addEventListener("resize", () => scanVisibleMarketCards());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scanVisibleMarketCards();
    });
    window.setInterval(() => scanVisibleMarketCards(), 750);
  }

  function refreshVisibleMarketCards() {
    visibleMarketCards.forEach((card) => {
      if (document.body.contains(card) && !card.hidden) {
        loadCardMarket(card, { force: true });
      }
    });
  }

  function selectAsset(assetId, shouldScroll = false) {
    const asset = assetById.get(assetId);
    if (!asset) return;

    selectedId = asset.id;
    updateActiveCard();
    const cached = getFreshMarketEntry(asset.id);
    renderProfile(asset, cached?.data, cached ? "ready" : "loading");
    loadMarket(asset);

    if (shouldScroll) {
      profile.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  profile.addEventListener("click", (event) => {
    const button = event.target.closest("[data-chart-days]");
    if (!button || !profile.contains(button)) return;

    const days = Number(button.dataset.chartDays);
    if (!CHART_PERIODS.some((period) => period.days === days)) return;

    event.preventDefault();
    if (selectedChartDays === days) return;

    selectedChartDays = days;
    profile.querySelectorAll("[data-chart-days]").forEach((tab) => {
      const isActive = Number(tab.dataset.chartDays) === selectedChartDays;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    const chartTitle = profile.querySelector("[data-asset-chart-title]");
    if (chartTitle) chartTitle.innerHTML = `${escapeHtml(chartPeriodLabel(selectedChartDays))} <span>USD chart</span>`;

    setChartPanel(`
      <div class="asset-chart-empty">
        <strong>Loading chart</strong>
        <span>Fetching ${escapeHtml(chartPeriodLabel(selectedChartDays))} price data.</span>
      </div>
    `);

    const asset = assetById.get(selectedId);
    if (asset) loadChart(asset, selectedChartDays);
  });

  setInterval(() => {
    const entry = selectedId ? marketCache.get(selectedId) : null;
    if (entry && (entry.data?.fallback || !Number.isFinite(entry.data?.priceUsd)) && entry.expiresAt <= Date.now()) {
      const asset = assetById.get(selectedId); if (asset) loadMarket(asset, {force:true});
    }
  }, 30000);

  if (isDetailPage) {
    document.body.classList.add("asset-detail-page");
    if (searchPanel) searchPanel.hidden = true;
    if (emptyState) emptyState.hidden = true;
    if (grid) grid.hidden = true;
    if (requestPanel) requestPanel.hidden = true;
    populateCalculator(detailAsset?.id || assets[0]?.id);
    calculatorAsset?.addEventListener("change", () => updateCalculator());
    calculatorAmount?.addEventListener("input", () => updateCalculator());

    if (directoryHead) {
      const title = directoryHead.querySelector("h2");
      const lead = directoryHead.querySelector(".lead");
      const action = directoryHead.querySelector("a.button");
      if (title) {
        if (detailAsset) {
          title.innerHTML = `${escapeHtml(detailAsset.name)} <span>Profile</span>`;
        } else {
          title.textContent = "Asset not found";
        }
      }
      if (lead) {
        lead.textContent = detailAsset
          ? ASSET_PROFILE_SUMMARY
          : "This asset profile does not exist in the Altbase Wallet catalog.";
      }
      if (action) {
        action.textContent = "All assets";
        action.href = "/assets";
      }
      applyTranslations(directoryHead);
    }

    profile.hidden = false;
    if (detailAsset) {
      selectAsset(detailAsset.id);
      updateCalculator();
      window.setInterval(() => {
        loadMarket(detailAsset, { force: true });
      }, MARKET_REFRESH_MS);
    } else {
      if (calculatorPanel) calculatorPanel.hidden = true;
      profile.innerHTML = `<div class="asset-empty"><a href="/assets">Back to supported assets</a></div>`;
    }
    return;
  }

  document.body.classList.add("asset-catalog-page");
  profile.hidden = true;
  renderGrid();
  populateCalculator();
  calculatorAsset?.addEventListener("change", () => updateCalculator());
  calculatorAmount?.addEventListener("input", () => updateCalculator());
  updateCalculator();
  searchInput?.addEventListener("input", applyAssetFilter);
  setupLazyMarketCards();
  applyAssetFilter();
  window.setInterval(refreshVisibleMarketCards, MARKET_REFRESH_MS);
})();
