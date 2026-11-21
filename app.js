(() => {
  "use strict";

  const STORAGE_KEY = "local-market-manager-v1";
  const PASSWORD_ITERATIONS = 310000;
  const initialState = {
    users: [],
    products: [],
    sales: [],
    expenses: []
  };
  const roleNames = { admin: "Administrador", employee: "Funcionário" };
  const navigationItems = [
    { id: "dashboard", label: "Visão geral", icon: "⌂", roles: ["admin", "employee"] },
    { id: "sales", label: "Realizar venda", icon: "▣", roles: ["admin", "employee"] },
    { id: "prices", label: "Consultar preços", icon: "⌕", roles: ["admin", "employee"] },
    { id: "stock", label: "Reposição de estoque", icon: "↻", roles: ["admin", "employee"] },
    { id: "products", label: "Produtos", icon: "▤", roles: ["admin", "employee"] },
    { id: "management", label: "Gerenciar vendas", icon: "▧", roles: ["admin"] },
    { id: "expenses", label: "Gastos e compras", icon: "↗", roles: ["admin"] },
    { id: "users", label: "Equipe e acessos", icon: "♙", roles: ["admin"] },
    { id: "account", label: "Minha conta", icon: "◉", roles: ["admin", "employee"] }
  ];
  let state = loadState();
  let currentUser = null;
  let currentPage = "dashboard";
  let cart = [];
  let toastTimer;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
  const dateTime = (value) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const bytesToBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const base64ToBytes = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

  async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_ITERATIONS }, key, 256);
    return { passwordSalt: bytesToBase64(salt), passwordHash: bytesToBase64(new Uint8Array(bits)) };
  }

  async function verifyPassword(user, password) {
    if (!user.passwordSalt || !user.passwordHash) return false;
    const actual = new Uint8Array(await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: base64ToBytes(user.passwordSalt),
        iterations: PASSWORD_ITERATIONS
      },
      await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]),
      256
    ));
    const expected = base64ToBytes(user.passwordHash);
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
    return difference === 0;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Array.isArray(saved.users) && Array.isArray(saved.products) && Array.isArray(saved.sales) && Array.isArray(saved.expenses)) {
        return { ...initialState, ...saved };
      }
    } catch (error) {
      console.error("Não foi possível carregar os dados salvos.", error);
    }
    return structuredClone(initialState);
  }

  async function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Não foi possível salvar os dados.", error);
      notify("Falha ao salvar. Verifique o espaço disponível no navegador.", true);
      throw error;
    }
  }

  function notify(message, error = false) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function reportAsyncError(error) {
    console.error("Não foi possível concluir a operação.", error);
    notify(error.message || "Não foi possível concluir a operação.", true);
  }

  function clearSession() {
    currentUser = null;
    cart = [];
    $("#app").classList.add("hidden");
    $("#loginScreen").classList.remove("hidden");
    $("#loginForm").reset();
    $("#loginForm").elements.username.focus();
  }

  function pageTitle(idValue) {
    return navigationItems.find((item) => item.id === idValue)?.label || "Visão geral";
  }

  function setSession(user) {
    currentUser = user;
    $("#loginScreen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    const initial = user.name.trim().charAt(0).toUpperCase() || "U";
    $("#avatar").textContent = initial;
    $("#topAvatar").textContent = initial;
    $("#sidebarName").textContent = user.name;
    $("#topName").textContent = user.name;
    $("#sidebarRole").textContent = roleNames[user.role];
    $("#topRole").textContent = roleNames[user.role];
    $("#todayLabel").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date());
    renderNavigation();
    navigate("dashboard");
  }

  function renderNavigation() {
    $("#navigation").innerHTML = navigationItems
      .filter((item) => item.roles.includes(currentUser.role))
      .map((item) => `<button class="nav-button ${item.id === currentPage ? "active" : ""}" data-page="${item.id}"><span class="nav-icon">${item.icon}</span>${item.label}</button>`)
      .join("");
  }

  function navigate(page) {
    const entry = navigationItems.find((item) => item.id === page && item.roles.includes(currentUser.role));
    if (!entry) return;
    currentPage = page;
    $("#pageTitle").textContent = pageTitle(page);
    $("#breadcrumb").textContent = pageTitle(page).toLocaleUpperCase("pt-BR");
    renderNavigation();
    renderPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderPage() {
    const views = {
      dashboard: renderDashboard,
      sales: renderSales,
      prices: renderPrices,
      stock: renderStock,
      products: renderProducts,
      management: renderManagement,
      expenses: renderExpenses,
      users: renderUsers,
      account: renderAccount
    };
    $("#pageContent").innerHTML = views[currentPage]();
    if (currentPage === "dashboard") drawChart();
  }

  function daySales(day) {
    return state.sales.filter((sale) => sale.createdAt.slice(0, 10) === day);
  }

  function soldCost(sales) {
    return sales.reduce((total, sale) => total + sale.items.reduce((sum, item) => sum + item.cost * item.quantity, 0), 0);
  }

  function operationalExpenses(expenses) {
    return expenses.filter((expense) => expense.type !== "Reposição de estoque").reduce((total, expense) => total + expense.amount, 0);
  }

  function renderDashboard() {
    if (currentUser.role !== "admin") {
      return `<div class="welcome-row"><div><h3>Olá, ${escapeHtml(currentUser.name.split(" ")[0])} 👋</h3><p>Seu espaço de trabalho está pronto.</p></div><button class="button button-primary" data-go="sales">＋ Nova venda</button></div>
        <section class="panel"><div class="panel-heading"><div><h3>Atalhos operacionais</h3><p>Escolha uma tarefa para começar.</p></div></div><div class="quick-grid">
          ${quickAction("sales", "▣", "Realizar venda", "Registrar uma compra")}
          ${quickAction("prices", "⌕", "Consultar preços", "Buscar um produto")}
          ${quickAction("stock", "↻", "Repor estoque", "Entrada de mercadoria")}
          ${quickAction("products", "＋", "Cadastrar produto", "Atualizar o catálogo")}
        </div></section>
        <section class="panel" style="margin-top:14px"><div class="panel-heading"><div><h3>Dica rápida</h3><p>Reposição de mercadoria</p></div></div><p class="muted">Na aba de reposição, pesquise pelo nome ou código de barras. Se o produto ainda não estiver cadastrado, você poderá iniciar o cadastro com o código pesquisado já preenchido.</p></section>`;
    }

    const salesToday = daySales(todayKey());
    const revenueToday = salesToday.reduce((sum, sale) => sum + sale.total, 0);
    const todayCosts = soldCost(salesToday);
    const stockItems = state.products.reduce((sum, product) => sum + product.stock, 0);
    const lowStock = state.products.filter((product) => product.stock <= product.minStock).length;
    const allRevenue = state.sales.reduce((sum, sale) => sum + sale.total, 0);
    const allProfit = allRevenue - soldCost(state.sales) - operationalExpenses(state.expenses);
    const recent = [...state.sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
    return `<div class="welcome-row"><div><h3>Olá, ${escapeHtml(currentUser.name.split(" ")[0])} 👋</h3><p>Acompanhe o que está acontecendo na sua loja.</p></div><button class="button button-primary" data-go="sales">＋ Nova venda</button></div>
      <div class="metric-grid">
        ${metric("Vendas de hoje", money(revenueToday), `${salesToday.length} venda(s) realizada(s)`, "▣", true)}
        ${metric("Lucro acumulado", money(allProfit), "Vendas − custo vendido − despesas", "↗", allProfit >= 0)}
        ${metric("Gastos registrados", money(state.expenses.reduce((sum, expense) => sum + expense.amount, 0)), `${state.expenses.length} compra(s) ou despesa(s)`, "↘")}
        ${metric("Produtos em estoque", stockItems.toLocaleString("pt-BR"), `${lowStock} produto(s) no limite de estoque`, "▤", lowStock === 0)}
      </div>
      <div class="dashboard-grid">
        <section class="panel"><div class="panel-heading"><div><h3>Movimento dos últimos 7 dias</h3><p>Vendas e margem estimada</p></div><div class="chart-legend"><span><i class="legend-dot"></i>Vendas</span><span><i class="legend-dot gray"></i>Lucro</span></div></div><div class="chart-wrap"><canvas id="salesChart" aria-label="Gráfico de vendas e lucro nos últimos sete dias"></canvas></div></section>
        <section class="panel"><div class="panel-heading"><div><h3>Acesso rápido</h3><p>Atalhos para o dia a dia</p></div></div><div class="quick-grid">
          ${quickAction("sales", "▣", "Realizar venda", "Registrar uma compra")}
          ${quickAction("prices", "⌕", "Consultar preços", "Buscar um produto")}
          ${quickAction("stock", "↻", "Repor estoque", "Entrada de mercadoria")}
          ${quickAction("products", "＋", "Cadastrar produto", "Atualizar o catálogo")}
        </div></section>
        <section class="panel"><div class="panel-heading"><div><h3>Vendas recentes</h3><p>Últimas vendas realizadas</p></div>${currentUser.role === "admin" ? '<button class="button button-secondary" data-go="management">Ver todas →</button>' : ""}</div>${recentSalesTable(recent)}</section>
        <section class="panel"><div class="panel-heading"><div><h3>Resumo do dia</h3><p>Valores de hoje</p></div></div>
          <div class="table-wrap"><table class="data-table"><tbody>
            <tr><td>Faturamento</td><td>${money(revenueToday)}</td></tr>
            <tr><td>Custo dos produtos vendidos</td><td>${money(todayCosts)}</td></tr>
            <tr><td>Margem bruta estimada</td><td class="${revenueToday - todayCosts >= 0 ? "positive" : "negative"}">${money(revenueToday - todayCosts)}</td></tr>
            <tr><td>Despesas operacionais</td><td>${money(operationalExpenses(state.expenses.filter((item) => item.createdAt.slice(0, 10) === todayKey())))}</td></tr>
          </tbody></table></div></section>
      </div>`;
  }

  function metric(label, value, detail, icon, positive) {
    return `<article class="metric-card"><div class="metric-top">${label}<span class="metric-icon">${icon}</span></div><div class="metric-value ${positive === undefined ? "" : positive ? "positive" : "negative"}">${value}</div><div class="metric-sub">${detail}</div></article>`;
  }

  function quickAction(page, icon, title, detail) {
    return `<button class="quick-action" data-go="${page}"><span class="metric-icon">${icon}</span><span><strong>${title}</strong><small>${detail}</small></span></button>`;
  }

  function recentSalesTable(sales) {
    if (!sales.length) return emptyState("▣", "Ainda não há vendas", "As vendas realizadas aparecerão aqui.");
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>VENDA</th><th>FUNCIONÁRIO</th><th>PAGAMENTO</th><th>VALOR</th></tr></thead><tbody>${sales.map((sale) => `<tr><td>${dateTime(sale.createdAt)}</td><td>${escapeHtml(sale.sellerName)}</td><td>${escapeHtml(sale.payment)}</td><td class="table-primary">${money(sale.total)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function drawChart() {
    const canvas = $("#salesChart");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, rect.width * ratio);
    canvas.height = Math.max(1, rect.height * ratio);
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    const width = rect.width;
    const height = rect.height;
    const padding = { top: 14, right: 12, bottom: 25, left: 40 };
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);
      const sales = daySales(key);
      return {
        label: new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(date).replace(".", ""),
        revenue: sales.reduce((sum, sale) => sum + sale.total, 0),
        profit: sales.reduce((sum, sale) => sum + sale.total, 0) - soldCost(sales)
      };
    });
    const max = Math.max(1, ...days.map((day) => day.revenue));
    const chartHeight = height - padding.top - padding.bottom;
    const chartWidth = width - padding.left - padding.right;
    context.font = "9px DM Sans";
    context.textBaseline = "middle";
    for (let index = 0; index < 4; index += 1) {
      const y = padding.top + (chartHeight / 3) * index;
      context.strokeStyle = "#ffffff0c";
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
      context.fillStyle = "#717577";
      context.textAlign = "right";
      context.fillText(index === 0 ? money(max) : index === 3 ? money(0) : money(max * (1 - index / 3)), padding.left - 7, y);
    }
    days.forEach((day, index) => {
      const x = padding.left + chartWidth * (index + 0.5) / days.length;
      const barWidth = Math.min(20, chartWidth / days.length * 0.32);
      const revenueHeight = day.revenue / max * chartHeight;
      const profitHeight = Math.max(0, day.profit) / max * chartHeight;
      context.fillStyle = "#737b80";
      context.beginPath();
      context.roundRect(x - barWidth - 2, padding.top + chartHeight - profitHeight, barWidth, profitHeight, 3);
      context.fill();
      context.fillStyle = "#687681";
      context.beginPath();
      context.roundRect(x + 2, padding.top + chartHeight - revenueHeight, barWidth, revenueHeight, 3);
      context.fill();
      context.fillStyle = "#85888a";
      context.textAlign = "center";
      context.fillText(day.label, x, height - 10);
    });
  }

  function renderSales() {
    return `<div class="section-heading"><div><h3>Nova venda</h3><p>Adicione produtos ao carrinho e finalize a compra.</p></div></div>
      <div class="form-layout">
        <section class="panel"><div class="panel-heading"><div><h3>Encontrar produtos</h3><p>Pesquise pelo nome ou código de barras</p></div></div>
          <div class="search-box"><input id="saleSearch" placeholder="Nome do produto ou código de barras" autocomplete="off"></div><div id="saleResults" class="product-list">${productSearchResults("")}</div>
        </section>
        <section class="panel"><div class="panel-heading"><div><h3>Carrinho</h3><p id="cartCount">${cart.length} item(ns)</p></div></div><div id="cartItems">${cartMarkup()}</div>
          <div class="cart-total"><span>Total da venda</span><strong id="cartTotal">${money(cart.reduce((sum, line) => sum + line.price * line.quantity, 0))}</strong></div>
          <div class="table-heading">FORMA DE PAGAMENTO</div><div class="payment-options">
            <label class="payment-option"><input type="radio" name="payment" value="Pix" checked> Pix</label>
            <label class="payment-option"><input type="radio" name="payment" value="Cartão"> Cartão</label>
            <label class="payment-option"><input type="radio" name="payment" value="Dinheiro"> Dinheiro</label>
          </div><button class="button button-primary button-wide" data-action="finalize-sale" ${cart.length ? "" : "disabled"}>Finalizar venda</button>
        </section>
      </div>`;
  }

  function productSearchResults(query) {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    const matches = state.products.filter((product) => !normalized || product.name.toLocaleLowerCase("pt-BR").includes(normalized) || product.barcode.includes(normalized));
    if (!matches.length) return emptyState("⌕", "Nenhum produto encontrado", "Cadastre o produto antes de adicioná-lo à venda.");
    return matches.slice(0, 15).map((product) => `<div class="product-result"><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.barcode || "Sem código")} · Estoque: ${product.stock}</small></div><div class="result-right"><strong>${money(product.price)}</strong><button class="button button-secondary" data-action="add-cart" data-id="${escapeHtml(product.id)}" ${product.stock < 1 ? "disabled" : ""}>＋ Adicionar</button></div></div>`).join("");
  }

  function cartMarkup() {
    if (!cart.length) return emptyState("▣", "Carrinho vazio", "Pesquise e adicione produtos à venda.");
    return cart.map((line) => `<div class="cart-line"><div><strong>${escapeHtml(line.name)}</strong><small>${money(line.price)} cada</small></div><span class="qty">${line.quantity} un.</span><button class="button button-danger" data-action="remove-cart" data-id="${escapeHtml(line.productId)}" aria-label="Remover ${escapeHtml(line.name)}">×</button></div>`).join("");
  }

  function renderPrices() {
    return `<div class="section-heading"><div><h3>Consulta de preços</h3><p>Encontre rapidamente o valor e a disponibilidade dos produtos.</p></div></div>
      <section class="panel"><div class="search-box"><input id="priceSearch" placeholder="Buscar por nome ou código de barras" autocomplete="off"></div><div id="priceResults" class="product-list">${priceResults("")}</div></section>`;
  }

  function priceResults(query) {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    const matches = state.products.filter((product) => !normalized || product.name.toLocaleLowerCase("pt-BR").includes(normalized) || product.barcode.includes(normalized));
    if (!matches.length) return emptyState("⌕", state.products.length ? "Nenhum resultado" : "Catálogo vazio", state.products.length ? "Tente buscar por outro nome ou código." : "Cadastre produtos para começar a consultar preços.");
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>PRODUTO</th><th>CÓDIGO DE BARRAS</th><th>CATEGORIA</th><th>ESTOQUE</th><th>PREÇO</th></tr></thead><tbody>${matches.slice(0, 100).map((product) => `<tr><td class="table-primary">${escapeHtml(product.name)}</td><td>${escapeHtml(product.barcode || "—")}</td><td>${escapeHtml(product.category || "Geral")}</td><td class="${product.stock <= product.minStock ? "low-stock" : "stock-good"}">${product.stock}</td><td class="table-primary">${money(product.price)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function productForm(prefill = {}) {
    return `<form id="productForm"><div class="form-grid">
      <label class="full">Nome do produto<input name="name" required placeholder="Ex.: Café torrado 500 g" value="${escapeHtml(prefill.name || "")}"></label>
      <label>Código de barras<input name="barcode" placeholder="EAN / código interno" value="${escapeHtml(prefill.barcode || "")}"></label>
      <label>Categoria<input name="category" placeholder="Ex.: Mercearia" value="${escapeHtml(prefill.category || "")}"></label>
      <label>Preço de venda (R$)<input name="price" type="number" min="0.01" step="0.01" required placeholder="0,00" value="${escapeHtml(prefill.price || "")}"></label>
      <label>Custo unitário (R$)<input name="cost" type="number" min="0" step="0.01" required placeholder="0,00" value="${escapeHtml(prefill.cost || "")}"></label>
      <label>Quantidade inicial<input name="stock" type="number" min="0" step="1" required value="${escapeHtml(prefill.stock ?? 0)}"></label>
      <label>Estoque mínimo<input name="minStock" type="number" min="0" step="1" value="${escapeHtml(prefill.minStock ?? 5)}"></label>
    </div><div class="form-actions"><button class="button button-primary" type="submit">Salvar produto</button></div></form>`;
  }

  function renderProducts() {
    const rows = state.products.map((product) => `<tr><td class="table-primary">${escapeHtml(product.name)}</td><td>${escapeHtml(product.barcode || "—")}</td><td>${escapeHtml(product.category || "Geral")}</td><td>${money(product.cost)}</td><td>${money(product.price)}</td><td class="${product.stock <= product.minStock ? "low-stock" : "stock-good"}">${product.stock}</td><td><button class="button button-secondary" data-action="edit-product" data-id="${escapeHtml(product.id)}">Editar</button></td></tr>`).join("");
    return `<div class="section-heading"><div><h3>Produtos</h3><p>Cadastre e mantenha o catálogo atualizado.</p></div></div>
      <div class="form-layout"><section class="form-card"><h3>Cadastrar produto</h3>${productForm()}</section>
        <section class="panel"><div class="panel-heading"><div><h3>Seu catálogo</h3><p>${state.products.length} produto(s) cadastrado(s)</p></div></div>
          ${state.products.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>PRODUTO</th><th>CÓDIGO</th><th>CATEGORIA</th><th>CUSTO</th><th>PREÇO</th><th>ESTOQUE</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("▤", "Nenhum produto cadastrado", "Use o formulário ao lado para criar o primeiro produto.")}</section></div>`;
  }

  function renderStock() {
    return `<div class="section-heading"><div><h3>Reposição de estoque</h3><p>Busque por nome ou código de barras para registrar entradas.</p></div></div>
      <section class="panel"><div class="callout"><strong>Precisa cadastrar?</strong> Se o código de barras não existir, escolha “Cadastrar” para criar o produto com esse código já preenchido.</div>
        <div class="search-box"><input id="stockSearch" placeholder="Pesquise pelo nome ou código de barras" autocomplete="off"></div><div id="stockResults" class="product-list">${stockResults("")}</div>
      </section>`;
  }

  function stockResults(query) {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return emptyState("↻", "Encontre um produto", "Digite o nome ou código de barras do item.");
    const matches = state.products.filter((product) => product.name.toLocaleLowerCase("pt-BR").includes(normalized) || product.barcode.includes(normalized));
    if (!matches.length) return `<div class="empty-state"><div class="empty-icon">＋</div><strong>Código ou produto não cadastrado</strong><div>Cadastre o produto com o código pesquisado já preenchido.</div><button class="button button-primary" style="margin-top:12px" data-action="create-from-stock" data-barcode="${escapeHtml(/^\d+$/.test(normalized) ? normalized : "")}">Cadastrar produto</button></div>`;
    return matches.slice(0, 15).map((product) => `<div class="product-result"><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.barcode || "Sem código")} · Estoque atual: ${product.stock}</small></div><div class="result-right"><button class="button button-secondary" data-action="restock" data-id="${escapeHtml(product.id)}">＋ Repor</button></div></div>`).join("");
  }

  function renderManagement() {
    const q = ($("#salesFilter")?.value || "").trim().toLocaleLowerCase("pt-BR");
    const paymentFilter = $("#paymentFilter")?.value || "";
    const sales = [...state.sales].filter((sale) => (!q || sale.sellerName.toLocaleLowerCase("pt-BR").includes(q) || sale.id.toLocaleLowerCase("pt-BR").includes(q)) && (!paymentFilter || sale.payment === paymentFilter)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return `<div class="section-heading"><div><h3>Gerenciamento de vendas</h3><p>Acompanhe cada venda, forma de pagamento e responsável.</p></div><div class="filters"><input id="salesFilter" placeholder="Buscar funcionário ou venda" value="${escapeHtml(q)}"><select id="paymentFilter"><option value="">Todos pagamentos</option>${["Pix", "Cartão", "Dinheiro"].map((item) => `<option ${item === paymentFilter ? "selected" : ""}>${item}</option>`).join("")}</select></div></div>
      <section class="panel"><div class="panel-heading"><div><h3>Histórico de vendas</h3><p>${sales.length} venda(s) · Total: ${money(sales.reduce((sum, sale) => sum + sale.total, 0))}</p></div></div>
      ${sales.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>DATA</th><th>VENDA</th><th>FUNCIONÁRIO</th><th>PAGAMENTO</th><th>ITENS</th><th>VALOR</th></tr></thead><tbody>${sales.map((sale) => `<tr><td>${dateTime(sale.createdAt)}</td><td>${escapeHtml(sale.id.slice(-6).toUpperCase())}</td><td>${escapeHtml(sale.sellerName)}</td><td><span class="badge">${escapeHtml(sale.payment)}</span></td><td>${sale.items.reduce((n, item) => n + item.quantity, 0)}</td><td class="table-primary">${money(sale.total)}</td></tr>`).join("")}</tbody></table></div>` : emptyState("▣", "Nenhuma venda encontrada", "As vendas aparecerão aqui assim que forem registradas.")}</section>`;
  }

  function renderExpenses() {
    const expenses = [...state.expenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return `<div class="section-heading"><div><h3>Gastos e compras</h3><p>Registre compras, reposições e despesas da operação.</p></div></div>
      <div class="form-layout"><section class="form-card"><h3>Registrar gasto</h3>
        <form id="expenseForm"><div class="form-grid">
          <label class="full">Descrição<input name="description" placeholder="Ex.: Conta de energia" required></label>
          <label>Tipo<select name="type"><option>Despesa operacional</option><option>Compra de mercadoria</option></select></label>
          <label>Valor (R$)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="0,00"></label>
        </div><div class="form-actions"><button class="button button-primary" type="submit">Registrar gasto</button></div></form>
        <div class="callout" style="margin-top:14px;margin-bottom:0"><strong>Nota:</strong> reposições registradas na aba de estoque entram automaticamente nos gastos com mercadorias.</div>
      </section><section class="panel"><div class="panel-heading"><div><h3>Histórico de gastos</h3><p>Total registrado: ${money(expenses.reduce((sum, expense) => sum + expense.amount, 0))}</p></div></div>
        ${expenses.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>DATA</th><th>DESCRIÇÃO</th><th>TIPO</th><th>VALOR</th></tr></thead><tbody>${expenses.map((expense) => `<tr><td>${dateTime(expense.createdAt)}</td><td class="table-primary">${escapeHtml(expense.description)}</td><td><span class="badge ${expense.type === "Despesa operacional" ? "badge-orange" : ""}">${escapeHtml(expense.type)}</span></td><td>${money(expense.amount)}</td></tr>`).join("")}</tbody></table></div>` : emptyState("↗", "Sem gastos registrados", "Compras e despesas registradas serão listadas aqui.")}</section></div>`;
  }

  function renderUsers() {
    const users = state.users;
    return `<div class="section-heading"><div><h3>Equipe e acessos</h3><p>Crie contas de funcionários e outros administradores.</p></div></div>
      <div class="form-layout"><section class="form-card"><h3>Novo acesso</h3><form id="userForm"><div class="form-grid">
        <label class="full">Nome completo<input name="name" required placeholder="Nome do funcionário"></label>
        <label>Nome de usuário<input name="username" required autocomplete="off" placeholder="Ex.: maria.silva"></label>
        <label>Perfil<select name="role"><option value="employee">Funcionário</option><option value="admin">Administrador</option></select></label>
        <label class="full">Senha<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password" placeholder="12 a 128 caracteres"></label>
      </div><div class="form-actions"><button class="button button-primary" type="submit">Criar acesso</button></div></form></section>
      <section class="panel"><div class="panel-heading"><div><h3>Usuários do sistema</h3><p>${users.filter((user) => user.active !== false).length} acesso(s) ativo(s)</p></div></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>NOME</th><th>USUÁRIO</th><th>PERFIL</th><th>STATUS</th><th></th></tr></thead><tbody>${users.map((user) => `<tr><td class="table-primary">${escapeHtml(user.name)}</td><td>${escapeHtml(user.username)}</td><td>${roleNames[user.role]}</td><td><span class="badge ${user.active === false ? "badge-red" : "badge-green"}">${user.active === false ? "Inativo" : "Ativo"}</span></td><td>${user.id === currentUser.id ? '<span class="table-muted">Sua conta</span>' : `<button class="button ${user.active === false ? "button-secondary" : "button-danger"}" data-action="toggle-user" data-id="${escapeHtml(user.id)}">${user.active === false ? "Ativar" : "Desativar"}</button>`}</td></tr>`).join("")}</tbody></table></div></section></div>`;
  }

  function renderAccount() {
    return `<div class="section-heading"><div><h3>Minha conta</h3><p>Atualize sua senha de acesso ao sistema.</p></div></div>
      <section class="form-card" style="max-width:620px"><h3>${escapeHtml(currentUser.name)} <span class="badge">${roleNames[currentUser.role]}</span></h3>
        <form id="passwordForm"><div class="form-grid">
          <label class="full">Senha atual<input name="currentPassword" type="password" required autocomplete="current-password"></label>
          <label>Nova senha<input name="newPassword" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
          <label>Confirmar nova senha<input name="confirmPassword" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
        </div><div class="form-actions"><button class="button button-primary" type="submit">Atualizar senha</button></div></form></section>`;
  }

  function emptyState(icon, title, description) {
    return `<div class="empty-state"><div class="empty-icon">${icon}</div><strong>${title}</strong><div>${description}</div></div>`;
  }

  async function addProduct(formData, { fromRestock = false } = {}) {
    const name = String(formData.get("name") || "").trim();
    const barcode = String(formData.get("barcode") || "").trim();
    const price = Number(formData.get("price"));
    const cost = Number(formData.get("cost"));
    const stock = Number(formData.get("stock"));
    const minStock = Number(formData.get("minStock"));
    if (!name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(cost) || cost < 0 || !Number.isInteger(stock) || stock < 0 || !Number.isInteger(minStock) || minStock < 0) {
      notify("Confira os dados do produto.", true);
      return false;
    }
    if (barcode && state.products.some((product) => product.barcode === barcode)) {
      notify("Já existe um produto com esse código de barras.", true);
      return false;
    }
    const product = { id: id(), name, barcode, category: String(formData.get("category") || "").trim(), price, cost, stock, minStock };
    state.products.push(product);
    if (stock > 0) state.expenses.push({ id: id(), description: `Estoque inicial: ${name} (${stock} un.)`, type: "Reposição de estoque", amount: cost * stock, createdAt: new Date().toISOString(), userName: currentUser.name });
    await persist();
    if (fromRestock) notify("Produto cadastrado e estoque inicial registrado.");
    else notify("Produto cadastrado com sucesso.");
    navigate("products");
    return true;
  }

  function addToCart(productId) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) return;
    const existing = cart.find((line) => line.productId === productId);
    if ((existing?.quantity || 0) >= product.stock) {
      notify("Estoque insuficiente para essa quantidade.", true);
      return;
    }
    if (existing) existing.quantity += 1;
    else cart.push({ productId, name: product.name, price: product.price, cost: product.cost, quantity: 1 });
    renderPage();
  }

  async function finalizeSale() {
    if (!cart.length) return notify("Adicione produtos ao carrinho antes de finalizar.", true);
    for (const line of cart) {
      const product = state.products.find((item) => item.id === line.productId);
      if (!product || product.stock < line.quantity) return notify(`Estoque insuficiente para ${line.name}.`, true);
    }
    const sale = {
      id: id(),
      createdAt: new Date().toISOString(),
      sellerId: currentUser.id,
      sellerName: currentUser.name,
      payment: $('input[name="payment"]:checked')?.value || "Pix",
      total: cart.reduce((sum, line) => sum + line.price * line.quantity, 0),
      items: cart.map((line) => ({ ...line }))
    };
    for (const line of sale.items) state.products.find((item) => item.id === line.productId).stock -= line.quantity;
    state.sales.push(sale);
    await persist();
    cart = [];
    notify("Venda finalizada com sucesso.");
    navigate("dashboard");
  }

  document.addEventListener("submit", (event) => {
    handleSubmit(event).catch(reportAsyncError);
  });

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    if (form.id === "adminSetupForm") {
      const name = String(data.get("name") || "").trim();
      const username = String(data.get("username") || "").trim();
      const password = String(data.get("password") || "");
      if (state.users.some((user) => user.role === "admin" && user.active !== false)) return notify("A configuração inicial já foi concluída.", true);
      if (state.users.some((user) => user.username.toLocaleLowerCase("pt-BR") === username.toLocaleLowerCase("pt-BR"))) return notify("Esse nome de usuário já está em uso.", true);
      if (!name || username.length < 3 || password.length < 12 || password.length > 128) return notify("Informe nome, usuário (mín. 3 caracteres) e senha (12 a 128 caracteres).", true);
      const credentials = await hashPassword(password);
      const user = { id: id(), name, username, role: "admin", active: true, ...credentials };
      state.users.push(user);
      await persist();
      $("#adminSetupForm").classList.add("hidden");
      $("#loginForm").classList.remove("hidden");
      $("#loginDescription").textContent = "Entre para acessar o painel da sua loja.";
      $("#loginForm").reset();
      $("#loginForm").elements.username.value = username;
      notify("Administrador criado. Entre com sua nova conta.");
      return;
    }
    if (form.id === "loginForm") {
      const username = String(data.get("username") || "").trim().toLocaleLowerCase("pt-BR");
      const password = String(data.get("password") || "");
      const user = state.users.find((item) => item.active !== false && item.username.toLocaleLowerCase("pt-BR") === username);
      if (!user || !await verifyPassword(user, password)) return notify("Usuário ou senha incorretos.", true);
      setSession(user);
      return;
    }
    if (form.id === "productForm") {
      const editId = form.dataset.editId;
      if (editId) {
        const product = state.products.find((item) => item.id === editId);
        const name = String(data.get("name") || "").trim();
        const barcode = String(data.get("barcode") || "").trim();
        const price = Number(data.get("price"));
        const cost = Number(data.get("cost"));
        const minStock = Number(data.get("minStock"));
        if (!product || !name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(cost) || cost < 0 || !Number.isInteger(minStock) || minStock < 0) return notify("Confira os dados do produto.", true);
        if (barcode && state.products.some((item) => item.id !== editId && item.barcode === barcode)) return notify("Já existe um produto com esse código de barras.", true);
        Object.assign(product, { name, barcode, category: String(data.get("category") || "").trim(), price, cost, minStock });
        await persist();
        notify("Produto atualizado.");
        navigate("products");
      } else await addProduct(data);
    }
    if (form.id === "userForm") {
      const username = String(data.get("username") || "").trim();
      const name = String(data.get("name") || "").trim();
      const password = String(data.get("password") || "");
      if (state.users.some((user) => user.username.toLocaleLowerCase("pt-BR") === username.toLocaleLowerCase("pt-BR"))) return notify("Esse nome de usuário já está em uso.", true);
      if (!name || username.length < 3 || password.length < 12 || password.length > 128) return notify("Informe nome, usuário (mín. 3 caracteres) e senha (12 a 128 caracteres).", true);
      const credentials = await hashPassword(password);
      state.users.push({ id: id(), name, username, role: String(data.get("role")), active: true, ...credentials });
      await persist();
      notify("Acesso criado com sucesso.");
      navigate("users");
    }
    if (form.id === "passwordForm") {
      const currentPassword = String(data.get("currentPassword") || "");
      const newPassword = String(data.get("newPassword") || "");
      const confirmPassword = String(data.get("confirmPassword") || "");
      if (newPassword.length < 12 || newPassword.length > 128) return notify("A nova senha precisa ter de 12 a 128 caracteres.", true);
      if (newPassword !== confirmPassword) return notify("A confirmação da nova senha não confere.", true);
      if (!await verifyPassword(currentUser, currentPassword)) return notify("A senha atual está incorreta.", true);
      Object.assign(currentUser, await hashPassword(newPassword));
      Object.assign(state.users.find((user) => user.id === currentUser.id), currentUser);
      await persist();
      notify("Senha atualizada com sucesso.");
      navigate("account");
    }
    if (form.id === "expenseForm") {
      const amount = Number(data.get("amount"));
      const description = String(data.get("description") || "").trim();
      if (!description || !Number.isFinite(amount) || amount <= 0) return notify("Informe uma descrição e um valor válido.", true);
      state.expenses.push({ id: id(), description, type: String(data.get("type")), amount, createdAt: new Date().toISOString(), userName: currentUser.name });
      await persist();
      notify("Gasto registrado.");
      navigate("expenses");
    }
    if (form.id === "stockForm") {
      const product = state.products.find((item) => item.id === form.dataset.productId);
      const quantity = Number(data.get("quantity"));
      const unitCost = Number(data.get("unitCost"));
      if (!product || !Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) return notify("Informe uma quantidade e um custo válidos.", true);
      product.stock += quantity;
      product.cost = unitCost;
      state.expenses.push({ id: id(), description: `Reposição: ${product.name} (${quantity} un.)`, type: "Reposição de estoque", amount: quantity * unitCost, createdAt: new Date().toISOString(), userName: currentUser.name });
      await persist();
      notify("Estoque atualizado e compra registrada.");
      navigate("stock");
    }
  }

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.id === "saleSearch") $("#saleResults").innerHTML = productSearchResults(target.value);
    if (target.id === "priceSearch") $("#priceResults").innerHTML = priceResults(target.value);
    if (target.id === "stockSearch") $("#stockResults").innerHTML = stockResults(target.value);
    if (target.id === "salesFilter" || target.id === "paymentFilter") {
      const search = $("#salesFilter").value;
      const payment = $("#paymentFilter").value;
      renderPage();
      $("#salesFilter").value = search;
      $("#paymentFilter").value = payment;
      $("#salesFilter").focus();
      $("#salesFilter").setSelectionRange(search.length, search.length);
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "paymentFilter") {
      const search = $("#salesFilter")?.value || "";
      renderPage();
      $("#salesFilter").value = search;
      $("#paymentFilter").value = event.target.value;
    }
  });

  document.addEventListener("click", (event) => {
    handleClick(event).catch(reportAsyncError);
  });

  async function handleClick(event) {
    const nav = event.target.closest("[data-page]");
    if (nav) return navigate(nav.dataset.page);
    const go = event.target.closest("[data-go]");
    if (go) return navigate(go.dataset.go);
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "add-cart") return addToCart(button.dataset.id);
    if (action === "remove-cart") {
      cart = cart.filter((line) => line.productId !== button.dataset.id);
      return renderPage();
    }
    if (action === "finalize-sale") return finalizeSale();
    if (action === "restock") {
      const product = state.products.find((item) => item.id === button.dataset.id);
      if (!product) return;
      $("#pageContent").innerHTML = `<div class="section-heading"><div><h3>Reposição de estoque</h3><p>Registre a entrada de mercadoria.</p></div><button class="button button-secondary" data-go="stock">← Voltar</button></div>
        <section class="form-card" style="max-width:620px"><h3>${escapeHtml(product.name)} <span class="badge">Estoque: ${product.stock}</span></h3>
        <form id="stockForm" data-product-id="${escapeHtml(product.id)}"><div class="form-grid">
          <label>Quantidade recebida<input name="quantity" type="number" min="1" step="1" required autofocus placeholder="Ex.: 12"></label>
          <label>Custo unitário (R$)<input name="unitCost" type="number" min="0" step="0.01" required value="${product.cost}"></label>
        </div><div class="form-actions"><button class="button button-primary" type="submit">Confirmar reposição</button></div></form></section>`;
      return;
    }
    if (action === "create-from-stock") {
      const barcode = button.dataset.barcode || "";
      $("#pageContent").innerHTML = `<div class="section-heading"><div><h3>Novo produto</h3><p>O código pesquisado foi preenchido para você.</p></div><button class="button button-secondary" data-go="stock">← Voltar</button></div>
        <section class="form-card" style="max-width:700px"><h3>Cadastrar para reposição</h3>${productForm({ barcode })}</section>`;
      return;
    }
    if (action === "edit-product") {
      const product = state.products.find((item) => item.id === button.dataset.id);
      if (!product) return;
      $("#pageContent").innerHTML = `<div class="section-heading"><div><h3>Editar produto</h3><p>Altere os dados de ${escapeHtml(product.name)}.</p></div><button class="button button-secondary" data-go="products">← Voltar</button></div>
        <section class="form-card" style="max-width:700px"><h3>Dados do produto</h3>${productForm(product)}</section>`;
      $("#productForm").dataset.editId = product.id;
      return;
    }
    if (action === "toggle-user") {
      const user = state.users.find((item) => item.id === button.dataset.id);
      if (!user) return;
      if (user.active !== false && user.role === "admin" && state.users.filter((item) => item.role === "admin" && item.active !== false).length <= 1) return notify("Mantenha pelo menos um administrador ativo.", true);
      user.active = user.active === false;
      await persist();
      notify(user.active ? "Acesso ativado." : "Acesso desativado.");
      navigate("users");
    }
  }

  $("#logoutButton").addEventListener("click", () => {
    clearSession();
  });
  window.addEventListener("resize", () => {
    if (currentPage === "dashboard" && currentUser) drawChart();
  });

  async function initialize() {
    let changed = false;
    state.users = state.users.filter((user) => {
      const isPublishedDefault = user.id === "admin-inicial" && user.role === "admin";
      if (isPublishedDefault) changed = true;
      return !isPublishedDefault;
    });
    for (const user of state.users) {
      if (!user.password) continue;
      Object.assign(user, await hashPassword(user.password));
      delete user.password;
      changed = true;
    }
    if (changed) await persist();
    if (!state.users.some((user) => user.role === "admin" && user.active !== false)) {
      $("#loginDescription").textContent = "Crie a primeira conta de administrador para configurar este computador.";
      $("#loginForm").classList.add("hidden");
      $("#adminSetupForm").classList.remove("hidden");
      $("#adminSetupForm").elements.name.focus();
    } else {
      $("#loginForm").classList.remove("hidden");
      $("#loginForm").elements.username.focus();
    }
  }

  initialize().catch(reportAsyncError);
})();
