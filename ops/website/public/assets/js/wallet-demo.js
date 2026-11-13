(() => {
  const root = document.querySelector("[data-wallet-demo]");
  if (!root) return;

  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const price = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 });
  const amount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
  const coins = [
  {
    "id": "btc",
    "marketId": "bitcoin",
    "name": "Bitcoin",
    "ticker": "BTC",
    "icon": "assets/img/coins/bitcoin.svg",
    "balance": 0.042,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "BTC-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "ethereum",
    "marketId": "ethereum",
    "name": "Ethereum",
    "ticker": "ETH",
    "icon": "assets/img/coins/../networks/ethereum.png",
    "balance": 1.24,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "ETH-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "bsc",
    "marketId": "bsc",
    "name": "BNB Smart Chain",
    "ticker": "BNB",
    "icon": "assets/img/coins/../networks/bsc.png",
    "balance": 3.6,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "BNB-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "solana",
    "marketId": "solana",
    "name": "Solana",
    "ticker": "SOL",
    "icon": "assets/img/coins/../networks/solana.png",
    "balance": 24.5,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "SOL-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "polygon",
    "marketId": "polygon",
    "name": "Polygon",
    "ticker": "POL",
    "icon": "assets/img/coins/../networks/polygon.png",
    "balance": 1250,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "POL-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "arbitrum",
    "marketId": "arbitrum",
    "name": "Arbitrum One",
    "ticker": "ETH",
    "icon": "assets/img/coins/../networks/arbitrum.png",
    "balance": 0.48,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "ETH-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "tron",
    "marketId": "tron",
    "name": "Tron",
    "ticker": "TRX",
    "icon": "assets/img/coins/../networks/tron.png",
    "balance": 3400,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "TRX-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "bc2",
    "marketId": "bitcoin2",
    "name": "Bitcoin II",
    "ticker": "BC2",
    "icon": "assets/img/coins/bitcoinII.png",
    "balance": 12430,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "BC2-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "bch2",
    "marketId": "bitcoincashii",
    "name": "Bitcoin Cash II",
    "ticker": "BCH2",
    "icon": "assets/img/coins/bch2.png",
    "balance": 9840,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "BCH2-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "firo",
    "marketId": "firo",
    "name": "Firo",
    "ticker": "FIRO",
    "icon": "assets/img/coins/firo.png",
    "balance": 125,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "FIRO-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "caps",
    "marketId": "capstash",
    "name": "CapStash",
    "ticker": "CAPS",
    "icon": "assets/img/coins/CapStash.png",
    "balance": 9120,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "CAPS-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "pep",
    "marketId": "pepecoin",
    "name": "Pepecoin",
    "ticker": "PEPE",
    "icon": "assets/img/coins/pepecoin.png",
    "balance": 840000,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "PEPE-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "ker",
    "marketId": "kerrigan",
    "name": "Kerrigan",
    "ticker": "KER",
    "icon": "assets/img/coins/kerrigan.png",
    "balance": 760,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "KER-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "scash",
    "marketId": "scash",
    "name": "Scash",
    "ticker": "SCASH",
    "icon": "assets/img/coins/scash.png",
    "balance": 14300,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "SCASH-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "lc2",
    "marketId": "litecoinii",
    "name": "LitecoinII",
    "ticker": "LC2",
    "icon": "assets/img/coins/litecoinii.png",
    "balance": 8900,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "LC2-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "neox",
    "marketId": "neoxa",
    "name": "Neoxa",
    "ticker": "NEOX",
    "icon": "assets/img/coins/neoxa.png",
    "balance": 1400000,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "NEOX-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "trc",
    "marketId": "terracoin",
    "name": "Terracoin",
    "ticker": "TRC",
    "icon": "assets/img/coins/terracoin.png",
    "balance": 5800,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "TRC-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "rtm",
    "marketId": "raptoreum",
    "name": "Raptoreum",
    "ticker": "RTM",
    "icon": "assets/img/coins/raptoreum.png",
    "balance": 220000,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "RTM-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "quai",
    "marketId": "quai",
    "name": "Quai Network",
    "ticker": "QUAI",
    "icon": "assets/img/coins/quai.png",
    "balance": 3200,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "QUAI-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "qubic",
    "marketId": "qubic",
    "name": "Qubic",
    "ticker": "QUBIC",
    "icon": "assets/img/coins/qubic.png",
    "balance": 25000000,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "QUBIC-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "kas",
    "marketId": "kaspa",
    "name": "Kaspa",
    "ticker": "KAS",
    "icon": "assets/img/coins/kaspa.png",
    "balance": 1250,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "KAS-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "ckb",
    "marketId": "ckb",
    "name": "Nervos",
    "ticker": "CKB",
    "icon": "assets/img/coins/ckb.svg",
    "balance": 50000,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "CKB-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "prl",
    "marketId": "pearl",
    "name": "Pearl",
    "ticker": "PRL",
    "icon": "assets/img/coins/prl.png",
    "balance": 64,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "PRL-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "jkc",
    "marketId": "junkcoin",
    "name": "Junkcoin",
    "ticker": "JKC",
    "icon": "assets/img/coins/junkcoin.png",
    "balance": 16000,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "JKC-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "zano",
    "marketId": "zano",
    "name": "Zano",
    "ticker": "ZANO",
    "icon": "assets/img/coins/zano.png",
    "balance": 18.42,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "ZANO-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "epic",
    "marketId": "epic",
    "name": "Epic Cash",
    "ticker": "EPIC",
    "icon": "assets/img/coins/epiccash.png",
    "balance": 54,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "EPIC-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "xmr",
    "marketId": "monero",
    "name": "Monero",
    "ticker": "XMR",
    "icon": "assets/img/coins/monero.png",
    "balance": 1.25,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "XMR-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "xgr",
    "marketId": "xgr",
    "name": "XGR",
    "ticker": "XGR",
    "icon": "assets/img/coins/xgr.png",
    "balance": 5000,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "XGR-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "bch",
    "marketId": "bitcoincash",
    "name": "Bitcoin Cash",
    "ticker": "BCH",
    "icon": "assets/img/coins/bitcoincash.svg",
    "balance": 0.72,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "BCH-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "dgb",
    "marketId": "digibyte",
    "name": "DigiByte",
    "ticker": "DGB",
    "icon": "assets/img/coins/digibyte.svg",
    "balance": 58000,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "DGB-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "ppc",
    "marketId": "peercoin",
    "name": "Peercoin",
    "ticker": "PPC",
    "icon": "assets/img/coins/peercoin.svg",
    "balance": 450,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "PPC-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "zec",
    "marketId": "zcash",
    "name": "Zcash",
    "ticker": "ZEC",
    "icon": "assets/img/coins/zcash.svg",
    "balance": 0.32,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "ZEC-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "nexa",
    "marketId": "nexa",
    "name": "Nexa",
    "ticker": "NEXA",
    "icon": "assets/img/coins/nexa.svg",
    "balance": 180000000,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "NEXA-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "xel",
    "marketId": "xelis",
    "name": "Xelis",
    "ticker": "XEL",
    "icon": "assets/img/coins/xelis.svg",
    "balance": 1700,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "XEL-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  },
  {
    "id": "mwc",
    "marketId": "mwc",
    "name": "MimbleWimbleCoin",
    "ticker": "MWC",
    "icon": "assets/img/coins/mwc.svg",
    "balance": 35,
    "price": null,
    "priceAt": null,
    "enabled": true,
    "address": "MWC-DEMO-ADDRESS-NOT-FOR-PAYMENTS"
  }
];
  let selectedCoinId = coins[0].id;
  let receiveCoinId = coins[0].id;
  let filter = "all";
  let sortByValue = true;
  let hideBalances = false;
  let historyPage = 1;
  let settingsSection = "security";

  const transactions = [
    {type: "receive", title: "Received ETH", time: "Today, 16:04", value: "+0.24 ETH", coinId: "ethereum"},
    {type: "receive", title: "Received SOL", time: "Today, 14:28", value: "+4.5 SOL", coinId: "solana"},
    {type: "send", title: "Sent BTC", time: "Yesterday, 19:05", value: "−0.003 BTC", coinId: "btc"},
    {type: "receive", title: "Received PRL", time: "Yesterday, 11:40", value: "+12 PRL", coinId: "prl"},
    {type: "receive", title: "Received TRX", time: "Yesterday, 09:18", value: "+400 TRX", coinId: "tron"},
  ];
  const expandedNetworks = new Set();
  const networkIds = new Set(["ethereum", "bsc", "polygon", "arbitrum", "solana", "tron"]);
  const t = text => window.AltbaseI18n?.t(text) || text;
  const MAX_QUOTE_AGE = 20 * 60 * 1000;
  let priceBusy = false, priceError = false;

  const byId = (id) => coins.find((coin) => coin.id === id) || coins[0];
  const enabledCoins = () => coins.filter((coin) => coin.enabled);
  const quoteIsFresh = coin => Number.isFinite(coin.price) && coin.price > 0 && Number.isFinite(coin.priceAt) && Date.now() - coin.priceAt >= -300000 && Date.now() - coin.priceAt < MAX_QUOTE_AGE;
  const coinValue = coin => quoteIsFresh(coin) ? coin.balance * coin.price : null;
  const hidden = (value) => hideBalances ? "****" : value;
  const fmtMoney = (value) => hidden(Number.isFinite(value) ? money.format(value) : "—");
  const fmtAmount = (coin, value = coin.balance) => hidden(`${amount.format(value)} ${coin.ticker}`);
  const fmtPrice = (coin) => !quoteIsFresh(coin) ? "—" : coin.price > 0 && coin.price < 0.000001
    ? `$${coin.price.toFixed(10).replace(/0+$/, "")}`
    : coin.price >= 1 ? money.format(coin.price) : price.format(coin.price);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function showToast(message) {
    const toast = root.querySelector("[data-wallet-toast]");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.hidden = true;
    }, 2100);
  }

  function setView(view) {
    root.querySelectorAll("[data-wallet-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.walletPanel === view);
    });
    root.querySelectorAll(".wallet-menu [data-wallet-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.walletView === view);
    });
  }

  function updateTotals() {
    const enabled = enabledCoins(), priced = enabled.filter(coin => coinValue(coin) !== null);
    const total = priced.reduce((sum, coin) => sum + coinValue(coin), 0);
    root.querySelectorAll("[data-demo-total]").forEach(node => { node.textContent = fmtMoney(priced.length ? total : null); });
    root.querySelectorAll("[data-enabled-count]").forEach(node => { node.textContent = `${enabled.length} / ${coins.length}`; });
    const valuation = root.querySelector("[data-demo-valuation]");
    if (valuation) valuation.textContent = t("Demo balances · live prices") + (priced.length < enabled.length ? ` · ${priced.length}/${enabled.length}` : "");
    const hideButton = root.querySelector("[data-wallet-hide]");
    if (hideButton) { hideButton.classList.toggle("is-hidden", hideBalances); hideButton.setAttribute("aria-label", t(hideBalances ? "Show balance" : "Hide balance")); }
    const status = root.querySelector("[data-demo-price-status]");
    if (status) {
      const latest = priced.length ? Math.max(...priced.map(coin => coin.priceAt)) : null;
      status.textContent = t(priceBusy ? "Updating prices…" : priceError ? "Price refresh unavailable" : priced.length ? "Live market prices" : "Prices unavailable") + (latest ? " · " + new Date(latest).toLocaleTimeString(document.documentElement.lang, {hour:"2-digit",minute:"2-digit"}) : "");
    }
    root.dataset.pricedCount = String(priced.length); root.dataset.total = priced.length ? String(total) : "";
  }

  function visibleCoins() {
    const query = root.querySelector("[data-wallet-search]")?.value.trim().toLowerCase() || "";
    let list = enabledCoins().filter((coin) => {
      if (filter === "balance" && coin.balance <= 0) return false;
      return `${coin.name} ${coin.ticker}`.toLowerCase().includes(query);
    });
    list = list.sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || (sortByValue ? (coinValue(b) ?? -1) - (coinValue(a) ?? -1) : a.name.localeCompare(b.name)));
    return list;
  }

  function coinRow(coin) {
    const network = networkIds.has(coin.id), open = expandedNetworks.has(coin.id);
    return `<div class="demo-coin-item" data-demo-coin="${coin.id}" data-demo-quantity="${coin.balance}" data-demo-price="${quoteIsFresh(coin) ? coin.price : ""}" data-demo-fiat="${coinValue(coin) ?? ""}">
      <div class="wallet-coin-row ${coin.id === selectedCoinId ? "is-selected" : ""}">
        <button class="demo-coin-identity" type="button" data-select-coin="${coin.id}"><img src="${escapeHtml(coin.icon)}" alt=""><span><strong>${escapeHtml(coin.name)}</strong><small>${coin.ticker} · ${escapeHtml(fmtPrice(coin))}</small></span></button>
        <div class="demo-coin-amount"><b>${escapeHtml(fmtAmount(coin))}</b><em>${escapeHtml(fmtMoney(coinValue(coin)))}</em></div>
        <span class="demo-coin-status">${escapeHtml(t("active"))}</span>
        <div class="demo-coin-actions">${network ? `<button type="button" data-demo-tokens="${coin.id}" aria-label="${escapeHtml(t("Network tokens"))}: ${coin.name}" aria-expanded="${open}" aria-controls="demo-tokens-${coin.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>` : ""}<button type="button" data-favorite-coin="${coin.id}" aria-label="${escapeHtml(t("Favorite"))}" aria-pressed="${Boolean(coin.favorite)}" class="${coin.favorite ? "is-favorite" : ""}">☆</button></div>
      </div>${network && open ? `<div class="demo-token-panel" id="demo-tokens-${coin.id}"><strong>${escapeHtml(t("Network tokens"))}</strong><p>${escapeHtml(t("Add tokens by contract or mint in the desktop wallet."))}</p><a href="/download">${escapeHtml(t("Download Wallet"))} ↗</a></div>` : ""}</div>`;
  }

  function renderCoins() {
    const list = root.querySelector("[data-wallet-coin-list]");
    if (!list) return;
    const rows = visibleCoins();
    list.innerHTML = rows.length ? rows.map(coinRow).join("") : `<div class="wallet-demo-empty">No coins found.</div>`;
  }

  function historyRow(tx) {
    const label = tx.type === "receive" ? "In" : tx.type === "send" ? "Out" : "Swap";
    return `
      <article class="history-card">
        <span class="history-type ${escapeHtml(tx.type)}">${escapeHtml(label)}</span>
        <div><strong>${escapeHtml(tx.title)}</strong><small>${escapeHtml(tx.time)}</small></div>
        <b>${escapeHtml(hidden(tx.value))}</b>
      </article>
    `;
  }

  function filteredHistory() {
    const coin = root.querySelector("[data-history-coin]")?.value || "all";
    const type = root.querySelector("[data-history-type]")?.value || "all";
    return transactions.filter((tx) => (coin === "all" || tx.coinId === coin) && (type === "all" || tx.type === type));
  }

  function renderHistory() {
    const recent = root.querySelector("[data-wallet-recent-history]");
    if (recent) recent.innerHTML = transactions.slice(0, 3).map(historyRow).join("");

    const full = root.querySelector("[data-wallet-history]");
    if (!full) return;
    const pageSize = 3;
    const rows = filteredHistory();
    const maxPage = Math.max(1, Math.ceil(rows.length / pageSize));
    historyPage = Math.min(historyPage, maxPage);
    const visible = rows.slice((historyPage - 1) * pageSize, historyPage * pageSize);
    full.innerHTML = visible.length ? visible.map(historyRow).join("") : `<div class="wallet-demo-empty">No transactions for this filter.</div>`;
    const page = root.querySelector("[data-history-page]");
    if (page) page.textContent = `No. ${historyPage}`;
  }

  function renderSelects() {
    const options = enabledCoins().map((coin) => `<option value="${coin.id}">${escapeHtml(coin.name)} (${escapeHtml(coin.ticker)})</option>`).join("");
    root.querySelectorAll("[data-send-coin], [data-receive-coin], [data-swap-from], [data-swap-to]").forEach((select) => {
      const current = select.value;
      select.innerHTML = options;
      select.value = current && byId(current).enabled ? current : (select.matches("[data-receive-coin]") ? receiveCoinId : selectedCoinId);
    });
    const historyCoin = root.querySelector("[data-history-coin]");
    if (historyCoin) {
      const current = historyCoin.value || "all";
      historyCoin.innerHTML = `<option value="all">All coins</option>${enabledCoins().map((coin) => `<option value="${coin.id}">${coin.ticker}</option>`).join("")}`;
      historyCoin.value = current;
    }
  }

  function renderReceiveAddress() {
    const coin = byId(root.querySelector("[data-receive-coin]")?.value || receiveCoinId);
    receiveCoinId = coin.id;
    const type = root.querySelector("[data-address-type]")?.value || "legacy";
    const suffix = type === "legacy" ? "" : `-${type}`;
    const node = root.querySelector("[data-receive-address]");
    if (node) node.textContent = `${coin.address}${suffix}`;
  }

  function renderManagement() {
    const container = root.querySelector("[data-wallet-coin-management]");
    if (!container) return;
    container.innerHTML = coins.map((coin) => `
      <div class="wallet-manage-row">
        <img src="${escapeHtml(coin.icon)}" alt="${escapeHtml(coin.name)}">
        <div><strong>${escapeHtml(coin.name)}</strong><span>${escapeHtml(coin.ticker)} - ${escapeHtml(fmtMoney(coinValue(coin)))}</span></div>
        <button class="wallet-icon-button" type="button" data-favorite-coin="${coin.id}" aria-label="Favorite ${escapeHtml(coin.name)}">*</button>
        <button class="wallet-toggle ${coin.enabled ? "is-on" : ""}" type="button" data-toggle-coin="${coin.id}">${coin.enabled ? "Enabled" : "Hidden"}</button>
      </div>
    `).join("");
  }

  function renderSettings() {
    root.querySelectorAll("[data-settings-section]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.settingsSection === settingsSection);
    });
    const detail = root.querySelector("[data-settings-detail]");
    if (!detail) return;
    const content = {
      security: "<strong>Security</strong>Password change, auto-lock and clear-local-data controls are shown here in the desktop app. This website demo never stores keys.",
      keys: "<strong>Private keys</strong>The real wallet reveals WIF private keys only after password confirmation. Demo mode blocks secret export.",
      seed: "<strong>Seed phrase</strong>The real wallet encrypts the seed locally. This demo never creates or asks for a seed phrase.",
      display: `<strong>Appearance</strong>Balance privacy is active here too.<br><button type="button" data-wallet-hide>${hideBalances ? "Show balance" : "Hide balance"}</button>`,
    };
    detail.innerHTML = content[settingsSection] || content.security;
  }

  function renderSwapQuote() {
    const from = byId(root.querySelector("[data-swap-from]")?.value || selectedCoinId);
    const to = byId(root.querySelector("[data-swap-to]")?.value || "bch2");
    const value = Number(root.querySelector("[data-swap-amount]")?.value || 0);
    const quote = root.querySelector("[data-swap-quote]");
    if (!quote) return;
    if (!value || from.id === to.id) {
      quote.textContent = from.id === to.id ? "Select different coins" : "Enter amount";
      return;
    }
    if (!(from.price > 0) || !(to.price > 0)) {
      quote.textContent = "Price is not available.";
      return;
    }
    quote.textContent = `~${amount.format((value * from.price) / to.price)} ${to.ticker}`;
  }

  function renderAll() {
    updateTotals();
    renderSelects();
    renderCoins();
    renderHistory();
    renderReceiveAddress();
    renderManagement();
    renderSettings();
    renderSwapQuote();
  }

  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button)) return;

    if (button.dataset.walletView) setView(button.dataset.walletView);

    if (button.dataset.walletHide !== undefined) {
      hideBalances = !hideBalances;
      renderAll();
    }

    if (button.dataset.walletLock !== undefined) {
      showToast("Demo wallet locked. No real session was changed.");
    }

    if (button.dataset.walletFilter) {
      filter = button.dataset.walletFilter;
      root.querySelectorAll("[data-wallet-filter]").forEach((item) => item.classList.toggle("active", item === button));
      renderCoins();
    }

    if (button.dataset.walletSort !== undefined) {
      sortByValue = !sortByValue;
      button.classList.toggle("active", sortByValue);
      renderCoins();
    }

    if (button.dataset.selectCoin) {
      selectedCoinId = button.dataset.selectCoin;
      renderCoins();
      renderSelects();
    }

    if (button.dataset.sendMax !== undefined) {
      const coin = byId(root.querySelector("[data-send-coin]")?.value || selectedCoinId);
      root.querySelector("[data-send-amount]").value = Math.max(0, coin.balance - 0.0001).toFixed(4);
    }

    if (button.dataset.copyAddress !== undefined) {
      const address = root.querySelector("[data-receive-address]")?.textContent || "";
      try {
        await navigator.clipboard?.writeText(address);
      } catch {
        // Clipboard can be unavailable in the preview browser.
      }
      showToast("Receive address copied.");
    }

    if (button.dataset.historyPrev !== undefined) {
      historyPage = Math.max(1, historyPage - 1);
      renderHistory();
    }

    if (button.dataset.historyNext !== undefined) {
      historyPage += 1;
      renderHistory();
    }

    if (button.dataset.toggleCoin) {
      const coin = byId(button.dataset.toggleCoin);
      coin.enabled = !coin.enabled;
      if (!enabledCoins().some((item) => item.id === selectedCoinId)) selectedCoinId = enabledCoins()[0]?.id || coins[0].id;
      renderAll();
    }

    if (button.dataset.favoriteCoin) { const coin = byId(button.dataset.favoriteCoin); coin.favorite = !coin.favorite; renderCoins(); }
    if (button.dataset.demoTokens) { const id = button.dataset.demoTokens; expandedNetworks.has(id) ? expandedNetworks.delete(id) : expandedNetworks.add(id); renderCoins(); }
    if (button.dataset.demoRefresh !== undefined) void refreshPrices();

    if (button.dataset.settingsSection) {
      settingsSection = button.dataset.settingsSection;
      renderSettings();
    }
  });

  root.addEventListener("input", (event) => {
    if (event.target.matches("[data-wallet-search]")) renderCoins();
    if (event.target.matches("[data-swap-amount]")) renderSwapQuote();
  });

  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-send-coin]")) selectedCoinId = event.target.value;
    if (event.target.matches("[data-receive-coin], [data-address-type]")) renderReceiveAddress();
    if (event.target.matches("[data-history-coin], [data-history-type]")) {
      historyPage = 1;
      renderHistory();
    }
    if (event.target.matches("[data-swap-from], [data-swap-to]")) renderSwapQuote();
    renderCoins();
  });

  const sendForm = root.querySelector("[data-send-form]");
  if (sendForm) {
    sendForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const coin = byId(root.querySelector("[data-send-coin]")?.value || selectedCoinId);
      const sendAmount = Number(root.querySelector("[data-send-amount]")?.value || 0);
      const address = root.querySelector("[data-send-address]")?.value.trim();
      if (!address || !sendAmount || sendAmount <= 0) {
        showToast("Enter recipient and amount.");
        return;
      }
      if (sendAmount > coin.balance) {
        showToast("Insufficient demo balance.");
        return;
      }
      coin.balance = Math.max(0, coin.balance - sendAmount);
      transactions.unshift({ type: "send", title: `Sent ${coin.ticker}`, time: "Just now", value: `-${amount.format(sendAmount)} ${coin.ticker}`, coinId: coin.id });
      showToast("Demo transaction created. Nothing was broadcast.");
      root.querySelector("[data-send-amount]").value = "";
      root.querySelector("[data-send-address]").value = "";
      renderAll();
      setView("history");
    });
  }

  const swapForm = root.querySelector("[data-swap-form]");
  if (swapForm) {
    swapForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const from = byId(root.querySelector("[data-swap-from]")?.value || selectedCoinId);
      const to = byId(root.querySelector("[data-swap-to]")?.value || "bch2");
      const swapAmount = Number(root.querySelector("[data-swap-amount]")?.value || 0);
      if (from.id === to.id) {
        showToast("Choose different coins.");
        return;
      }
      if (!swapAmount || swapAmount <= 0) {
        showToast("Enter swap amount.");
        return;
      }
      if (swapAmount > from.balance) {
        showToast("Insufficient demo balance.");
        return;
      }
      if (!(from.price > 0) || !(to.price > 0)) {
        showToast("Price is not available.");
        return;
      }
      const quoteAmount = (swapAmount * from.price) / to.price;
      from.balance = Math.max(0, from.balance - swapAmount);
      to.balance += quoteAmount;
      transactions.unshift({ type: "swap", title: `${from.ticker} to ${to.ticker}`, time: "Just now", value: `~${amount.format(quoteAmount)} ${to.ticker}`, coinId: from.id });
      showToast("Swap quote saved to demo history.");
      root.querySelector("[data-swap-amount]").value = "";
      renderAll();
      setView("history");
    });
  }

  async function refreshPrices() {
    if (priceBusy) return;
    priceBusy = true; updateTotals();
    try {
      const response = await fetch("/api/wallet-demo-prices", {cache:"no-store", signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw Error("Price query unavailable");
      const data = await response.json();
      if (data.ok !== true || !data.prices || !data.priceUpdatedAt) throw Error("Invalid quote response");
      for (const coin of coins) {
        const value = data.prices[coin.marketId], at = data.priceUpdatedAt[coin.marketId];
        if (Number.isFinite(value) && value > 0 && Number.isFinite(at) && Date.now()-at < MAX_QUOTE_AGE && at <= Date.now()+300000) { coin.price = value; coin.priceAt = at; }
      }
      priceError = false;
    } catch { priceError = true; }
    finally { priceBusy = false; updateTotals(); renderCoins(); renderManagement(); renderSwapQuote(); }
  }
  document.addEventListener("altbase:languagechange", () => { updateTotals(); renderCoins(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshPrices(); });
  setInterval(() => { updateTotals(); renderCoins(); if (!document.hidden) void refreshPrices(); }, 60000);
  renderAll(); void refreshPrices();
})();
