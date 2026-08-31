import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CalendarRange,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Download,
  FileText,
  Hourglass,
  LayoutDashboard,
  ListChecks,
  Moon,
  Pencil,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Activity,
  Sun,
  Tags,
  Trash2,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import {
  API,
  Account,
  AttentionCenter as AttentionCenterType,
  BackupInfo,
  AnnualBudgetVariance,
  AnnualPlan as AnnualPlanType,
  BudgetVariance,
  Category,
  CategorizationGroup,
  CategorizationRule,
  ContributionRoom,
  Dashboard,
  Goal,
  Holding,
  InformationNote,
  Instrument,
  Insights as InsightsType,
  HouseholdSettings,
  PlannedItem,
  RecurringCalendar,
  RecurringOccurrence,
  RecurringTransaction,
  RetirementSnapshot,
  SearchResult,
  Transaction,
  request,
  waitForApiReady,
} from "./lib/api";
import { applyLanguage, Language } from "./lib/i18n";

const money = (value: string | number, currency = "CAD") =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
const appLocale = () => localStorage.getItem("mapi-language") === "es" ? "es-AR" : "en-CA";
const isBalanceAdjustment = (transaction: Transaction) =>
  transaction.description.startsWith("Ajuste de saldo por carga histórica");
const transactionCategoryLabel = (transaction: Transaction) =>
  transaction.kind === "transfer"
    ? "Transferencia interna"
    : isBalanceAdjustment(transaction)
      ? "Ajuste de saldo"
      : transaction.category?.name || "Sin categoría";
const today = new Date().toISOString().slice(0, 10);
const currentMonth = today.slice(0, 7);
const fullMonthNames = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const currentYear = Number(currentMonth.slice(0, 4));
const monthOptions = Array.from({ length: 7 * 12 }, (_, index) => {
  const year = currentYear + 1 - Math.floor(index / 12);
  const optionMonth = 12 - (index % 12);
  return {
    value: `${year}-${String(optionMonth).padStart(2, "0")}`,
    label: `${fullMonthNames[optionMonth - 1]} ${year}`,
  };
});

type StartupSnapshot = {
  savedAt: number;
  month: string;
  dashboard: Dashboard;
  attention: AttentionCenterType;
  accounts: Account[];
  categories: Category[];
};

const startupSnapshotKey = "mapi-startup-snapshot-v1";

function readStartupSnapshot(): StartupSnapshot | null {
  try {
    const raw = localStorage.getItem(startupSnapshotKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as StartupSnapshot;
    if (!value.dashboard || !value.attention || !Array.isArray(value.accounts) || !Array.isArray(value.categories)) return null;
    return value;
  } catch {
    return null;
  }
}

function writeStartupSnapshot(value: StartupSnapshot) {
  try {
    localStorage.setItem(startupSnapshotKey, JSON.stringify(value));
  } catch {
    // The snapshot is an optional startup optimization; SQLite remains authoritative.
  }
}

function App() {
  const [startupSnapshot] = useState<StartupSnapshot | null>(() => readStartupSnapshot());
  const [dashboard, setDashboard] = useState<Dashboard | null>(
      startupSnapshot?.month === currentMonth ? startupSnapshot.dashboard : null,
    ),
    [attention, setAttention] = useState<AttentionCenterType | null>(startupSnapshot?.attention ?? null),
    [accounts, setAccounts] = useState<Account[]>(startupSnapshot?.accounts ?? []),
    [categories, setCategories] = useState<Category[]>(startupSnapshot?.categories ?? []);
  const [month, setMonth] = useState(currentMonth),
    [page, setPage] = useState<
      | "dashboard"
      | "plan"
      | "accounts"
      | "transactions"
      | "scheduled"
      | "categories"
      | "rules"
      | "investments"
      | "insights"
      | "retirement"
      | "information"
    >("dashboard"),
    [modal, setModal] = useState<
      | "transaction"
      | "edit-transaction"
      | "transfer"
      | "account"
      | "edit-account"
      | "category"
      | "edit-category"
      | "import"
      | "rate"
      | "backups"
      | null
    >(null),
    [error, setError] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [searchQuery, setSearchQuery] = useState(""),
    [searchResults, setSearchResults] = useState<SearchResult[]>([]),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [editing, setEditing] = useState<Transaction | null>(null),
    [editingAccount, setEditingAccount] = useState<Account | null>(null),
    [editingCategory, setEditingCategory] = useState<Category | null>(null),
    [transactionCategoryFilter, setTransactionCategoryFilter] = useState(""),
    [revision, setRevision] = useState(0),
    [booting, setBooting] = useState(!startupSnapshot),
    [serviceReady, setServiceReady] = useState(false),
    [theme, setTheme] = useState<"light" | "dark">(() => {
      const saved = localStorage.getItem("mapi-theme");
      if (saved === "light" || saved === "dark") return saved;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }),
    [language, setLanguage] = useState<Language>(() => {
      const saved = localStorage.getItem("mapi-language");
      return saved === "es" ? "es" : "en";
    });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mapi-theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("mapi-language", language);
    applyLanguage(language);
  }, [language, page, modal]);
  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 2) { setSearchResults([]); return; }
    const timer = window.setTimeout(() => {
      request<SearchResult[]>(`/search?q=${encodeURIComponent(searchQuery)}`).then(setSearchResults).catch((e) => setError(e.message));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [searchOpen, searchQuery]);
  const activeAccounts = accounts.filter((account) => !account.archived);
  const load = async () => {
    try {
      setError("");
      const [d, a, c, attentionData] = await Promise.all([
        request<Dashboard>(`/dashboard?month=${month}`),
        request<Account[]>("/accounts?include_archived=true"),
        request<Category[]>("/categories"),
        request<AttentionCenterType>("/attention"),
      ]);
      setDashboard(d);
      setAccounts(a);
      setCategories(c);
      setAttention(attentionData);
      writeStartupSnapshot({
        savedAt: Date.now(),
        month,
        dashboard: d,
        attention: attentionData,
        accounts: a,
        categories: c,
      });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        await waitForApiReady();
        if (cancelled) return;
        setServiceReady(true);
        const loaded = await load();
        if (cancelled) return;
        setBooting(false);
        if (!loaded) return;
        void Promise.allSettled([
          request("/exchange-rates/refresh", { method: "POST" }),
          request("/market-prices/refresh", { method: "POST" }),
          request("/insights?scope=household&days=90"),
        ]).then(() => { if (!cancelled) void load(); });
      } catch (e) {
        if (cancelled) return;
        setBooting(false);
        setError((e as Error).message);
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [month]);
  const primary = dashboard?.cashflow.find((x) => x.currency === "CAD") || {
    income: "0",
    expenses: "0",
    savings: "0",
  };
  const budgetTotal = useMemo(
    () => dashboard?.budgets.reduce((s, b) => s + Number(b.amount), 0) || 0,
    [dashboard],
  );
  const spentTotal = useMemo(
    () => dashboard?.budgets.reduce((s, b) => s + Number(b.spent), 0) || 0,
    [dashboard],
  );
  async function downloadFile(path: string, fallback: string) {
    try {
      setError("");
      const response = await fetch(`${API}${path}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "No se pudo generar el respaldo");
      }
      const blob = await response.blob(),
        disposition = response.headers.get("Content-Disposition") || "",
        match = disposition.match(/filename="?([^";]+)"?/),
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = match?.[1] || fallback;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (x) {
      setError((x as Error).message);
    }
  }

  if (booting) {
    return (
      <main className="startup-screen" aria-live="polite" aria-busy="true">
        <span className="startup-mark">M</span>
        <div>
          <h1>MAPI</h1>
          <p>Preparando tus datos locales…</p>
        </div>
        <span className="startup-spinner" aria-hidden="true" />
      </main>
    );
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {!serviceReady && (
        <div className="startup-status" role="status">
          <span aria-hidden="true" />
          Actualizando datos…
        </div>
      )}
      <aside>
        <div className="brand">
          <span className="brand-mark">M</span>
          <span>MAPI</span>
          <button type="button" className="sidebar-toggle" onClick={() => setSidebarCollapsed(value => !value)} aria-label={sidebarCollapsed?"Expandir menú":"Contraer menú"} title={sidebarCollapsed?"Expandir menú":"Contraer menú"}>{sidebarCollapsed?<PanelLeftOpen/>:<PanelLeftClose/>}</button>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? "Usar modo claro" : "Usar modo oscuro"}
            title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </button>
          <button
            type="button"
            className="language-toggle"
            onClick={() => setLanguage((value) => value === "es" ? "en" : "es")}
            aria-label={language === "es" ? "Switch to English" : "Cambiar a español"}
            title={language === "es" ? "English" : "Español"}
          >
            {language === "es" ? "EN" : "ES"}
          </button>
        </div>
        <nav>
          <button
            className={page === "dashboard" ? "active" : ""}
            onClick={() => setPage("dashboard")}
          >
            <LayoutDashboard />
            Resumen
          </button>
          <button
            className={page === "plan" ? "active" : ""}
            onClick={() => setPage("plan")}
          >
            <CalendarRange />
            Presupuesto
          </button>
          <button
            className={page === "accounts" ? "active" : ""}
            onClick={() => setPage("accounts")}
          >
            <WalletCards />
            Cuentas
          </button>
          <button
            className={page === "transactions" ? "active" : ""}
            onClick={() => {
              setTransactionCategoryFilter("");
              setPage("transactions");
            }}
          >
            <RefreshCw />
            Movimientos
          </button>
          <button
            className={page === "scheduled" ? "active" : ""}
            onClick={() => setPage("scheduled")}
          >
            <CalendarDays />
            Programados
          </button>
          <button
            className={page === "categories" ? "active" : ""}
            onClick={() => setPage("categories")}
          >
            <Tags />
            Categorías
          </button>
          <button
            className={page === "rules" ? "active" : ""}
            onClick={() => setPage("rules")}
          >
            <ListChecks />
            Reglas
          </button>
          <button
            className={page === "investments" ? "active" : ""}
            onClick={() => setPage("investments")}
          >
            <ArrowUpRight />
            Inversiones
          </button>
          <button
            className={page === "insights" ? "active" : ""}
            onClick={() => setPage("insights")}
          >
            <Activity />
            Análisis
          </button>
          <button
            className={page === "retirement" ? "active" : ""}
            onClick={() => setPage("retirement")}
          >
            <Hourglass />
            Retiro
          </button>
          <button
            className={page === "information" ? "active" : ""}
            onClick={() => setPage("information")}
          >
            <FileText />
            Información
          </button>
        </nav>
        <div className="privacy">
          <span>●</span>
          <div>
            <strong>Datos locales</strong>
            <button
              type="button"
              onClick={() =>
                downloadFile("/export", `mapi-export-${today}.json`)
              }
            >
              <Download />
              Exportar JSON
            </button>
            <button
              type="button"
              onClick={() =>
                downloadFile(
                  "/export/database",
                  `mapi-database-${today}.dump`,
                )
              }
            >
              <Download />
              Respaldo completo
            </button>
            <button type="button" onClick={() => setModal("backups")}>
              <ArchiveRestore />
              Administrar respaldos
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">FINANZAS PERSONALES</p>
            <h1>
              {page === "dashboard"
                ? "Hola, ¿cómo vienen tus números?"
                : page === "plan"
                  ? "Plan financiero anual"
                  : page === "accounts"
                    ? "Tus cuentas"
                    : page === "transactions"
                      ? "Todos los movimientos"
                    : page === "scheduled"
                      ? "Movimientos programados"
                      : page === "categories"
                        ? "Categorías"
                        : page === "rules"
                          ? "Reglas de categorización"
                        : page === "information"
                          ? "Información"
                        : page === "retirement"
                          ? "Camino al retiro"
                          : page === "insights"
                            ? "Panorama financiero"
                          : "Portafolio familiar"}
            </h1>
          </div>
          <div className="header-actions">
            <button className="ghost search-trigger" onClick={() => setSearchOpen(true)} title="Buscar en MAPI">
              <Search /> Buscar
            </button>
            {(page === "dashboard" || page === "transactions") && (
              <select
                className="period-select"
                aria-label="Mes"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              >
                {monthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
            <button className="ghost" onClick={() => setModal("import")}>
              <Upload />
              Importar
            </button>
            {(page === "dashboard" || page === "transactions") && (
              <button className="ghost" onClick={() => setModal("transfer")}>
                <RefreshCw />
                Transferencia
              </button>
            )}
            {page !== "information" && page !== "rules" && page !== "scheduled" && page !== "retirement" && page !== "insights" && (
              <button
                className="primary"
                onClick={() =>
                  setModal(
                    page === "accounts"
                      ? "account"
                      : page === "categories"
                        ? "category"
                        : "transaction",
                  )
                }
              >
                <Plus />
                {page === "accounts"
                  ? "Cuenta"
                  : page === "categories"
                    ? "Categoría"
                    : "Movimiento"}
              </button>
            )}
          </div>
        </header>
        {error && <div className="error">{error}</div>}
        {page === "plan" ? (
          <AnnualPlan year={Number(month.slice(0, 4))} accounts={activeAccounts} categories={categories} />
        ) : page === "accounts" ? (
          <AccountsPage
            accounts={accounts}
            add={() => setModal("account")}
            edit={(account) => {
              setEditingAccount(account);
              setModal("edit-account");
            }}
          />
        ) : page === "transactions" ? (
          <TransactionsPage
            month={month}
            accounts={accounts}
            categories={categories}
            revision={revision}
            initialCategoryFilter={transactionCategoryFilter}
            add={() => setModal("transaction")}
            edit={(item) => {
              setEditing(item);
              setModal("edit-transaction");
            }}
          />
        ) : page === "scheduled" ? (
          <ScheduledPage accounts={activeAccounts} categories={categories} onConfirmed={() => { load(); setRevision((value) => value + 1); }} />
        ) : page === "categories" ? (
          <CategoriesPage
            categories={categories}
            add={() => setModal("category")}
            edit={(category) => {
              setEditingCategory(category);
              setModal("edit-category");
            }}
          />
        ) : page === "rules" ? (
          <RulesPage categories={categories} accounts={accounts} />
        ) : page === "information" ? (
          <InformationPage />
        ) : page === "retirement" ? (
          <RetirementPage />
        ) : page === "investments" ? (
          <Investments
            year={Number(month.slice(0, 4))}
            accounts={activeAccounts}
            refreshAccounts={load}
          />
        ) : page === "insights" ? (
          <InsightsPage />
        ) : (
          <>
            <AttentionPanel
              data={attention}
              onNavigate={(alert) => {
                setTransactionCategoryFilter(
                  alert.type === "uncategorized" ? "uncategorized" : "",
                );
                setPage(alert.target);
              }}
            />
            <section className="hero-grid">
              <article className="net-card">
                <p>Patrimonio neto consolidado</p>
                <h2>{money(dashboard?.net_worth_cad || 0)}</h2>
                <span>
                  {["CAD", "USD", "UYU"]
                    .filter((c) => dashboard?.net_worth[c])
                    .map((c) => money(dashboard!.net_worth[c], c))
                    .join(" · ")}
                </span>
                <div className="mini-label">
                  {dashboard?.missing_rates.length
                    ? `Falta tasa para: ${dashboard.missing_rates.join(", ")}`
                    : "Consolidado en CAD"}
                </div>
                {dashboard?.missing_rates.length ? (
                  <button
                    className="rate-link"
                    onClick={() => setModal("rate")}
                  >
                    Configurar tipo de cambio
                  </button>
                ) : null}
              </article>
              <article className="metric">
                <span className="metric-icon income">
                  <ArrowDownRight />
                </span>
                <div>
                  <p>Ingresos del mes</p>
                  <strong>{money(primary.income)}</strong>
                </div>
              </article>
              <article className="metric">
                <span className="metric-icon expense">
                  <ArrowUpRight />
                </span>
                <div>
                  <p>Gastos del mes</p>
                  <strong>{money(primary.expenses)}</strong>
                </div>
              </article>
              <article className="metric">
                <span className="metric-icon saving">
                  <CircleDollarSign />
                </span>
                <div>
                  <p>Ahorro</p>
                  <strong>{money(primary.savings)}</strong>
                </div>
              </article>
            </section>
            <section className="content-grid">
              <article className="panel accounts-panel">
                <div className="panel-title">
                  <div>
                    <p className="eyebrow">TU DINERO</p>
                    <h3>Cuentas</h3>
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => setPage("accounts")}
                    aria-label="Ver todas las cuentas"
                  >
                    <ChevronRight />
                  </button>
                </div>
                <div className="account-list">
                  {activeAccounts.length ? (
                    activeAccounts.slice(0, 5).map((a) => (
                      <div className="account" key={a.id}>
                        <span className="account-icon">
                          <Building2 />
                        </span>
                        <div>
                          <strong>{a.name}</strong>
                          <small>
                            {a.type.replace("_", " ")} · {a.currency}
                          </small>
                          {a.type === "investment" && (
                            <small className="account-breakdown">
                              Disponible {money(a.cash_balance, a.currency)} ·
                              Invertido {money(a.holdings_balance, a.currency)}
                            </small>
                          )}
                        </div>
                        <b>{money(a.balance, a.currency)}</b>
                        <ChevronRight />
                      </div>
                    ))
                  ) : (
                    <Empty
                      text="Creá tu primera cuenta"
                      action={() => setModal("account")}
                    />
                  )}
                </div>
              </article>
              <article className="panel">
                <div className="panel-title">
                  <div>
                    <p className="eyebrow">PLAN DEL MES</p>
                    <h3>Presupuesto</h3>
                  </div>
                  <span>
                    {budgetTotal
                      ? Math.round((spentTotal / budgetTotal) * 100)
                      : 0}
                    % usado
                  </span>
                  <button className="text-link" onClick={() => setPage("plan")}>Ver plan <ChevronRight /></button>
                </div>
                {dashboard?.budgets.length ? (
                  <>
                    {
                      <div className="budget-total">
                        <span>{money(spentTotal)} gastados</span>
                        <span>de {money(budgetTotal)}</span>
                      </div>
                    }
                    <div className="progress">
                      <i
                        style={{
                          width: `${Math.min(100, (spentTotal / budgetTotal) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="budget-list">
                      {dashboard.budgets.slice(0, 4).map((b) => (
                        <div key={b.id}>
                          <span
                            className="dot"
                            style={{ background: b.category.color }}
                          />
                          {b.category.name}
                          <b>
                            {money(b.spent)} / {money(b.amount)}
                          </b>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <Empty text="Todavía no hay presupuestos" />
                )}
              </article>
              <article className="panel transactions-panel">
                <div className="panel-title">
                  <div>
                    <p className="eyebrow">ACTIVIDAD</p>
                    <h3>Últimos movimientos</h3>
                  </div>
                  <button className="text-link" onClick={() => setPage("transactions")}>Ver todos <ChevronRight /></button>
                </div>
                {dashboard?.recent_transactions.length ? (
                  <div className="transaction-list">
                    {dashboard.recent_transactions.slice(0, 5).map((t) => (
                      <div className="transaction" key={t.id}>
                        <span
                          className={`tx-icon ${Number(t.amount) >= 0 ? "positive" : ""}`}
                        >
                          {Number(t.amount) >= 0 ? (
                            <ArrowDownRight />
                          ) : (
                            <ArrowUpRight />
                          )}
                        </span>
                        <div>
                          <strong>{t.description}</strong>
                          <small>
                            {t.account?.name} ·{" "}
                            {transactionCategoryLabel(t)}
                          </small>
                        </div>
                        <time>
                          {new Date(t.date + "T12:00:00").toLocaleDateString(
                            appLocale(),
                            { day: "2-digit", month: "short" },
                          )}
                        </time>
                        <b
                          className={
                            Number(t.amount) >= 0 ? "positive-text" : ""
                          }
                        >
                          {money(t.amount, t.currency)}
                        </b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    text="Tus movimientos aparecerán acá"
                    action={() => setModal("import")}
                  />
                )}
              </article>
            </section>
          </>
        )}
      </main>
      {modal && (
        <Modal
          wide={modal === "backups"}
          title={
            modal === "transaction"
              ? "Nuevo movimiento"
              : modal === "edit-transaction"
                ? "Editar movimiento"
                : modal === "transfer"
                  ? "Transferencia interna"
                  : modal === "account"
                    ? "Nueva cuenta"
                    : modal === "edit-account"
                      ? "Editar cuenta"
                      : modal === "category"
                        ? "Nueva categoría"
                        : modal === "edit-category"
                          ? "Editar categoría"
                          : modal === "rate"
                            ? "Tipo de cambio"
                            : modal === "backups"
                              ? "Respaldo de datos"
                            : "Importar movimientos"
          }
          close={() => {
            setModal(null);
            setEditing(null);
            setEditingAccount(null);
            setEditingCategory(null);
          }}
        >
          {modal === "transaction" || modal === "edit-transaction" ? (
            <TransactionForm
              accounts={activeAccounts}
              categories={categories}
              transaction={editing || undefined}
              done={() => {
                setModal(null);
                setEditing(null);
                setRevision((value) => value + 1);
                load();
              }}
            />
          ) : modal === "transfer" ? (
            <TransferForm
              accounts={activeAccounts}
              done={() => {
                setModal(null);
                setRevision((value) => value + 1);
                load();
              }}
            />
          ) : modal === "account" || modal === "edit-account" ? (
            <AccountForm
              account={editingAccount || undefined}
              done={() => {
                setModal(null);
                setEditingAccount(null);
                load();
              }}
            />
          ) : modal === "category" || modal === "edit-category" ? (
            <CategoryForm
              category={editingCategory || undefined}
              categories={categories}
              done={() => {
                setModal(null);
                setEditingCategory(null);
                load();
              }}
            />
          ) : modal === "rate" ? (
            <FxRateForm
              currencies={dashboard?.missing_rates || ["USD"]}
              done={() => {
                setModal(null);
                load();
              }}
            />
          ) : modal === "backups" ? (
            <BackupManager />
          ) : (
            <ImportForm
              accounts={activeAccounts}
              categories={categories}
              done={() => {
                setModal(null);
                load();
              }}
            />
          )}
        </Modal>
      )}
      {searchOpen && <Modal title="Buscar en MAPI" close={() => {setSearchOpen(false);setSearchQuery("");}}>
        <div className="global-search">
          <label><Search /><input autoFocus value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Cuenta, movimiento, programado, instrumento…" /></label>
          {searchQuery.length < 2 ? <p>Escribí al menos dos letras.</p> : searchResults.length ? <div className="search-results">
            {searchResults.map((result) => <button key={`${result.type}-${result.id}`} onClick={() => {setPage(result.target);setSearchOpen(false);setSearchQuery("");}}>
              <span><strong>{result.title}</strong><small>{result.subtitle}</small></span><ChevronRight />
            </button>)}
          </div> : <p>No encontramos coincidencias.</p>}
        </div>
      </Modal>}
    </div>
  );
}

function BackupManager() {
  const [backups, setBackups] = useState<BackupInfo[]>([]),
    [file, setFile] = useState<File | null>(null),
    [confirming, setConfirming] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const load = () => request<BackupInfo[]>("/backups").then(setBackups).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  async function create() {
    setBusy(true); setError(""); setMessage("");
    try {
      await request("/backups", {method:"POST"});
      setMessage("Respaldo creado correctamente.");
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function download(item: BackupInfo) {
    setError("");
    try {
      const response = await fetch(`${API}/backups/${encodeURIComponent(item.filename)}`);
      if (!response.ok) throw new Error("No se pudo descargar el respaldo");
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement("a");
      anchor.href=url; anchor.download=item.filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
  }
  async function restore() {
    if (!file) return;
    if (!confirming) { setConfirming(true); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch(`${API}/backups/restore`, {method:"POST", body});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || "No se pudo restaurar el respaldo");
      localStorage.removeItem(startupSnapshotKey);
      setMessage("Datos restaurados correctamente.");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (e) { setError((e as Error).message); setBusy(false); setConfirming(false); }
  }
  const kindLabel = (kind: BackupInfo["kind"]) => kind === "automatic" ? "Automático" : kind === "pre_restore" ? "Antes de restaurar" : "Manual";
  return <div className="backup-manager">
    <section className="backup-intro">
      <div><strong>Copias automáticas diarias</strong><p>MAPI guarda hasta 30 copias diarias en tu Mac. También podés crear y descargar una cuando quieras.</p></div>
      <button className="primary" type="button" disabled={busy} onClick={create}><ArchiveRestore /> Crear respaldo ahora</button>
    </section>
    <section className="restore-panel">
      <strong>Restaurar desde archivo</strong>
      <p>La restauración reemplazará los datos actuales. MAPI creará una copia de seguridad antes de continuar.</p>
      <label className="backup-file-picker">
        <input type="file" accept=".sqlite3,.db" onChange={(event)=>{setFile(event.target.files?.[0]||null);setConfirming(false);}} />
        <Upload />
        <span>{file?.name || "Elegir archivo de respaldo"}</span>
      </label>
      {confirming && <div className="restore-confirmation"><AlertTriangle/><span><b>¿Restaurar {file?.name}?</b><small>Los datos actuales quedarán guardados en una copia “Antes de restaurar”.</small></span></div>}
      <button className={confirming?"danger":"ghost"} type="button" disabled={!file||busy} onClick={restore}><Upload /> {confirming?"Confirmar restauración":"Restaurar"}</button>
    </section>
    {message && <p className="success-message">{message}</p>}
    {error && <p className="form-error">{error}</p>}
    <section>
      <div className="panel-title"><div><p className="eyebrow">HISTORIAL</p><h3>Historial de respaldos</h3></div><span>{backups.length}</span></div>
      {backups.length ? <div className="backup-list">{backups.map(item=><div key={item.filename}>
        <span><strong>{kindLabel(item.kind)}</strong><small>{new Date(item.created_at).toLocaleString()} · {(item.size/1024/1024).toFixed(1)} MB</small></span>
        <button className="ghost" type="button" onClick={()=>download(item)}><Download/> Descargar</button>
      </div>)}</div> : <p className="empty-backups">No hay respaldos todavía.</p>}
    </section>
  </div>;
}

function Empty({ text, action }: { text: string; action?: () => void }) {
  return (
    <div className="empty">
      <p>{text}</p>
      {action && <button onClick={action}>Empezar</button>}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: any;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section className={`modal${wide ? " modal-wide" : ""}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button onClick={close}>
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function AccountsPage({
  accounts,
  add,
  edit,
}: {
  accounts: Account[];
  add: () => void;
  edit: (account: Account) => void;
}) {
  const active = accounts.filter((account) => !account.archived),
    archived = accounts.filter((account) => account.archived);
  const groups = active.reduce(
    (result, account) => {
      (result[account.currency] ??= []).push(account);
      return result;
    },
    {} as Record<string, Account[]>,
  );
  const list = (items: Account[]) => (
    <div className="full-account-list">
      {items.map((account) => (
        <button
          type="button"
          className="account-editable"
          key={account.id}
          onClick={() => edit(account)}
        >
          <span className="account-icon">
            <Building2 />
          </span>
          <div>
            <strong>{account.name}</strong>
            <small>
              {account.type.replace("_", " ")} · {account.owner || "household"}
              {account.account_subtype ? ` · ${account.account_subtype}` : ""}
            </small>
            {account.type === "investment" && (
              <small className="account-breakdown">
                Disponible {money(account.cash_balance, account.currency)} ·
                Invertido {money(account.holdings_balance, account.currency)}
              </small>
            )}
          </div>
          <b>{money(account.balance, account.currency)}</b>
          <em>{account.currency}</em>
          <Pencil />
        </button>
      ))}
    </div>
  );
  return (
    <section className="accounts-page">
      <div className="page-summary">
        {Object.entries(groups).map(([currency, items]) => (
          <article key={currency}>
            <span>Total {currency}</span>
            <strong>
              {money(
                items.reduce((sum, item) => sum + Number(item.balance), 0),
                currency,
              )}
            </strong>
            <small>
              {items.length}{" "}
              {items.length === 1 ? "cuenta activa" : "cuentas activas"}
            </small>
          </article>
        ))}
      </div>
      <article className="panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">SALDOS POR CUENTA</p>
            <h3>Cuentas activas</h3>
          </div>
          <button className="primary compact" onClick={add}>
            <Plus />
            Nueva cuenta
          </button>
        </div>
        {active.length ? (
          list(active)
        ) : (
          <Empty text="No hay cuentas activas" action={add} />
        )}
      </article>
      {archived.length > 0 && (
        <article className="panel archived-accounts">
          <div className="panel-title">
            <div>
              <p className="eyebrow">HISTORIAL</p>
              <h3>Cuentas archivadas</h3>
            </div>
            <span className="archived-count">{archived.length}</span>
          </div>
          <p className="panel-help">
            Conservan todos sus movimientos e inversiones, pero no se incluyen
            en el patrimonio ni se ofrecen para nuevos movimientos.
          </p>
          {list(archived)}
        </article>
      )}
    </section>
  );
}

function CategoriesPage({
  categories,
  add,
  edit,
}: {
  categories: Category[];
  add: () => void;
  edit: (category: Category) => void;
}) {
  const expenses = categories.filter((category) => !category.is_income),
    income = categories.filter((category) => category.is_income);
  return (
    <section className="categories-page">
      <div className="page-summary">
        <article>
          <span>Categorías</span>
          <strong>{categories.length}</strong>
          <small>En total</small>
        </article>
        <article>
          <span>Gastos</span>
          <strong>{expenses.length}</strong>
          <small>Para presupuestos y consumos</small>
        </article>
        <article>
          <span>Ingresos</span>
          <strong>{income.length}</strong>
          <small>Para salarios y otras entradas</small>
        </article>
      </div>
      <div className="content-grid category-panels">
        <article className="panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">GASTOS</p>
              <h3>Categorías de gastos</h3>
            </div>
            <span>{expenses.length}</span>
          </div>
          {expenses.length ? (
            <CategoryTree categories={expenses} edit={edit} />
          ) : (
            <Empty text="No hay categorías de gastos" action={add} />
          )}
        </article>
        <article className="panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">INGRESOS</p>
              <h3>Categorías de ingresos</h3>
            </div>
            <span>{income.length}</span>
          </div>
          {income.length ? (
            <CategoryTree categories={income} edit={edit} />
          ) : (
            <Empty text="No hay categorías de ingresos" action={add} />
          )}
        </article>
      </div>
    </section>
  );
}

function CategoryTree({
  categories,
  edit,
}: {
  categories: Category[];
  edit: (category: Category) => void;
}) {
  const ids = new Set(categories.map((category) => category.id));
  const children = new Map<string, Category[]>();
  for (const category of categories) {
    if (category.parent_id && ids.has(category.parent_id)) {
      const siblings = children.get(category.parent_id) || [];
      siblings.push(category);
      children.set(category.parent_id, siblings);
    }
  }
  const roots = categories.filter(
    (category) => !category.parent_id || !ids.has(category.parent_id),
  );
  const render = (
    category: Category,
    depth: number,
    trail: Set<string>,
  ): any => {
    if (trail.has(category.id)) return null;
    const nextTrail = new Set(trail).add(category.id),
      childItems = children.get(category.id) || [],
      classification = childItems.length
        ? "Grupo"
        : category.is_income
          ? "Ingreso"
          : category.is_essential === true
            ? "Esencial"
            : category.is_essential === false
              ? "No esencial"
              : "Sin clasificar";
    return (
      <div className="category-branch" key={category.id}>
        <button
          type="button"
          className={`category-editable ${depth ? "subcategory" : ""}`}
          style={{ "--category-depth": depth } as any}
          onClick={() => edit(category)}
        >
          <i style={{ background: category.color }} />
          <span>
            <strong>{category.name}</strong>
            <small>
              {classification}
              {depth ? " · Subcategoría" : ""}
            </small>
          </span>
          <Pencil />
        </button>
        {childItems.map((child) => render(child, depth + 1, nextTrail))}
      </div>
    );
  };
  return (
    <div className="category-tree">
      {roots.map((category) => render(category, 0, new Set()))}
    </div>
  );
}

function CategoryForm({
  category,
  categories,
  done,
}: {
  category?: Category;
  categories: Category[];
  done: () => void;
}) {
  const [error, setError] = useState(""),
    [categoryType, setCategoryType] = useState(
      category?.is_income ? "income" : "expense",
    );
  const hasChildren = Boolean(
    category && categories.some((item) => item.parent_id === category.id),
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data: any = Object.fromEntries(new FormData(e.currentTarget));
    data.is_income = data.category_type === "income";
    data.is_essential =
      data.is_income || hasChildren
        ? null
        : data.essential === "yes"
          ? true
          : data.essential === "no"
            ? false
            : null;
    data.parent_id = data.parent_id || null;
    delete data.category_type;
    delete data.essential;
    try {
      await request(category ? `/categories/${category.id}` : "/categories", {
        method: category ? "PATCH" : "POST",
        body: JSON.stringify(data),
      });
      done();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  async function remove() {
    if (
      !category ||
      !window.confirm(
        `¿Eliminar la categoría ${category.name}? Los movimientos quedarán como Sin categoría.`,
      )
    )
      return;
    try {
      await request(`/categories/${category.id}`, { method: "DELETE" });
      done();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  return (
    <form onSubmit={submit}>
      <label>
        Nombre
        <input
          name="name"
          defaultValue={category?.name}
          placeholder="Supermercado"
          required
        />
      </label>
      <div className="form-row">
        <label>
          Tipo
          <select
            name="category_type"
            value={categoryType}
            onChange={(e) => setCategoryType(e.target.value)}
          >
            <option value="expense">Gasto</option>
            <option value="income">Ingreso</option>
          </select>
        </label>
        <label>
          Color
          <input
            className="color-input"
            name="color"
            type="color"
            defaultValue={category?.color || "#64748b"}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Clasificación
          <select
            name="essential"
            defaultValue={
              category?.is_essential === true
                ? "yes"
                : category?.is_essential === false
                  ? "no"
                  : ""
            }
            disabled={hasChildren || categoryType === "income"}
          >
            <option value="">
              {hasChildren
                ? "No aplica: tiene subcategorías"
                : "Sin clasificar"}
            </option>
            <option value="yes">Esencial</option>
            <option value="no">No esencial</option>
          </select>
          {hasChildren && (
            <small>Las categorías padre se usan solamente para agrupar.</small>
          )}
        </label>
        <label>
          Grupo padre
          <select name="parent_id" defaultValue={category?.parent_id || ""}>
            <option value="">Ninguno</option>
            {categories
              .filter((item) => item.id !== category?.id)
              .map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        {category && (
          <button type="button" className="danger" onClick={remove}>
            <Trash2 />
            Eliminar
          </button>
        )}
        <button className="primary submit">
          {category ? "Guardar cambios" : "Crear categoría"}
        </button>
      </div>
    </form>
  );
}

function TransactionsPage({
  month,
  accounts,
  categories,
  revision,
  initialCategoryFilter,
  add,
  edit,
}: {
  month: string;
  accounts: Account[];
  categories: Category[];
  revision: number;
  initialCategoryFilter: string;
  add: () => void;
  edit: (item: Transaction) => void;
}) {
  const [items, setItems] = useState<Transaction[]>([]),
    [review, setReview] = useState<{groups:CategorizationGroup[];transactions:number}|null>(null),
    [accountFilter, setAccountFilter] = useState(""),
    [kindFilter, setKindFilter] = useState(""),
    [categoryFilter, setCategoryFilter] = useState(initialCategoryFilter),
    [error, setError] = useState("");
  const loadTransactions = () => Promise.all([
    request<Transaction[]>(`/transactions?month=${month}&limit=1000`).then(setItems),
    request<{groups:CategorizationGroup[];transactions:number}>("/categorization/review").then(setReview),
  ]).catch((e) => setError(e.message));
  useEffect(() => { loadTransactions(); }, [month, revision]);
  const filteredItems = items.filter(
    (item) =>
      (!accountFilter || item.account_id === accountFilter) &&
      (!kindFilter || item.kind === kindFilter) &&
      (!categoryFilter ||
        (categoryFilter === "uncategorized"
          ? !item.category_id && item.kind !== "transfer" && !isBalanceAdjustment(item)
          : item.category_id === categoryFilter)),
  );
  const cadItems = filteredItems.filter((x) => x.currency === "CAD"),
    income = cadItems
      .filter((x) => Number(x.amount) > 0 && x.kind !== "transfer")
      .reduce((s, x) => s + Number(x.amount), 0),
    expenses = Math.abs(
      cadItems
        .filter((x) => Number(x.amount) < 0 && x.kind !== "transfer")
        .reduce((s, x) => s + Number(x.amount), 0),
    );
  const filtersActive = Boolean(accountFilter || kindFilter || categoryFilter);
  const clearFilters = () => {
    setAccountFilter("");
    setKindFilter("");
    setCategoryFilter("");
  };
  return (
    <>
      {error && <div className="error">{error}</div>}
      <section className="page-summary">
        <article>
          <span>Movimientos</span>
          <strong>{filteredItems.length}</strong>
          <small>
            {filtersActive ? `de ${items.length} en ${month}` : month}
          </small>
        </article>
        <article>
          <span>Ingresos CAD</span>
          <strong>{money(income)}</strong>
          <small>Según los filtros</small>
        </article>
        <article>
          <span>Gastos CAD</span>
          <strong>{money(expenses)}</strong>
          <small>Según los filtros</small>
        </article>
      </section>
      {review && review.transactions > 0 && (
        <SmartCategorizationReview
          review={review}
          categories={categories}
          accounts={accounts}
          refreshed={loadTransactions}
        />
      )}
      <article className="panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">{month}</p>
            <h3>Movimientos registrados</h3>
          </div>
          <button className="primary compact" onClick={add}>
            <Plus />
            Nuevo
          </button>
        </div>
        <div className="transaction-filters">
          <label>
            Cuenta
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
            >
              <option value="">Todas las cuentas</option>
              {accounts.map((account) => (
                <option value={account.id} key={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
            >
              <option value="">Todos los tipos</option>
              <option value="income">Ingresos</option>
              <option value="expense">Gastos</option>
              <option value="transfer">Transferencias</option>
            </select>
          </label>
          <label>
            Categoría
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">Todas las categorías</option>
              <option value="uncategorized">Sin categoría</option>
              {categories
                .filter(
                  (category) =>
                    !categories.some(
                      (child) => child.parent_id === category.id,
                    ),
                )
                .map((category) => (
                <option value={category.id} key={category.id}>
                  {category.name}
                </option>
                ))}
            </select>
          </label>
          <button
            className="ghost clear-filters"
            onClick={clearFilters}
            disabled={!filtersActive}
          >
            Limpiar
          </button>
        </div>
        {filteredItems.length ? (
          <div className="transaction-list full">
            {filteredItems.map((t) => (
              <button
                type="button"
                className="transaction transaction-editable"
                key={t.id}
                onClick={() => edit(t)}
              >
                <span
                  className={`tx-icon ${Number(t.amount) >= 0 ? "positive" : ""}`}
                >
                  {Number(t.amount) >= 0 ? (
                    <ArrowDownRight />
                  ) : (
                    <ArrowUpRight />
                  )}
                </span>
                <div>
                  <strong>{t.description}</strong>
                  <small>
                    {t.account?.name} · {transactionCategoryLabel(t)}
                  </small>
                </div>
                <time>
                  {new Date(t.date + "T12:00:00").toLocaleDateString(appLocale())}
                </time>
                <b className={Number(t.amount) >= 0 ? "positive-text" : ""}>
                  {money(t.amount, t.currency)}
                </b>
                <Pencil className="edit-icon" />
              </button>
            ))}
          </div>
        ) : (
          <Empty
            text={
              filtersActive
                ? "No hay movimientos que coincidan con los filtros"
                : "No hay movimientos para este mes"
            }
            action={filtersActive ? clearFilters : add}
          />
        )}
      </article>
    </>
  );
}

function SmartCategorizationReview({review,categories,accounts,refreshed}:{review:{groups:CategorizationGroup[];transactions:number};categories:Category[];accounts:Account[];refreshed:()=>Promise<any>}) {
  const [expanded,setExpanded]=useState(false);
  const groups=expanded?review.groups:review.groups.slice(0,6);
  return <section className="panel smart-review"><div className="panel-title"><div><p className="eyebrow">REVISIÓN INTELIGENTE</p><h3>{review.transactions} movimientos por clasificar</h3><small>Agrupados por comercio para resolver varios a la vez.</small></div>{review.groups.length>6&&<button className="ghost compact" onClick={()=>setExpanded(!expanded)}>{expanded?"Ver menos":`Ver ${review.groups.length} grupos`}</button>}</div>
    <div className="smart-review-list">{groups.map(group=><SmartCategorizationGroup key={`${group.key}-${group.currency}-${group.kind}`} group={group} categories={categories} account={accounts.find(item=>item.id===group.account_id)} refreshed={refreshed}/>)}</div>
  </section>;
}

function SmartCategorizationGroup({group,categories,account,refreshed}:{group:CategorizationGroup;categories:Category[];account?:Account;refreshed:()=>Promise<any>}) {
  const selectable=categories.filter(category=>!categories.some(child=>child.parent_id===category.id)&&(group.kind==="income"?category.is_income:!category.is_income));
  const [categoryId,setCategoryId]=useState(group.suggested_category_id||"");
  const [busy,setBusy]=useState(false);
  const confidence=Math.round(Number(group.confidence)*100);
  async function apply(createRule:boolean){if(!categoryId)return;setBusy(true);try{await request("/categorization/apply",{method:"POST",body:JSON.stringify({transaction_ids:group.transaction_ids,category_id:categoryId,create_rule:createRule,rule_name:group.key,rule_value:group.description,operator:"contains",match_amount:group.same_amount,match_account:false,match_currency:true,match_kind:true})});await refreshed();}finally{setBusy(false);}}
  async function remove(ids:string[],label:string){if(!window.confirm(`¿Eliminar ${label}? Esta acción no se puede deshacer.`))return;setBusy(true);try{await request("/categorization/delete",{method:"POST",body:JSON.stringify({transaction_ids:ids})});await refreshed();}finally{setBusy(false);}}
  return <article><div><strong>{group.description}</strong><small>{group.count} movimientos · {account?.name||"Cuenta"} · {group.currency}</small><span className="review-examples">{group.examples.map((example,index)=><span key={example.id}><small>{new Date(example.date+"T12:00:00").toLocaleDateString(appLocale())} · {money(example.amount,group.currency)}</small><button type="button" title="Eliminar este movimiento" aria-label={`Eliminar movimiento del ${example.date}`} disabled={busy} onClick={()=>remove([example.id],"este movimiento")}><Trash2/></button></span>)}</span>{group.source&&<span className={`confidence ${confidence>=90?"high":confidence>=70?"medium":"low"}`}>{confidence}% · sugerido por {group.source}</span>}</div><select value={categoryId} onChange={event=>setCategoryId(event.target.value)}><option value="">Elegí categoría</option>{selectable.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select><button className="ghost compact" disabled={!categoryId||busy} onClick={()=>apply(false)}>Aplicar al grupo</button><button className="primary compact" disabled={!categoryId||busy} onClick={()=>apply(true)}>Aplicar a todos y crear regla</button><button className="danger compact" disabled={busy} onClick={()=>remove(group.transaction_ids,`el grupo completo de ${group.count} movimientos`)}><Trash2/> Eliminar grupo</button></article>;
}

function FxRateForm({
  currencies,
  done,
}: {
  currencies: string[];
  done: () => void;
}) {
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await request("/exchange-rates", {
        method: "POST",
        body: JSON.stringify({ ...data, to_currency: "CAD" }),
      });
      done();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  return (
    <form onSubmit={submit}>
      <p className="form-note">
        Ingresá cuántos dólares canadienses equivale una unidad de la moneda. El
        saldo original no cambia; esta tasa sólo se usa para consolidar.
      </p>
      <label>
        Moneda
        <select name="from_currency">
          {currencies
            .filter((c) => c !== "CAD")
            .map((c) => (
              <option key={c}>{c}</option>
            ))}
        </select>
      </label>
      <label>
        1 unidad equivale a
        <input
          name="rate"
          type="number"
          step="0.00000001"
          placeholder="Ej.: 1.38 CAD por 1 USD"
          required
        />
      </label>
      <label>
        Fecha
        <input name="date" type="date" defaultValue={today} required />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary submit">Guardar y recalcular</button>
    </form>
  );
}

function TransactionForm({
  accounts,
  categories,
  transaction,
  done,
}: {
  accounts: Account[];
  categories: Category[];
  transaction?: Transaction;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [kind, setKind] = useState(transaction?.kind || "expense"),
    [categoryId, setCategoryId] = useState(transaction?.category_id || "");
  const availableCategories = categories.filter(
    (category) =>
      !categories.some((child) => child.parent_id === category.id) &&
      (kind === "income"
        ? category.is_income
        : kind === "expense"
          ? !category.is_income
          : false),
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const data: any = Object.fromEntries(new FormData(e.currentTarget));
    if (!data.category_id) data.category_id = null;
    try {
      await request(
        transaction ? `/transactions/${transaction.id}` : "/transactions",
        { method: transaction ? "PATCH" : "POST", body: JSON.stringify(data) },
      );
      done();
    } catch (x) {
      setError((x as Error).message);
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !transaction ||
      !window.confirm(
        "¿Eliminar este movimiento? Esta acción no se puede deshacer.",
      )
    )
      return;
    setBusy(true);
    try {
      await request(`/transactions/${transaction.id}`, { method: "DELETE" });
      done();
    } catch (x) {
      setError((x as Error).message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <label>
        Cuenta
        <select
          name="account_id"
          defaultValue={transaction?.account_id || accounts[0]?.id}
          required
        >
          {accounts.map((a) => (
            <option value={a.id} key={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <div className="form-row">
        <label>
          Fecha
          <input
            name="date"
            type="date"
            defaultValue={transaction?.date || today}
            required
          />
        </label>
        <label>
          Monto
          <input
            name="amount"
            type="number"
            step="0.01"
            defaultValue={
              transaction ? Number(transaction.amount).toFixed(2) : undefined
            }
            placeholder="-45.90"
            required
          />
          <small>Negativo para gastos; positivo para ingresos.</small>
        </label>
      </div>
      <label>
        Descripción
        <input
          name="description"
          defaultValue={transaction?.description}
          placeholder="Supermercado, sueldo…"
          required
        />
      </label>
      <div className="form-row">
        <label>
          Tipo
          <select
            name="kind"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
              setCategoryId("");
            }}
          >
            <option value="expense">Gasto</option>
            <option value="income">Ingreso</option>
            {transaction?.kind === "transfer" && (
              <option value="transfer">Transferencia interna</option>
            )}
          </select>
        </label>
        <label>
          Categoría
          <select
            name="category_id"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Sin categoría</option>
            {availableCategories.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {transaction?.transfer_id && (
        <p className="form-note">
          Esta transferencia está vinculada a otra cuenta. Para mantener ambos
          saldos consistentes, eliminála y creala nuevamente.
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        {transaction && (
          <button
            type="button"
            className="danger"
            onClick={remove}
            disabled={busy}
          >
            <Trash2 />
            Eliminar
          </button>
        )}
        <button
          className="primary submit"
          disabled={busy || Boolean(transaction?.transfer_id)}
        >
          {transaction ? "Guardar cambios" : "Guardar movimiento"}
        </button>
      </div>
    </form>
  );
}

function TransferForm({
  accounts,
  done,
}: {
  accounts: Account[];
  done: () => void;
}) {
  const [fromId, setFromId] = useState(accounts[0]?.id || ""),
    [toId, setToId] = useState(
      accounts.find((account) => account.id !== accounts[0]?.id)?.id || "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const source = accounts.find((account) => account.id === fromId),
    target = accounts.find((account) => account.id === toId),
    crossCurrency = Boolean(
      source && target && source.currency !== target.currency,
    );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const data: any = Object.fromEntries(new FormData(e.currentTarget));
    if (!data.received_amount) data.received_amount = null;
    try {
      await request("/transfers", {
        method: "POST",
        body: JSON.stringify(data),
      });
      done();
    } catch (x) {
      setError((x as Error).message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <p className="form-note">
        Mueve dinero entre tus propias cuentas. Para pagar una tarjeta, elegí la
        cuenta bancaria como origen y la tarjeta como destino. No se contabiliza
        como ingreso ni como gasto.
      </p>
      <label>
        Desde
        <select
          name="from_account_id"
          value={fromId}
          onChange={(e) => {
            setFromId(e.target.value);
            if (e.target.value === toId) setToId("");
          }}
          required
        >
          <option value="">Elegí la cuenta de origen</option>
          {accounts.map((account) => (
            <option value={account.id} key={account.id}>
              {account.name} · {account.currency}
            </option>
          ))}
        </select>
      </label>
      <label>
        Hacia
        <select
          name="to_account_id"
          value={toId}
          onChange={(e) => setToId(e.target.value)}
          required
        >
          <option value="">Elegí la cuenta de destino</option>
          {accounts
            .filter((account) => account.id !== fromId)
            .map((account) => (
              <option value={account.id} key={account.id}>
                {account.name} · {account.currency}
              </option>
            ))}
        </select>
      </label>
      <div className="form-row">
        <label>
          Fecha
          <input name="date" type="date" defaultValue={today} required />
        </label>
        <label>
          Monto enviado {source && `(${source.currency})`}
          <input
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="500.00"
            required
          />
        </label>
      </div>
      {crossCurrency && (
        <label>
          Monto recibido ({target?.currency})
          <input
            name="received_amount"
            type="number"
            min="0.01"
            step="0.01"
            required
          />
          <small>
            Ingresá el importe exacto acreditado después de la conversión.
          </small>
        </label>
      )}
      <label>
        Descripción
        <input
          name="description"
          defaultValue={
            target?.type === "credit_card"
              ? `Pago de ${target.name}`
              : "Transferencia interna"
          }
          key={target?.id}
          required
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary submit" disabled={busy || !fromId || !toId}>
        {busy ? "Guardando…" : "Registrar transferencia"}
      </button>
    </form>
  );
}
function AccountForm({
  account,
  done,
}: {
  account?: Account;
  done: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [accountType, setAccountType] = useState(account?.type || "checking"),
    [pendingAction, setPendingAction] = useState<"archive" | "delete" | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const d = Object.fromEntries(new FormData(e.currentTarget));
    if (account && d.current_balance !== undefined) {
      const currentValue =
        d.type === "investment"
          ? Number(account.cash_balance || 0)
          : Number(account.balance || 0);
      d.opening_balance = (
        Number(account.opening_balance) +
        Number(d.current_balance) -
        currentValue
      ).toFixed(2);
      delete d.current_balance;
    }
    try {
      await request(account ? `/accounts/${account.id}` : "/accounts", {
        method: account ? "PATCH" : "POST",
        body: JSON.stringify(d),
      });
      done();
    } catch (x) {
      setError((x as Error).message);
      setBusy(false);
    }
  }
  async function remove() {
    if (!account) return;
    setBusy(true);
    try {
      await request(`/accounts/${account.id}`, { method: "DELETE" });
      done();
    } catch (x) {
      setError((x as Error).message);
      setBusy(false);
    }
  }
  async function setArchived(archived: boolean) {
    if (!account) return;
    setBusy(true);
    try {
      await request(
        `/accounts/${account.id}/archive?archived=${archived}`,
        { method: "PATCH" },
      );
      done();
    } catch (x) {
      setError((x as Error).message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      {account?.archived && (
        <p className="form-note">
          Esta cuenta está archivada. Conserva todo su historial, pero no forma
          parte de los totales actuales.
        </p>
      )}
      <label>
        Nombre
        <input
          name="name"
          defaultValue={account?.name}
          placeholder="Cuenta corriente"
          required
        />
      </label>
      <label>
        Institución
        <input
          name="institution"
          defaultValue={account?.institution || ""}
          placeholder="Bank or brokerage…"
        />
      </label>
      <div className="form-row">
        <label>
          Tipo
          <select
            name="type"
            value={accountType}
            onChange={(event) => setAccountType(event.target.value)}
          >
            <option value="checking">Cuenta corriente</option>
            <option value="savings">Ahorro</option>
            <option value="credit_card">Tarjeta de crédito</option>
            <option value="cash">Efectivo</option>
            <option value="investment">Inversión</option>
          </select>
        </label>
        <label>
          Moneda
          <select
            name="currency"
            defaultValue={account?.currency || "CAD"}
            disabled={Boolean(account)}
          >
            <option>CAD</option>
            <option>USD</option>
            <option>UYU</option>
          </select>
          {account && (
            <input type="hidden" name="currency" value={account.currency} />
          )}
        </label>
      </div>
      <div className="form-row">
        <label>
          Propietario
          <select name="owner" defaultValue={account?.owner || "household"}>
            <option value="household">Hogar</option>
            <option value="person_a">Person A</option>
            <option value="person_b">Person B</option>
            <option value="joint">Conjunta</option>
          </select>
        </label>
        <label>
          Subtipo de inversión
          <select
            name="account_subtype"
            defaultValue={account?.account_subtype || ""}
          >
            <option value="">Ninguno</option>
            <option>TFSA</option>
            <option>FHSA</option>
            <option>RRSP</option>
            <option>RESP</option>
            <option value="NON_REGISTERED">Non-registered</option>
          </select>
        </label>
      </div>
      <label>
        {accountType === "investment"
          ? account
            ? "Efectivo disponible"
            : "Efectivo inicial disponible"
          : account
            ? "Monto actual"
            : "Saldo inicial"}
        <input
          key={`${account?.id || "new"}-${accountType}`}
          name={account ? "current_balance" : "opening_balance"}
          type="number"
          step="0.01"
          defaultValue={
            account
              ? Number(
                  accountType === "investment"
                    ? account.cash_balance || 0
                    : account.balance || 0,
                ).toFixed(2)
              : "0.00"
          }
        />
        <small>
          {accountType === "investment"
            ? "Dinero sin invertir dentro de la cuenta. Las posiciones se calculan y suman automáticamente."
            : account
            ? "Ajusta el saldo base y conserva todos los movimientos e inversiones."
            : "Monto que tenía la cuenta antes del primer movimiento cargado."}
        </small>
      </label>
      {error && <p className="form-error">{error}</p>}
      {account && pendingAction && (
        <section className={`account-confirmation ${pendingAction === "delete" ? "is-danger" : ""}`}>
          <div>
            <strong>{pendingAction === "delete" ? "Eliminar definitivamente" : "Archivar cuenta"}</strong>
            <p>
              {pendingAction === "delete"
                ? `Se eliminarán ${account.name}, sus movimientos, posiciones e importaciones. Esta acción no se puede deshacer.`
                : `${account.name} dejará de aparecer en los totales actuales, pero conservará todo su historial.`}
            </p>
          </div>
          <div className="account-confirmation-actions">
            <button type="button" className="ghost" onClick={() => setPendingAction(null)} disabled={busy}>
              Cancelar
            </button>
            <button
              type="button"
              className={pendingAction === "delete" ? "danger" : "primary"}
              onClick={() => pendingAction === "delete" ? void remove() : void setArchived(true)}
              disabled={busy}
            >
              {busy ? "Procesando…" : pendingAction === "delete" ? "Sí, eliminar" : "Sí, archivar"}
            </button>
          </div>
        </section>
      )}
      <div className="form-actions account-form-actions">
        {account && (
          <button
            type="button"
            className="ghost"
            onClick={() => account.archived ? void setArchived(false) : setPendingAction("archive")}
            disabled={busy}
          >
            {account.archived ? <ArchiveRestore /> : <Archive />}
            {account.archived ? "Reactivar" : "Archivar"}
          </button>
        )}
        {account && (
          <button
            type="button"
            className="danger"
            onClick={() => setPendingAction("delete")}
            disabled={busy}
          >
            <Trash2 />
            Eliminar cuenta
          </button>
        )}
        <button className="primary submit" disabled={busy}>
          {account ? "Guardar cambios" : "Crear cuenta"}
        </button>
      </div>
    </form>
  );
}

function ImportForm({
  accounts,
  categories,
  done,
}: {
  accounts: Account[];
  categories: Category[];
  done: () => void;
}) {
  const [preview, setPreview] = useState<any>(null),
    [account, setAccount] = useState(accounts[0]?.id || ""),
    [error, setError] = useState("");
  async function pick(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      setPreview(
        await request("/imports/preview", {
          method: "POST",
          body: fd,
        }),
      );
    } catch (x) {
      setError((x as Error).message);
    }
  }
  async function commit() {
    try {
      await request("/imports/commit", {
        method: "POST",
        body: JSON.stringify({
          account_id: account,
          filename: preview.filename,
          file_hash: preview.file_hash,
          rows: preview.rows,
        }),
      });
      done();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  if (preview)
    return (
      <div>
        <p className="preview-summary">
          <strong>
            {preview.rows.filter((r: any) => !r.duplicate).length}
          </strong>{" "}
          nuevos · {preview.rows.filter((r: any) => r.duplicate).length}{" "}
          duplicados omitidos
        </p>
        <div className="preview-stats"><span><strong>{preview.rows.filter((r:any)=>r.category_id).length}</strong> categorizados</span><span><strong>{preview.rows.filter((r:any)=>!r.category_id&&!r.duplicate).length}</strong> para revisar</span></div>
        <div className="preview-list">
          {preview.rows.map((r: any, i: number) => (
            <div key={i} className={r.duplicate ? "duplicate" : ""}>
              <span>
                {r.date}
                <br />
                <small>{r.description}</small>
              </span>
              <span className="preview-category"><select value={r.category_id||""} disabled={r.duplicate} onChange={event=>setPreview({...preview,rows:preview.rows.map((row:any,index:number)=>index===i?{...row,category_id:event.target.value||null,category_confidence:event.target.value?1:0,suggestion_source:event.target.value?"manual":null}:row)})}><option value="">Sin categoría</option>{categories.filter(category=>!categories.some(child=>child.parent_id===category.id)&&(r.kind==="income"?category.is_income:!category.is_income)).map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select>{r.category_id&&<small>{Math.round(Number(r.category_confidence||0)*100)}% · {r.suggestion_source||"manual"}</small>}</span>
              <b>{money(r.amount,r.currency||accounts.find(a=>a.id===account)?.currency||"CAD")}</b>
            </div>
          ))}
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="primary submit" onClick={commit}>
          Confirmar importación
        </button>
      </div>
    );
  return (
    <form onSubmit={pick}>
      <label>
        Cuenta (para extractos bancarios)
        <select
          name="account_id"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        >
          {accounts.map((a) => (
            <option value={a.id} key={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="dropzone">
        <Upload />
        <strong>Elegí un archivo</strong>
        <span>CSV, OFX or QFX statement</span>
        <input name="file" type="file" accept=".csv,.ofx,.qfx" required />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary submit">Analizar archivo</button>
    </form>
  );
}

const monthNames = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];
function AnnualPlan({ year, accounts, categories }: { year: number; accounts: Account[]; categories: Category[] }) {
  const [plan, setPlan] = useState<AnnualPlanType | null>(null),
    [annualVariance, setAnnualVariance] = useState<AnnualBudgetVariance | null>(
      null,
    ),
    [items, setItems] = useState<PlannedItem[]>([]),
    [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1),
    [variance, setVariance] = useState<BudgetVariance | null>(null),
    [editingPlanItem, setEditingPlanItem] = useState<PlannedItem | null>(null),
    [showPlanEditor, setShowPlanEditor] = useState(false),
    [showPlanForm, setShowPlanForm] = useState(false),
    [showMonthCopy, setShowMonthCopy] = useState(false),
    [copyTargetMonths, setCopyTargetMonths] = useState<number[]>([]),
    [copyingMonth, setCopyingMonth] = useState(false),
    [error, setError] = useState("");
  const loadPlan = () =>
    Promise.all([
      request<AnnualPlanType>(`/annual-plan?year=${year}`),
      request<AnnualBudgetVariance>(`/budget-variance-annual?year=${year}`),
      request<PlannedItem[]>(`/planned-items?year=${year}`),
    ])
      .then(([p, av, i]) => {
        setPlan(p);
        setAnnualVariance(av);
        setItems(i);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    loadPlan();
  }, [year]);
  useEffect(() => {
    request<BudgetVariance>(
      `/budget-variance?year=${year}&month=${selectedMonth}`,
    )
      .then(setVariance)
      .catch((e) => setError(e.message));
  }, [year, selectedMonth]);
  async function removeItem(item: PlannedItem) {
    if (
      !window.confirm(
        `¿Eliminar ${item.name} de ${monthNames[item.month - 1]}?`,
      )
    )
      return;
    try {
      await request(`/planned-items/${item.id}`, { method: "DELETE" });
      await loadPlan();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function openMonthCopy() {
    setCopyTargetMonths(
      Array.from({ length: 12 }, (_, index) => index + 1).filter(
        (month) => month !== selectedMonth,
      ),
    );
    setShowMonthCopy(true);
  }
  async function copyMonthToSelectedMonths() {
    const sourceName = fullMonthNames[selectedMonth - 1];
    const targetNames = copyTargetMonths.map((month) => fullMonthNames[month - 1]).join(", ");
    if (!copyTargetMonths.length) return;
    if (!window.confirm(
      `¿Copiar ${sourceName} a ${targetNames}? Los montos proyectados de esos meses serán reemplazados.`,
    )) return;
    try {
      setCopyingMonth(true);
      setError("");
      await request("/planned-items/copy-month", {
        method: "POST",
        body: JSON.stringify({
          year,
          source_month: selectedMonth,
          target_months: copyTargetMonths,
        }),
      });
      setShowMonthCopy(false);
      await loadPlan();
      const updatedVariance = await request<BudgetVariance>(
        `/budget-variance?year=${year}&month=${selectedMonth}`,
      );
      setVariance(updatedVariance);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCopyingMonth(false);
    }
  }
  if (error) return <div className="error">{error}</div>;
  if (!plan) return <div className="loading">Cargando plan…</div>;
  return (
    <>
      <section className="plan-kpis">
        <article>
          <span>Ingresos planificados</span>
          <strong>{money(plan.annual.income)}</strong>
        </article>
        <article>
          <span>Gastos</span>
          <strong>{money(plan.annual.expense)}</strong>
        </article>
        <article>
          <span>Ahorro + inversión</span>
          <strong>
            {money(Number(plan.annual.saving) + Number(plan.annual.investment))}
          </strong>
        </article>
        <article className="accent">
          <span>Libre anual</span>
          <strong>{money(plan.annual.free)}</strong>
        </article>
      </section>
      <section className="panel annual-panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">{year} · VALORES CONSOLIDADOS EN CAD</p>
            <h3>Flujo mes a mes</h3>
          </div>
        </div>
        <p className="panel-help annual-source-help">
          Proyección creada con los montos cargados en Presupuesto. No incluye
          Programados ni movimientos reales. Para modificarla, usá el lápiz de
          “Presupuesto vs. real”.
        </p>
        <div className="annual-scroll">
          <table>
            <thead>
              <tr>
                <th></th>
                {monthNames.map((m) => (
                  <th key={m}>{m}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {(["income", "expense"] as const).map(
                (kind) => (
                  <tr key={kind}>
                    <th>
                      {
                        (
                          {
                            income: "Ingresos",
                            expense: "Gastos",
                            saving: "Ahorro",
                            investment: "Inversiones",
                          } as any
                        )[kind]
                      }
                    </th>
                    {plan.months.map((m) => (
                      <td key={m.month}>{money(m.cad[kind])}</td>
                    ))}
                    <td>{money(plan.annual[kind])}</td>
                  </tr>
                ),
              )}
              <tr className="free-row">
                <th>Libre</th>
                {plan.months.map((m) => (
                  <td key={m.month}>{money(m.free)}</td>
                ))}
                <td>{money(plan.annual.free)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      {annualVariance && (
        <AnnualVariancePanel
          data={annualVariance}
          editing={showPlanEditor}
          onEdit={() => {
            setShowPlanEditor((value) => !value);
            setShowPlanForm(false);
            setEditingPlanItem(null);
          }}
        />
      )}
      {showPlanEditor && <section className="panel plan-editor">
        <div className="panel-title">
          <div>
            <p className="eyebrow">EDITAR PLAN</p>
            <h3>Montos proyectados</h3>
          </div>
          <div className="editor-actions">
            <select
              className="month-select"
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(Number(e.target.value));
                setShowMonthCopy(false);
              }}
            >
              {monthNames.map((name, index) => (
                <option value={index + 1} key={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ghost compact copy-month-button"
              onClick={openMonthCopy}
              disabled={copyingMonth || !items.some((item) => item.month === selectedMonth)}
              title={`Elegir a qué meses copiar ${fullMonthNames[selectedMonth - 1]}`}
            >
              <Copy />
              {copyingMonth ? "Copiando…" : "Copiar a meses…"}
            </button>
            <button
              className="primary compact"
              onClick={() => { setEditingPlanItem(null); setShowPlanForm((value) => !value); }}
            >
              <Plus />
              Agregar
            </button>
          </div>
        </div>
        {showMonthCopy && (
          <div className="month-copy-panel">
            <div>
              <strong>Copiar {fullMonthNames[selectedMonth - 1]} a:</strong>
              <small>Los meses seleccionados serán reemplazados por esta plantilla.</small>
            </div>
            <div className="month-copy-grid">
              {monthNames.map((name, index) => {
                const month = index + 1;
                if (month === selectedMonth) return null;
                return (
                  <label key={month}>
                    <input
                      type="checkbox"
                      checked={copyTargetMonths.includes(month)}
                      onChange={(event) => setCopyTargetMonths((current) =>
                        event.target.checked
                          ? [...current, month].sort((a, b) => a - b)
                          : current.filter((value) => value !== month),
                      )}
                    />
                    {name}
                  </label>
                );
              })}
            </div>
            <div className="form-actions month-copy-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setCopyTargetMonths(
                  Array.from({ length: 12 }, (_, index) => index + 1).filter(
                    (month) => month !== selectedMonth,
                  ),
                )}
              >
                Seleccionar todos
              </button>
              <button type="button" className="ghost" onClick={() => setShowMonthCopy(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary"
                disabled={!copyTargetMonths.length || copyingMonth}
                onClick={copyMonthToSelectedMonths}
              >
                {copyingMonth ? "Copiando…" : `Copiar a ${copyTargetMonths.length} ${copyTargetMonths.length === 1 ? "mes" : "meses"}`}
              </button>
            </div>
          </div>
        )}
        {showPlanForm && (
          <PlannedItemForm
            year={year}
            month={selectedMonth}
            item={editingPlanItem || undefined}
            accounts={accounts}
            categories={categories}
            done={() => {
              setShowPlanForm(false);
              setEditingPlanItem(null);
              loadPlan();
              request<BudgetVariance>(`/budget-variance?year=${year}&month=${selectedMonth}`).then(setVariance);
            }}
            cancel={() => { setShowPlanForm(false); setEditingPlanItem(null); }}
          />
        )}
        <div className="plan-item-list">
          {items
            .filter((item) => item.month === selectedMonth)
            .map((item) => (
              <div key={item.id}>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {
                      (
                        {
                          income: "Ingreso",
                          expense: "Gasto",
                          saving: "Ahorro",
                          investment: "Inversión",
                        } as any
                      )[item.kind]
                    }{" "}
                    · {item.currency} · {item.owner}
                    {item.category_id ? ` · ${categories.find(category => category.id === item.category_id)?.name || "Categoría"}` : " · Sin categoría"}
                    {item.account_id ? ` · ${accounts.find(account => account.id === item.account_id)?.name || "Cuenta"}` : ""}
                    {item.maximum_amount ? ` · Máx. ${money(item.maximum_amount,item.currency)}` : ""}
                    {item.irregular ? " · Gasto irregular" : ""}
                  </small>
                </span>
                <strong className="plan-item-amount">
                  {money(item.amount, item.currency)}
                </strong>
                <button
                  className="ghost icon-danger"
                  onClick={() => { setEditingPlanItem(item); setShowPlanForm(true); }}
                  aria-label={`Editar criterios de ${item.name}`}
                >
                  <Pencil />
                </button>
                <button
                  className="danger icon-danger"
                  onClick={() => removeItem(item)}
                  aria-label={`Eliminar ${item.name}`}
                >
                  <Trash2 />
                </button>
              </div>
            ))}
        </div>
      </section>}
      <section className="panel variance-panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">PRESUPUESTO VS. REAL</p>
            <h3>¿Cómo cerró el mes?</h3>
          </div>
          <select
            className="month-select"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
          >
            {monthNames.map((name, index) => (
              <option value={index + 1} key={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {variance?.rows.length ? (
          <div className="variance-table">
            <div className="variance-head">
              <span>Categoría</span>
              <span>Proyectado</span>
              <span>Real / máximo</span>
              <span>Variación</span>
            </div>
            {variance.rows.map((row) => (
              <div key={`${row.planned_item_id || row.category_id}-${row.currency}-${row.owner}`}>
                <span>
                  <i className={row.essential ? "essential" : "optional"} />
                  <b>{row.category}</b>
                  <small>
                    {row.matched_category || row.parent || "Sin presupuesto"} · {row.currency}
                    {row.account_name ? ` · ${row.account_name}` : row.owner !== "household" ? ` · ${row.owner}` : ""}
                  </small>
                </span>
                <span>{money(row.projected, row.currency)}</span>
                <span>{money(row.actual, row.currency)}{row.maximum&&<small>Máx. {money(row.maximum,row.currency)}</small>}</span>
                <span className={row.status === "over" || row.status === "over_max" ? "over" : "under"}>
                  {Number(row.variance) > 0 ? "+" : ""}
                  {money(row.variance, row.currency)}
                  <small>
                    {row.percentage_used
                      ? `${Math.round(Number(row.percentage_used))}% usado`
                      : "Sin presupuesto"}
                    {row.irregular ? ` · Reservá ${money(row.monthly_reserve,row.currency)}/mes` : ""}
                  </small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="Categorizá movimientos para comparar lo real con el plan" />
        )}
      </section>
    </>
  );
}

function AnnualVariancePanel({
  data,
  editing,
  onEdit,
}: {
  data: AnnualBudgetVariance;
  editing: boolean;
  onEdit: () => void;
}) {
  const cad = data.totals.CAD || {
    projected: "0",
    actual: "0",
    variance: "0",
    percentage_used: null,
  };
  const percentage = cad.percentage_used ? Number(cad.percentage_used) : 0;
  const dated = data.as_of
    ? new Date(data.as_of + "T12:00:00").toLocaleDateString(appLocale(), {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "sin movimientos todavía";
  return (
    <section className="panel annual-variance">
      <div className="panel-title">
        <div>
          <p className="eyebrow">PRESUPUESTO VS. REAL</p>
          <h3>¿Cómo va el año?</h3>
        </div>
        <div className="annual-variance-actions">
          <span>Al {dated}</span>
          <button
            type="button"
            className={`icon-button${editing ? " active" : ""}`}
            onClick={onEdit}
            aria-label={editing ? "Cerrar edición del presupuesto" : "Editar presupuesto"}
            title={editing ? "Cerrar edición" : "Editar presupuesto"}
          >
            <Pencil />
          </button>
        </div>
      </div>
      <div className="annual-budget-summary">
        <div>
          <small>Proyectado anual</small>
          <strong>{money(cad.projected)}</strong>
        </div>
        <div>
          <small>Real a la fecha</small>
          <strong>{money(cad.actual)}</strong>
        </div>
        <div>
          <small>Presupuesto usado</small>
          <strong>{Math.round(percentage)}%</strong>
        </div>
      </div>
      <div className="progress annual-progress">
        <i
          className={percentage > 100 ? "over-budget" : ""}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
      <div className="annual-category-list">
        {data.rows
          .filter((row) => row.currency === "CAD" && Number(row.projected) > 0)
          .map((row) => {
            const used = row.percentage_used ? Number(row.percentage_used) : 0;
            return (
              <div key={`${row.planned_item_id || row.category_id}-${row.category}-${row.owner}`}>
                <span>
                  <strong>{row.category}</strong>
                  <small>
                    {money(row.actual)} de {money(row.projected)}
                    {row.account_name ? ` · ${row.account_name}` : row.owner !== "household" ? ` · ${row.owner}` : ""}
                  </small>
                </span>
                <div className="category-progress">
                  <i
                    className={used > 100 ? "over-budget" : ""}
                    style={{ width: `${Math.min(100, used)}%` }}
                  />
                </div>
                <b className={used > 100 ? "over" : ""}>{Math.round(used)}%</b>
              </div>
            );
          })}
      </div>
    </section>
  );
}

function PlannedItemForm({
  year,
  month,
  item,
  accounts,
  categories,
  done,
  cancel,
}: {
  year: number;
  month: number;
  item?: PlannedItem;
  accounts: Account[];
  categories: Category[];
  done: () => void;
  cancel: () => void;
}) {
  const [error, setError] = useState(""),
    [kind, setKind] = useState(item?.kind || "expense");
  const selectableCategories = categories.filter(
    (category) =>
      !categories.some((child) => child.parent_id === category.id) &&
      (kind === "income"
        ? category.is_income
        : kind === "expense"
          ? !category.is_income
          : true),
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget), data: any = Object.fromEntries(form);
    data.category_id = data.category_id || null;
    data.account_id = data.account_id || null;
    data.annual_paid = form.get("annual_paid") === "on";
    data.irregular = form.get("irregular") === "on";
    data.maximum_amount = data.maximum_amount || null;
    try {
      await request(item ? `/planned-items/${item.id}` : "/planned-items", {
        method: item ? "PATCH" : "POST",
        body: JSON.stringify({ ...data, year, month }),
      });
      done();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  return (
    <form className="inline-editor planned-item-form" onSubmit={submit}>
      <label>
        Concepto
        <input name="name" defaultValue={item?.name} required placeholder="Internet" />
      </label>
      <label>
        Tipo
        <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as PlannedItem["kind"])}>
          <option value="expense">Gasto</option>
          <option value="income">Ingreso</option>
          <option value="saving">Ahorro</option>
          <option value="investment">Inversión</option>
        </select>
      </label>
      <label>
        Monto
        <input name="amount" type="number" step="0.01" defaultValue={item ? Number(item.amount).toFixed(2) : ""} required />
      </label>
      <label>
        Máximo tolerable (opcional)
        <input name="maximum_amount" type="number" step="0.01" min="0" defaultValue={item?.maximum_amount ? Number(item.maximum_amount).toFixed(2) : ""} placeholder="Por ejemplo, 75.00" />
      </label>
      <label>
        Moneda
        <select name="currency" defaultValue={item?.currency || "CAD"}>
          <option>CAD</option>
          <option>USD</option>
          <option>UYU</option>
        </select>
      </label>
      <label>
        Propietario
        <select name="owner" defaultValue={item?.owner || "household"}>
          <option value="household">Hogar</option>
          <option value="person_a">Person A</option>
          <option value="person_b">Person B</option>
          <option value="joint">Conjunta</option>
        </select>
      </label>
      <label>
        Categoría {kind === "expense" || kind === "income" ? "(obligatoria)" : "(opcional)"}
        <select name="category_id" defaultValue={item?.category_id || ""} required={kind === "expense" || kind === "income"} key={`${item?.id || "new"}-${kind}`}>
          <option value="">Sin categoría</option>
          {selectableCategories.map((category) => (
            <option value={category.id} key={category.id}>{category.name}</option>
          ))}
        </select>
      </label>
      <label>
        Cuenta específica (opcional)
        <select name="account_id" defaultValue={item?.account_id || ""}>
          <option value="">Todas según persona</option>
          {accounts.map((account) => (
            <option value={account.id} key={account.id}>{account.name} · {account.currency}</option>
          ))}
        </select>
        <small>Si elegís una cuenta, tiene prioridad sobre Persona.</small>
      </label>
      <label className="checkbox-row">
        <input name="annual_paid" type="checkbox" defaultChecked={item?.annual_paid || false} />
        Pagado anualmente
      </label>
      <label className="checkbox-row">
        <input name="irregular" type="checkbox" defaultChecked={item?.irregular || false} />
        Gasto irregular anual (mostrar reserva mensual sugerida)
      </label>
      <p className="form-note plan-scope-note">
        Para Presupuesto vs. real se usa categoría + tipo + moneda. Cuenta restringe a una cuenta exacta; si queda vacía, Person A, Person B o Conjunta filtran por propietario. Hogar incluye todas.
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="ghost" onClick={cancel}>Cancelar</button>
        <button className="primary">{item ? "Guardar cambios" : "Guardar"}</button>
      </div>
    </form>
  );
}

function GoalForm({
  goal,
  done,
  cancel,
}: {
  goal?: Goal;
  done: () => void;
  cancel: () => void;
}) {
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data: any = Object.fromEntries(new FormData(e.currentTarget));
    if (!data.target_amount) data.target_amount = null;
    if (!data.target_date) data.target_date = null;
    try {
      await request(goal ? `/goals/${goal.id}` : "/goals", {
        method: goal ? "PATCH" : "POST",
        body: JSON.stringify({ ...data, active: true }),
      });
      done();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  async function remove() {
    if (!goal || !window.confirm(`¿Eliminar el objetivo ${goal.name}?`)) return;
    try {
      await request(`/goals/${goal.id}`, { method: "DELETE" });
      done();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  return (
    <form className="goal-form" onSubmit={submit}>
      <label>
        Objetivo
        <input name="name" defaultValue={goal?.name} required />
      </label>
      <div className="form-row">
        <label>
          Meta
          <input
            name="target_amount"
            type="number"
            step="0.01"
            defaultValue={
              goal?.target_amount ? Number(goal.target_amount).toFixed(2) : ""
            }
          />
        </label>
        <label>
          Acumulado
          <input
            name="current_amount"
            type="number"
            step="0.01"
            defaultValue={
              goal ? Number(goal.current_amount).toFixed(2) : "0.00"
            }
            required
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Aporte mensual
          <input
            name="monthly_contribution"
            type="number"
            step="0.01"
            defaultValue={
              goal ? Number(goal.monthly_contribution).toFixed(2) : "0.00"
            }
            required
          />
        </label>
        <label>
          Fecha objetivo
          <input
            name="target_date"
            type="date"
            defaultValue={goal?.target_date || ""}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Moneda
          <select name="currency" defaultValue={goal?.currency || "CAD"}>
            <option>CAD</option>
            <option>USD</option>
            <option>UYU</option>
          </select>
        </label>
        <label>
          Propietario
          <select name="owner" defaultValue={goal?.owner || "household"}>
            <option value="household">Hogar</option>
            <option value="person_a">Person A</option>
            <option value="person_b">Person B</option>
            <option value="joint">Conjunta</option>
          </select>
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        {goal && (
          <button type="button" className="danger" onClick={remove}>
            <Trash2 />
            Eliminar
          </button>
        )}
        <button type="button" className="ghost" onClick={cancel}>
          Cancelar
        </button>
        <button className="primary submit">Guardar</button>
      </div>
    </form>
  );
}

function RulesPage({ categories, accounts }: { categories: Category[]; accounts: Account[] }) {
  const [rules, setRules] = useState<CategorizationRule[]>([]),
    [editing, setEditing] = useState<
      CategorizationRule | null | undefined
    >(undefined),
    [error, setError] = useState("");
  const load = () =>
    request<CategorizationRule[]>("/rules")
      .then(setRules)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const categoryName = (id: string) =>
    categories.find((category) => category.id === id)?.name ||
    "Categoría eliminada";
  const operatorName = (operator: CategorizationRule["operator"]) =>
    operator === "starts_with"
      ? "Empieza con"
      : operator === "equals"
        ? "Es igual a"
        : "Contiene";
  return (
    <section className="rules-page">
      {error && <div className="error">{error}</div>}
      <article className="panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">AUTOMATIZACIÓN</p>
            <h3>Reglas de categorización</h3>
          </div>
          <button className="primary compact" onClick={() => setEditing(null)}>
            <Plus /> Nueva regla
          </button>
        </div>
        <p className="panel-help">
          Se aplican durante las importaciones según la prioridad. Un número
          menor se evalúa primero.
        </p>
        {editing !== undefined && (
          <RuleForm
            rule={editing || undefined}
            categories={categories}
            accounts={accounts}
            done={() => {
              setEditing(undefined);
              load();
            }}
            cancel={() => setEditing(undefined)}
          />
        )}
        {rules.length ? (
          <div className="rule-list">
            {rules.map((rule) => (
              <button
                type="button"
                className={`rule-editable ${rule.active ? "" : "inactive"}`}
                key={rule.id}
                onClick={() => setEditing(rule)}
              >
                <span className="rule-priority">{rule.priority}</span>
                <div>
                  <strong>{rule.name}</strong>
                  <small>
                    {operatorName(rule.operator)} “{rule.value}” → {categoryName(rule.category_id)}
                    {rule.amount!==null?` · monto ${money(rule.amount,rule.currency||"CAD")}`:""}
                    {rule.account_id?` · ${accounts.find(account=>account.id===rule.account_id)?.name||"Cuenta"}`:""}
                  </small>
                </div>
                <em>{rule.active ? "Activa" : "Inactiva"}</em>
                <Pencil />
              </button>
            ))}
          </div>
        ) : (
          <Empty text="Todavía no hay reglas" action={() => setEditing(null)} />
        )}
      </article>
    </section>
  );
}

function RuleForm({
  rule,
  categories,
  accounts,
  done,
  cancel,
}: {
  rule?: CategorizationRule;
  categories: Category[];
  accounts: Account[];
  done: () => void;
  cancel: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const selectable = categories.filter(
    (category) =>
      !categories.some((child) => child.parent_id === category.id),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget),
      data = Object.fromEntries(form) as any;
    data.priority = Number(data.priority);
    data.active = form.get("active") === "on";
    data.amount = data.amount === "" ? null : Number(data.amount);
    data.currency = data.currency || null;
    data.account_id = data.account_id || null;
    data.transaction_kind = data.transaction_kind || null;
    try {
      await request(rule ? `/rules/${rule.id}` : "/rules", {
        method: rule ? "PATCH" : "POST",
        body: JSON.stringify(data),
      });
      done();
    } catch (x) {
      setError((x as Error).message);
      setBusy(false);
    }
  }
  async function remove() {
    if (!rule || !window.confirm(`¿Eliminar la regla ${rule.name}?`)) return;
    setBusy(true);
    try {
      await request(`/rules/${rule.id}`, { method: "DELETE" });
      done();
    } catch (x) {
      setError((x as Error).message);
      setBusy(false);
    }
  }
  return (
    <form className="rule-form" onSubmit={submit}>
      <label>
        Nombre
        <input name="name" defaultValue={rule?.name} required />
      </label>
      <div className="form-row">
        <label>
          Buscar en
          <select name="field" defaultValue={rule?.field || "description"}>
            <option value="description">Descripción</option>
            <option value="payee">Comercio</option>
          </select>
        </label>
        <label>
          Condición
          <select name="operator" defaultValue={rule?.operator || "contains"}>
            <option value="starts_with">Empieza con</option>
            <option value="contains">Contiene</option>
            <option value="equals">Es igual a</option>
          </select>
        </label>
      </div>
      <p className="form-note">Condiciones opcionales: si las completás, deben coincidir junto con el texto.</p>
      <div className="form-row">
        <label>Monto exacto<input name="amount" type="number" step="0.01" defaultValue={rule?.amount??""} placeholder="Ej.: -5.07" /></label>
        <label>Moneda<select name="currency" defaultValue={rule?.currency||""}><option value="">Cualquiera</option><option>CAD</option><option>USD</option><option>UYU</option></select></label>
      </div>
      <div className="form-row">
        <label>Cuenta<select name="account_id" defaultValue={rule?.account_id||""}><option value="">Cualquier cuenta</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label>Tipo<select name="transaction_kind" defaultValue={rule?.transaction_kind||""}><option value="">Cualquier tipo</option><option value="expense">Gasto</option><option value="income">Ingreso</option></select></label>
      </div>
      <label>
        Texto a reconocer
        <input name="value" defaultValue={rule?.value} required />
      </label>
      <div className="form-row">
        <label>
          Categoría
          <select name="category_id" defaultValue={rule?.category_id} required>
            <option value="">Elegí una categoría</option>
            {selectable.map((category) => (
              <option value={category.id} key={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prioridad
          <input
            name="priority"
            type="number"
            min="1"
            defaultValue={rule?.priority || 100}
            required
          />
        </label>
      </div>
      <label className="checkbox-row">
        <input name="active" type="checkbox" defaultChecked={rule?.active ?? true} />
        Regla activa
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        {rule && (
          <button type="button" className="danger" onClick={remove} disabled={busy}>
            <Trash2 /> Eliminar
          </button>
        )}
        <button type="button" className="ghost" onClick={cancel} disabled={busy}>
          Cancelar
        </button>
        <button className="primary submit" disabled={busy}>Guardar</button>
      </div>
    </form>
  );
}

function LineChart({points,label}:{points:{label:string;value:number}[];label:string}) {
  if(points.length<2)return <Empty text="Todavía no hay suficientes puntos para dibujar la evolución"/>;
  const width=760,height=190,pad=18,min=Math.min(...points.map(p=>p.value)),max=Math.max(...points.map(p=>p.value)),range=max-min||1;
  const coords=points.map((point,index)=>({x:pad+index*(width-pad*2)/(points.length-1),y:height-pad-(point.value-min)*(height-pad*2)/range,...point}));
  return <div className="line-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none"><defs><linearGradient id={`fill-${label.replace(/\W/g,"")}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7ebc5a" stopOpacity=".35"/><stop offset="1" stopColor="#7ebc5a" stopOpacity="0"/></linearGradient></defs><path className="chart-area" fill={`url(#fill-${label.replace(/\W/g,"")})`} d={`M ${coords[0].x} ${height-pad} L ${coords.map(p=>`${p.x} ${p.y}`).join(" L ")} L ${coords.at(-1)!.x} ${height-pad} Z`}/><polyline points={coords.map(p=>`${p.x},${p.y}`).join(" ")} fill="none"/><circle cx={coords.at(-1)!.x} cy={coords.at(-1)!.y} r="4"/></svg><div className="chart-axis"><span>{points[0].label}</span><b>{money(points.at(-1)!.value)}</b><span>{points.at(-1)!.label}</span></div></div>;
}

function InsightsPage() {
  const [scope,setScope]=useState("household"),[data,setData]=useState<InsightsType|null>(null),[settings,setSettings]=useState<HouseholdSettings|null>(null),[days,setDays]=useState(90),[error,setError]=useState(""),[editingSettings,setEditingSettings]=useState(false),[editingTargets,setEditingTargets]=useState(false),[showAllPositions,setShowAllPositions]=useState(false);
  const [shock,setShock]=useState(-20),[years,setYears]=useState(10),[annualReturn,setAnnualReturn]=useState(5),[monthlyInvest,setMonthlyInvest]=useState(0),[mortgagePrepay,setMortgagePrepay]=useState(0),[mortgageRate,setMortgageRate]=useState(4.5);
  const loadInsights=()=>Promise.all([request<InsightsType>(`/insights?scope=${scope}&days=${days}`),request<HouseholdSettings>("/household-settings")]).then(([insights,config])=>{setData(insights);setSettings(config);setError("");}).catch((e)=>setError(e.message));
  useEffect(()=>{loadInsights();},[scope,days]);
  async function saveSettings(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);try{await request("/household-settings",{method:"PATCH",body:JSON.stringify({joint_person_a_share:Number(form.get("joint_share"))/100,emergency_fund_target_cad:Number(form.get("emergency_fund")),benchmark_symbol:String(form.get("benchmark"))})});setEditingSettings(false);await loadInsights();}catch(e){setError((e as Error).message);}}
  async function saveTargets(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);try{await request("/investment-targets",{method:"PUT",body:JSON.stringify({portfolio_key:scope,targets:{equity:Number(form.get("equity")),fixed_income:Number(form.get("fixed_income")),cash:Number(form.get("cash"))}})});setEditingTargets(false);await loadInsights();}catch(e){setError((e as Error).message);}}
  if(!data||!settings)return <div className="loading">Calculando tu panorama…</div>;
  const assetLabels:Record<string,string>={equity:"Acciones",fixed_income:"Renta fija",cash:"Efectivo",bond:"Bonos"},ownerLabels:Record<string,string>={person_a:"Person A",person_b:"Person B",joint:"Conjuntas",children:"Hijos"};
  const nonZero=data.forecast.rows.filter(row=>Number(row.change)!==0).slice(0,12),end=Number(data.forecast.rows.at(-1)?.balance||data.forecast.starting_balance);
  const historyPoints=data.net_worth_history.map(row=>({label:new Date(row.date+"T12:00:00").toLocaleDateString(appLocale(),{day:"numeric",month:"short"}),value:Number(row.total_cad)}));
  const forecastPoints=data.forecast.rows.filter((_,index)=>index%Math.max(1,Math.floor(data.forecast.rows.length/30))===0||index===data.forecast.rows.length-1).map(row=>({label:new Date(row.date+"T12:00:00").toLocaleDateString(appLocale(),{day:"numeric",month:"short"}),value:Number(row.balance)}));
  const visiblePositions=data.performance.positions.filter(row=>Number(row.value_cad)!==0||Number(row.cost_cad)!==0),displayedPositions=showAllPositions?visiblePositions:visiblePositions.slice(0,8);
  const monthlyRate=annualReturn/100/12,months=years*12,baseInvestments=Number(data.summary.investments),futureExisting=baseInvestments*Math.pow(1+annualReturn/100,years),futureContributions=monthlyRate?monthlyInvest*(Math.pow(1+monthlyRate,months)-1)/monthlyRate:monthlyInvest*months;
  const simulated={shockValue:Number(data.summary.cash)+baseInvestments*(1+shock/100)-Number(data.summary.debts),futurePortfolio:futureExisting+futureContributions,cashAfterPrepay:Number(data.summary.cash)-mortgagePrepay,debtAfterPrepay:Math.max(0,Number(data.summary.debts)-mortgagePrepay),firstYearInterest:mortgagePrepay*mortgageRate/100};
  return <section className="insights-page">
    {error&&<div className="error">{error}</div>}
    <div className="data-status"><span><i className="ok"/>Patrimonio: {data.freshness.snapshot}</span><span><i className="ok"/>Mercados: {data.freshness.market_prices||"sin datos"}</span><span><i className="ok"/>Cambio: {data.freshness.exchange_rates||"sin datos"}</span><span><i className={data.freshness.pending_scheduled?"pending":"ok"}/>{data.freshness.pending_scheduled} programados pendientes</span></div>
    <div className="insights-toolbar panel"><div><p className="eyebrow">VISTA PATRIMONIAL</p><h3>Panorama y decisiones</h3></div><select value={scope} onChange={e=>setScope(e.target.value)}><option value="household">Hogar completo</option><option value="person_a">Person A</option><option value="person_b">Person B</option><option value="joint">Solo conjuntas</option><option value="children">Hijos / RESP</option></select><button className="ghost compact" onClick={()=>setEditingSettings(v=>!v)}><Pencil/>Supuestos</button></div>
    {editingSettings&&<form className="panel insight-settings" onSubmit={saveSettings}><label>Parte conjunta de Person A (%)<input name="joint_share" type="number" min="0" max="100" defaultValue={Number(settings.joint_person_a_share)*100}/></label><label>Fondo de emergencia protegido<input name="emergency_fund" type="number" min="0" step="100" defaultValue={settings.emergency_fund_target_cad}/></label><label>Benchmark<input name="benchmark" defaultValue={settings.benchmark_symbol}/></label><button className="primary">Guardar supuestos</button></form>}
    <div className="insights-kpis"><article className="accent"><small>Disponible para gastar</small><strong>{money(data.available_to_spend.amount)}</strong><span>Después de compromisos y reservas</span></article><article><small>Patrimonio neto</small><strong>{money(data.summary.net_worth)}</strong><span>Activos menos deudas</span></article><article><small>Caja en {days} días</small><strong>{money(end)}</strong><span>Mínimo: {money(data.forecast.minimum_balance)}</span></article><article><small>Retorno total registrado</small><strong className={Number(data.performance.total_return_cad)>=0?"gain":"loss"}>{money(data.performance.total_return_cad)}</strong><span>{data.performance.return_pct?`${Number(data.performance.return_pct).toFixed(1)}% sobre costo`:"Sin costo suficiente"}</span></article></div>
    <article className="panel spendable-panel"><div className="panel-title"><div><p className="eyebrow">DISPONIBLE PARA GASTAR</p><h3>De dónde sale</h3></div></div><div className="spendable-formula"><span><small>Caja líquida</small><b>{money(data.available_to_spend.liquid)}</b></span><em>−</em><span><small>Hasta próximo ingreso ({data.available_to_spend.until})</small><b>{money(data.available_to_spend.committed_outflows)}</b></span><em>−</em><span><small>Reserva irregular mensual</small><b>{money(data.available_to_spend.irregular_reserve)}</b></span><em>−</em><span><small>Emergencia protegida</small><b>{money(data.available_to_spend.emergency_fund)}</b></span><em>=</em><span className="result"><small>Disponible</small><b>{money(data.available_to_spend.amount)}</b></span></div></article>
    <div className="insights-grid">
      <article className="panel history-panel"><div className="panel-title"><div><p className="eyebrow">EVOLUCIÓN PATRIMONIAL</p><h3>Patrimonio neto en el tiempo</h3></div></div><LineChart points={historyPoints} label="Patrimonio neto"/><div className="chart-legend"><span><i className="cash"/>Caja {money(data.summary.cash)}</span><span><i className="investments"/>Inversiones {money(data.summary.investments)}</span><span><i className="debts"/>Deudas {money(data.summary.debts)}</span></div></article>
      <article className="panel forecast-panel"><div className="panel-title"><div><p className="eyebrow">LÍNEA TEMPORAL</p><h3>Cómo se mueve la caja</h3></div><select value={days} onChange={e=>setDays(Number(e.target.value))}><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option><option value={180}>180 días</option></select></div><LineChart points={forecastPoints} label="Caja proyectada"/>{nonZero.length?<div className="forecast-list compact-list">{nonZero.map(row=><div key={row.date}><span>{new Date(row.date+"T12:00:00").toLocaleDateString(appLocale(),{day:"numeric",month:"short"})}</span><b className={Number(row.change)>=0?"gain":"loss"}>{Number(row.change)>=0?"+":""}{money(row.change)}</b><small>{money(row.balance)}</small></div>)}</div>:<Empty text="No hay movimientos programados en este período"/>}</article>
      <article className="panel allocation-panel"><div className="panel-title"><div><p className="eyebrow">ASIGNACIÓN Y REBALANCEO</p><h3>Objetivo vs. actual</h3></div><button className="ghost compact" onClick={()=>setEditingTargets(v=>!v)}><Pencil/>Objetivos</button></div>{editingTargets&&<form className="target-form" onSubmit={saveTargets}>{["equity","fixed_income","cash"].map(key=><label key={key}>{assetLabels[key]}<input name={key} type="number" min="0" max="100" step="1" defaultValue={Number(data.investment_targets[key]||0)}/><span>%</span></label>)}<button className="primary compact">Guardar</button></form>}{data.rebalance.length?<div className="rebalance-table"><div><b>Activo</b><b>Actual</b><b>Objetivo</b><b>Comprar con efectivo</b></div>{data.rebalance.map(row=><div key={row.asset_class}><strong>{assetLabels[row.asset_class]||row.asset_class}</strong><span>{Number(row.current_pct).toFixed(1)}%</span><span>{Number(row.target_pct).toFixed(1)}%</span><b className={Number(row.buy_with_cash)>0?"gain":""}>{money(row.buy_with_cash)}</b></div>)}</div>:<Empty text="Definí objetivos que sumen 100% para recibir recomendaciones"/>}<p className="panel-help">MAPI usa únicamente el efectivo que excede tu objetivo de caja. No recomienda ventas ni considera impuestos.</p></article>
      <article className="panel performance-panel"><div className="panel-title"><div><p className="eyebrow">RENDIMIENTO</p><h3>Precio, ingresos y benchmark</h3></div>{visiblePositions.length>8&&<button className="ghost compact" onClick={()=>setShowAllPositions(value=>!value)}>{showAllPositions?"Ver resumen":`Ver las ${visiblePositions.length} posiciones`}</button>}</div><div className="return-summary"><span><small>Ganancia por precio</small><b>{money(data.performance.gain_cad)}</b></span><span><small>Dividendos/intereses registrados</small><b>{money(data.performance.income_cad)}</b></span><span><small>Retorno total</small><b>{money(data.performance.total_return_cad)}</b></span><span><small>XIRR personal</small><b>{data.performance.xirr_pct?`${Number(data.performance.xirr_pct).toFixed(1)}%`:"Faltan aportes históricos"}</b></span><span><small>{data.performance.benchmark.symbol}</small><b>{data.performance.benchmark.return_pct?`${Number(data.performance.benchmark.return_pct).toFixed(1)}%`:"Sin historia suficiente"}</b></span></div><div className="performance-list">{displayedPositions.map(row=><div key={`${row.account}-${row.symbol}`}><span><strong>{row.symbol}</strong><small>{row.account} · {assetLabels[row.asset_class]||row.asset_class}</small></span><span><small>Valor</small>{money(row.value_cad)}</span><span><small>Ganancia</small><b className={Number(row.gain_cad)>=0?"gain":"loss"}>{money(row.gain_cad)}</b></span><span><small>Retorno</small>{row.return_pct?`${Number(row.return_pct).toFixed(1)}%`:"—"}</span></div>)}</div><p className="panel-help">{data.performance.method} XIRR se habilita cuando existen transferencias históricas hacia o desde inversiones. Los dividendos sólo aparecen cuando están registrados como ingresos.</p></article>
      <article className="panel simulator-panel"><div className="panel-title"><div><p className="eyebrow">¿QUÉ PASA SI…?</p><h3>Simulador de decisiones</h3></div></div><div className="simulator-controls"><label>Caída del mercado (%)<input type="number" min="-80" max="30" value={shock} onChange={e=>setShock(Number(e.target.value))}/></label><label>Horizonte (años)<input type="number" min="1" max="40" value={years} onChange={e=>setYears(Number(e.target.value))}/></label><label>Retorno anual (%)<input type="number" min="-10" max="20" step=".5" value={annualReturn} onChange={e=>setAnnualReturn(Number(e.target.value))}/></label><label>Inversión mensual<input type="number" min="0" step="100" value={monthlyInvest} onChange={e=>setMonthlyInvest(Number(e.target.value))}/></label><label>Adelanto hipoteca<input type="number" min="0" step="1000" value={mortgagePrepay} onChange={e=>setMortgagePrepay(Number(e.target.value))}/></label><label>Tasa hipotecaria (%)<input type="number" min="0" max="20" step=".1" value={mortgageRate} onChange={e=>setMortgageRate(Number(e.target.value))}/></label></div><div className="simulation-results"><span><small>Patrimonio tras caída</small><b>{money(simulated.shockValue)}</b></span><span><small>Portafolio en {years} años</small><b>{money(simulated.futurePortfolio)}</b></span><span><small>Caja tras adelanto</small><b className={simulated.cashAfterPrepay<0?"loss":""}>{money(simulated.cashAfterPrepay)}</b></span><span><small>Interés evitado primer año</small><b>{money(simulated.firstYearInterest)}</b></span></div><p className="panel-help">Escenario simplificado en CAD, antes de impuestos y comisiones. No modifica tus datos.</p></article>
    </div>
  </section>;
}

function AttentionPanel({data,onNavigate}:{data:AttentionCenterType|null;onNavigate:(alert:AttentionCenterType["alerts"][number])=>void}) {
  if (!data) return <section className="attention-panel panel"><div className="loading">Revisando tus datos…</div></section>;
  const clear=data.alerts.length===0;
  return <section className={`attention-panel ${clear?"clear":""}`}>
    <div className="attention-heading">
      <div className="attention-score"><span>{data.health_score}</span><small>salud de datos</small></div>
      <div><p className="eyebrow">CENTRO DE ATENCIÓN</p><h2>{clear?"Todo está en orden":"Hay cosas para revisar"}</h2><p>{clear?"No encontramos tareas pendientes importantes.":"MAPI ordenó primero lo que más puede afectar tus números."}</p></div>
    </div>
    {clear?<div className="all-clear"><CheckCircle2/><span><strong>Estás al día</strong><small>Podés seguir con tu planificación normalmente.</small></span></div>:
    <div className="attention-list">{data.alerts.slice(0,6).map((alert)=><button key={alert.type} className={alert.severity} onClick={()=>onNavigate(alert)}>
      <span className="attention-icon">{alert.severity==="critical"?<AlertTriangle/>:alert.severity==="warning"?<AlertTriangle/>:<CalendarDays/>}</span>
      <span><strong>{alert.title}</strong><small>{alert.detail}</small></span><ChevronRight/>
    </button>)}</div>}
  </section>;
}

function ScheduledPage({accounts, categories, onConfirmed}: {accounts: Account[]; categories: Category[]; onConfirmed: () => void}) {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth),
    [calendar, setCalendar] = useState<RecurringCalendar | null>(null),
    [recurring, setRecurring] = useState<RecurringTransaction[]>([]),
    [editing, setEditing] = useState<RecurringTransaction | null | undefined>(undefined),
    [selectedDay, setSelectedDay] = useState<string | null>(null),
    [error, setError] = useState("");
  const loadScheduled = async () => {
    try {
      const [cal, rules] = await Promise.all([
        request<RecurringCalendar>(`/recurring/calendar?month=${selectedMonth}`),
        request<RecurringTransaction[]>("/recurring"),
      ]);
      setCalendar(cal); setRecurring(rules); setError("");
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { loadScheduled(); }, [selectedMonth]);
  const resolve = async (occurrence: RecurringOccurrence, action: "confirm"|"skip", transactionId?: string) => {
    try {
      await request(`/recurring/occurrences/${occurrence.id}/${action}`, {
        method: "POST", body: action === "confirm" ? JSON.stringify({transaction_id: transactionId || null}) : undefined,
      });
      await loadScheduled(); if (action === "confirm") onConfirmed();
    } catch (e) { setError((e as Error).message); }
  };
  const removeRecurring = async (item: RecurringTransaction) => {
    if (!window.confirm(`¿Eliminar el programado “${item.description}”? Los movimientos ya confirmados no se eliminan.`)) return;
    try { await request(`/recurring/${item.id}`, {method:"DELETE"}); await loadScheduled(); }
    catch (e) { setError((e as Error).message); }
  };
  if (!calendar) return <div className="loading">Preparando calendario…</div>;
  const [year, monthNumber] = selectedMonth.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const todayDate = today;
  const monthOccurrences = calendar.occurrences.filter((item) => item.scheduled_date.startsWith(selectedMonth));
  const overdue = calendar.occurrences.filter((item) => item.status === "pending" && item.scheduled_date < todayDate);
  const visible = monthOccurrences.filter((item) => !selectedDay || item.scheduled_date === selectedDay);
  const pending = visible.filter((item) => item.status === "pending");
  const resolved = visible.filter((item) => item.status !== "pending");
  const frequencyLabel: Record<string,string> = {weekly:"Semanal",biweekly:"Cada 2 semanas",monthly:"Mensual",yearly:"Anual"};
  return <>
    {error && <div className="error">{error}</div>}
    <section className="scheduled-toolbar panel">
      <div><p className="eyebrow">AGENDA FINANCIERA</p><h3>Lo que debería suceder</h3><small>Los programados no afectan tus saldos hasta que los confirmás.</small></div>
      <div>
        <select className="month-select" value={selectedMonth} onChange={(e) => {setSelectedMonth(e.target.value); setSelectedDay(null);}}>
          {monthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button className="primary compact" onClick={() => setEditing(null)}><Plus /> Programado</button>
      </div>
    </section>
    <section className="scheduled-summary">
      <article><small>Ingresos pendientes</small><strong className="income">{money(calendar.pending_income)}</strong></article>
      <article><small>Gastos pendientes</small><strong className="expense">{money(calendar.pending_expenses)}</strong></article>
      <article><small>Balance previsto</small><strong>{money(Number(calendar.pending_income)-Number(calendar.pending_expenses))}</strong></article>
      <article className={overdue.length ? "warning" : ""}><small>Vencidos sin confirmar</small><strong>{overdue.length}</strong></article>
    </section>
    {editing !== undefined && <RecurringForm item={editing || undefined} accounts={accounts} categories={categories} done={() => {setEditing(undefined); loadScheduled();}} cancel={() => setEditing(undefined)} />}
    <section className="scheduled-layout">
      <article className="panel finance-calendar">
        <div className="panel-title"><div><p className="eyebrow">CALENDARIO</p><h3>{fullMonthNames[monthNumber-1]} {year}</h3></div>{selectedDay && <button className="ghost compact" onClick={() => setSelectedDay(null)}>Ver todo el mes</button>}</div>
        <div className="calendar-weekdays">{["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-days">
          {Array.from({length:firstWeekday}).map((_, index) => <span className="empty" key={`e${index}`} />)}
          {Array.from({length:days},(_,index)=>index+1).map((day) => {
            const dateValue=`${selectedMonth}-${String(day).padStart(2,"0")}`;
            const events=monthOccurrences.filter((item)=>item.scheduled_date===dateValue);
            const pendingEvents=events.filter((item)=>item.status==="pending");
            const income=pendingEvents.filter((item)=>Number(item.amount)>0).reduce((sum,item)=>sum+Number(item.amount),0);
            const expenses=pendingEvents.filter((item)=>Number(item.amount)<0).reduce((sum,item)=>sum-Math.abs(Number(item.amount)),0);
            return <button key={day} className={`${dateValue===todayDate?"today ":""}${selectedDay===dateValue?"selected":""}`} onClick={()=>events.length&&setSelectedDay(dateValue)} disabled={!events.length}>
              <b>{day}</b><span className="calendar-dots">{events.slice(0,5).map((item)=><i key={item.id} className={item.status==="confirmed"?"confirmed":item.status==="skipped"?"skipped":item.scheduled_date<todayDate?"overdue":Number(item.amount)>0?"income":"expense"}/>)}</span>
              {income>0&&<small className="income">+{Math.round(income)}</small>}{expenses<0&&<small className="expense">{Math.round(expenses)}</small>}
            </button>;
          })}
        </div>
        <div className="calendar-legend"><span><i className="income"/>Ingreso</span><span><i className="expense"/>Gasto</span><span><i className="overdue"/>Vencido</span><span><i className="confirmed"/>Confirmado</span></div>
      </article>
      <article className="panel scheduled-rules">
        <div className="panel-title"><div><p className="eyebrow">CONFIGURACIÓN</p><h3>Recurrentes</h3></div>{recurring.length > 0 && <span>{recurring.length}</span>}</div>
        {recurring.length ? <div className="scheduled-rules-list">
          {recurring.map((item)=><div key={item.id} className={!item.active?"inactive":""}>
            <span><strong>{item.description}</strong><small>{frequencyLabel[item.frequency]} · desde {item.next_date}<br/>{accounts.find((account)=>account.id===item.account_id)?.name} · {item.category_id ? categories.find((category)=>category.id===item.category_id)?.name || "Categoría desconocida" : "Sin categoría"} · {money(item.amount,item.currency)}</small></span>
            <button className="ghost icon-danger" onClick={()=>setEditing(item)} aria-label={`Editar ${item.description}`}><Pencil/></button>
            <button className="danger icon-danger" onClick={()=>removeRecurring(item)} aria-label={`Eliminar ${item.description}`}><Trash2/></button>
          </div>)}
        </div>:<Empty text="Todavía no configuraste movimientos recurrentes" action={()=>setEditing(null)}/>}
      </article>
    </section>
    {overdue.length>0 && <ScheduledOccurrenceSection title="Vencidos" eyebrow="REQUIEREN ATENCIÓN" items={overdue} accounts={accounts} categories={categories} resolve={resolve}/>}
    <ScheduledOccurrenceSection title={selectedDay?`Movimientos del ${new Date(selectedDay+"T12:00:00").toLocaleDateString(appLocale(),{day:"numeric",month:"long"})}`:"Pendientes del mes"} eyebrow="POR CONFIRMAR" items={pending.filter((item)=>!overdue.some((old)=>old.id===item.id))} accounts={accounts} categories={categories} resolve={resolve}/>
    {resolved.length>0 && <ScheduledOccurrenceSection title="Resueltos" eyebrow="HISTORIAL DEL MES" items={resolved} accounts={accounts} categories={categories} resolve={resolve}/>}
  </>;
}

function ScheduledOccurrenceSection({title,eyebrow,items,accounts,categories,resolve}:{title:string;eyebrow:string;items:RecurringOccurrence[];accounts:Account[];categories:Category[];resolve:(item:RecurringOccurrence,action:"confirm"|"skip",transactionId?:string)=>void}) {
  return <section className="panel occurrence-section"><div className="panel-title"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div><span>{items.length}</span></div>
    {items.length ? <div className="occurrence-list">{items.map((item)=><div key={item.id} className={`${item.status} ${item.status==="pending"&&item.scheduled_date<today?"overdue":""}`}>
      <span><strong>{item.description}</strong><small>{new Date(item.scheduled_date+"T12:00:00").toLocaleDateString(appLocale(),{weekday:"short",day:"numeric",month:"short"})} · {accounts.find((account)=>account.id===item.account_id)?.name || "Cuenta"} · {categories.find((category)=>category.id===item.category_id)?.name || "Sin categoría"}</small></span>
      <b className={Number(item.amount)>0?"income":"expense"}>{money(item.amount,item.currency)}</b>
      {item.status==="pending" ? <div className="occurrence-actions">
        {item.candidates.length>0 && <div className="recurring-candidates">
          <small>Posible coincidencia{item.candidates.length>1?"s":""}</small>
          {item.candidates.slice(0,3).map((candidate)=><button className="match-button" key={candidate.id} onClick={()=>resolve(item,"confirm",candidate.id)} title="Usar este movimiento real y evitar duplicarlo"><CheckCircle2/><span><b>{candidate.description}</b><small>{candidate.date} · {money(candidate.amount,item.currency)}</small></span><em>Vincular</em></button>)}
        </div>}
        <button className="primary compact" onClick={()=>resolve(item,"confirm")}><CheckCircle2/> {item.candidates.length?"Crear igualmente":"Confirmar"}</button>
        <button className="ghost compact" onClick={()=>resolve(item,"skip")}>Omitir</button>
      </div>:<span className="resolved-label">{item.status==="confirmed"?"Confirmado":"Omitido"}</span>}
    </div>)}</div>:<Empty text="No hay movimientos en esta sección"/>}
  </section>;
}

function RecurringForm({item,accounts,categories,done,cancel}:{item?:RecurringTransaction;accounts:Account[];categories:Category[];done:()=>void;cancel:()=>void}) {
  const [kind,setKind]=useState(Number(item?.amount||-1)>=0?"income":"expense"),[error,setError]=useState("");
  const selectable=categories.filter((category)=>!categories.some((child)=>child.parent_id===category.id)&&(kind==="income"?category.is_income:!category.is_income));
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const data:any=Object.fromEntries(new FormData(e.currentTarget));const absolute=Math.abs(Number(data.amount));data.amount=kind==="expense"?-absolute:absolute;data.category_id=data.category_id||null;data.active=data.active==="on";
    try{await request(item?`/recurring/${item.id}`:"/recurring",{method:item?"PATCH":"POST",body:JSON.stringify(data)});done();}catch(x){setError((x as Error).message);}}
  return <section className="panel recurring-form-panel"><div className="panel-title"><div><p className="eyebrow">{item?"EDITAR":"NUEVO"} PROGRAMADO</p><h3>{item?item.description:"Movimiento recurrente"}</h3></div></div><form className="recurring-form" onSubmit={submit}>
    <label>Descripción<input name="description" defaultValue={item?.description} placeholder="Salario, cuota del auto…" required/></label>
    <label>Cuenta<select name="account_id" defaultValue={item?.account_id||accounts[0]?.id}>{accounts.map((account)=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
    <label>Tipo<select value={kind} onChange={(e)=>setKind(e.target.value)}><option value="income">Ingreso</option><option value="expense">Gasto</option></select></label>
    <label>Monto<input name="amount" type="number" min="0" step="0.01" defaultValue={item?Math.abs(Number(item.amount)).toFixed(2):""} required/></label>
    <label>Categoría<select name="category_id" defaultValue={item?.category_id||""}><option value="">Sin categoría</option>{selectable.map((category)=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    <label>Frecuencia<select name="frequency" defaultValue={item?.frequency||"monthly"}><option value="weekly">Semanal</option><option value="biweekly">Cada 2 semanas</option><option value="monthly">Mensual</option><option value="yearly">Anual</option></select></label>
    <label>Primera fecha<input name="next_date" type="date" defaultValue={item?.next_date||today} required/></label>
    <label>Moneda<select name="currency" defaultValue={item?.currency||"CAD"}><option>CAD</option><option>USD</option><option>UYU</option></select></label>
    <label className="checkbox-row"><input name="active" type="checkbox" defaultChecked={item?.active??true}/> Activo</label>
    {error&&<p className="form-error">{error}</p>}<div className="form-actions"><button type="button" className="ghost" onClick={cancel}>Cancelar</button><button className="primary">Guardar programado</button></div>
  </form></section>;
}

function RetirementPage() {
  const [data, setData] = useState<RetirementSnapshot | null>(null),
    [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  const load = () => request<RetirementSnapshot>("/retirement").then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data) return;
    const form = new FormData(e.currentTarget);
    const optionalMoney = (name: string) => form.get(name) ? Number(form.get(name)) : null;
    const person = (key: "person_b" | "person_a") => ({
      name: key === "person_b" ? "Person B" : "Person A",
      canada_residence_start_date: form.get(`${key}_canada_residence_start_date`) || null,
      years_outside_canada: Number(form.get(`${key}_years_outside_canada`) || 0),
      cpp_monthly_60: Number(form.get(`${key}_cpp_monthly_60`) || 0),
      cpp_monthly_65: Number(form.get(`${key}_cpp_monthly_65`) || 0),
      cpp_monthly_70: Number(form.get(`${key}_cpp_monthly_70`) || 0),
      cpp_start_age: Number(form.get(`${key}_cpp_start_age`) || 65),
      cpp_status: String(form.get(`${key}_cpp_status`) || "estimado"),
      oas_start_age: Number(form.get(`${key}_oas_start_age`) || 65),
      oas_max_monthly: Number(form.get(`${key}_oas_max_monthly`) || 751.97),
      bps_monthly: Number(form.get(`${key}_bps_monthly`) || 0),
      bps_currency: String(form.get(`${key}_bps_currency`) || "UYU"),
      bps_start_age: Number(form.get(`${key}_bps_start_age`) || 65),
      bps_status: String(form.get(`${key}_bps_status`) || "estimado"),
      employer_monthly: Number(form.get(`${key}_employer_monthly`) || 0),
      employer_currency: String(form.get(`${key}_employer_currency`) || "CAD"),
      employer_start_age: Number(form.get(`${key}_employer_start_age`) || 65),
      employer_status: String(form.get(`${key}_employer_status`) || "estimado"),
    });
    try {
      setError("");
      const updated = await request<RetirementSnapshot>("/retirement", {
        method: "PATCH",
        body: JSON.stringify({
          name: String(form.get("name")),
          person_b_birth_date: form.get("person_b_birth_date") || null,
          person_a_birth_date: form.get("person_a_birth_date") || null,
          annual_spending: optionalMoney("annual_spending"),
          annual_contribution: optionalMoney("annual_contribution"),
          passive_income: Number(form.get("passive_income") || 0),
          public_income: 0,
          public_income_start_age: 65,
          withdrawal_rate: Number(form.get("withdrawal_rate")) / 100,
          real_return: Number(form.get("real_return")) / 100,
          target_retirement_age: Number(form.get("target_retirement_age")),
          retirement_country: String(form.get("retirement_country") || "Canada"),
          estimated_tax_rate: Number(form.get("estimated_tax_rate") || 0) / 100,
          people: {person_b: person("person_b"), person_a: person("person_a")},
        }),
      });
      setData(updated); setEditing(false);
    } catch (x) { setError((x as Error).message); }
  }
  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Calculando tu camino al retiro…</div>;
  const progress = Number(data.progress);
  const incomeCoverage = Number(data.effective_spending) > 0
    ? Math.min(100, Number(data.current_sustainable_income) / Number(data.effective_spending) * 100)
    : 0;
  const base = data.scenarios.find((scenario) => scenario.label === "Base");
  return <>
    {error && <div className="error">{error}</div>}
    <section className="retirement-hero">
      <div>
        <p className="eyebrow">INDEPENDENCIA FINANCIERA · ESCENARIO BASE</p>
        <h2>{data.base_years === 0 ? "El objetivo está cubierto" : data.base_years == null ? "Más de 60 años" : `${data.base_years} años`}</h2>
        <strong>{data.base_year ? `Año estimado ${data.base_year}` : "Revisá los supuestos"}</strong>
        <p>{base?.person_b_age != null && base?.person_a_age != null ? `Person B tendría ${base.person_b_age} y Person A ${base.person_a_age} años.` : "Cargá las fechas de nacimiento para ver las edades estimadas."}</p>
      </div>
      <div className="retirement-ring" style={{"--progress": `${Math.min(100, progress) * 3.6}deg`} as CSSProperties}>
        <span><strong>{Math.round(progress)}%</strong><small>del objetivo</small></span>
      </div>
    </section>

    <section className="retirement-kpis">
      <article><small>Capital para retiro</small><strong>{money(data.portfolio)}</strong><span>Inversiones, sin RESP</span></article>
      <article><small>Número de independencia</small><strong>{money(data.fi_number)}</strong><span>Gasto menos ingresos pasivos</span></article>
      <article><small>Aporte anual</small><strong>{money(data.effective_contribution)}</strong><span>{data.profile.annual_contribution == null ? "Tomado del Presupuesto" : "Supuesto personalizado"}</span></article>
      <article><small>Gasto anual objetivo</small><strong>{money(data.effective_spending)}</strong><span>{data.profile.annual_spending == null ? "Tomado del Presupuesto" : "Supuesto personalizado"}</span></article>
    </section>

    <section className="panel retirement-income-plan">
      <div className="panel-title">
        <div><p className="eyebrow">INGRESOS POR ETAPAS</p><h3>El puente hasta los ingresos garantizados</h3></div>
        <strong>{Math.round(incomeCoverage)}% cubierto hoy</strong>
      </div>
      <div className="retirement-income-grid">
        <div><small>Ingreso sostenible hoy</small><strong>{money(data.current_sustainable_income)}/año</strong><span>Retiro del portafolio + ingresos pasivos</span></div>
        <div><small>Antes de pensiones públicas</small><strong>{money(data.required_from_portfolio)}/año</strong><span>Necesario desde el portafolio</span></div>
        <div><small>Después de todas las fuentes</small><strong>{money(data.fi_number_after_public)}</strong><span>Capital permanente estimado</span></div>
      </div>
      <div className="progress retirement-income-progress"><i style={{width:`${incomeCoverage}%`}} /></div>
      <p>La proyección incorpora cada fuente en su propia fecha. Ingreso futuro cargado: {money(data.public_income)} bruto y aproximadamente {money(data.estimated_public_income_net)} después del impuesto estimado.</p>
    </section>

    <section className="panel pension-panel">
      <div className="panel-title"><div><p className="eyebrow">INGRESOS GARANTIZADOS FUTUROS</p><h3>Qué entra, para quién y desde cuándo</h3></div><button className="ghost compact" onClick={() => setEditing(true)}>Configurar</button></div>
      {data.pension_sources.length ? <div className="pension-source-list">
        {data.pension_sources.map((source, index) => <div key={`${source.person}-${source.kind}-${index}`}>
          <span><strong>{source.person_name} · {source.label}</strong><small>{source.status} · desde los {source.start_age} ({source.start_year})</small></span>
          <span><strong>{money(source.monthly)}/mes</strong><small>{source.original_currency && source.original_currency !== "CAD" ? `${source.original_currency} ${Number(source.original_monthly || 0).toLocaleString()} · ` : ""}{money(source.annual)}/año</small></span>
        </div>)}
      </div> : <p className="empty-state">Todavía no hay CPP, OAS ni otras pensiones calculadas. Completá los datos personales para incorporarlas.</p>}
      {data.missing_retirement_data.length > 0 && <div className="retirement-missing"><strong>Información que falta</strong>{data.missing_retirement_data.map((item) => <span key={item}>• {item}</span>)}</div>}
      <div className="pension-help-grid">
        <div><strong>CPP</strong><span>Depende de aportes e ingresos laborales. Copiá los estimados de My Service Canada a los 60, 65 y 70.</span></div>
        <div><strong>OAS</strong><span>MAPI la estima con los años de residencia en Canadá después de los 18 y la edad elegida.</span></div>
        <div><strong>BPS y pensión laboral</strong><span>Son ingresos separados. RRSP, TFSA y DPSP no se cargan acá porque ya forman parte del portafolio.</span></div>
      </div>
    </section>

    <section className="retirement-grid">
      <article className="panel retirement-path">
        <div className="panel-title"><div><p className="eyebrow">TU CAMINO</p><h3>Hitos hacia la libertad financiera</h3></div></div>
        <div className="path-line">
          {data.milestones.map((item) => <div key={item.percentage} className={progress >= item.percentage ? "reached" : ""}>
            <i />
            <strong>{item.percentage}%</strong>
            <small>{item.percentage <= progress ? "Alcanzado" : item.year ? `${item.year} · en ${item.years} años` : "Más de 60 años"}</small>
          </div>)}
        </div>
        <div className="target-age-card">
          <span><small>Meta personal</small><strong>Retirarse a los {data.profile.target_retirement_age}</strong></span>
          <span>{data.target_year ? <><b>{data.target_year}</b><small>{Number(data.target_gap) > 0 ? `Faltarían ${money(data.target_gap || 0)}` : "Objetivo cubierto"}</small><small>Meta estimada: {money(data.target_capital_at_target || 0)}</small></> : <small>Requiere ambas fechas de nacimiento</small>}</span>
        </div>
      </article>

      <article className="panel retirement-scenarios">
        <div className="panel-title"><div><p className="eyebrow">ESCENARIOS</p><h3>No hay un único futuro</h3></div></div>
        {data.scenarios.map((scenario) => <div key={scenario.label} className={scenario.label === "Base" ? "base" : ""}>
          <span><strong>{scenario.label}</strong><small>Retorno real {Math.round(Number(scenario.real_return) * 100)}%</small></span>
          <span><strong>{scenario.years == null ? ">60" : scenario.years} años</strong><small>{scenario.year || "Sin alcanzar"} · meta {money(scenario.target_capital)}</small></span>
        </div>)}
      </article>
    </section>

    <section className="retirement-grid lower">
      <article className="panel">
        <div className="panel-title"><div><p className="eyebrow">PLAN DE ACCIÓN</p><h3>Próximos pasos</h3></div></div>
        <ol className="retirement-actions">{data.recommendations.map((item, index) => <li key={index}><span>{index + 1}</span>{item}</li>)}</ol>
      </article>
      <article className="panel retirement-assumptions">
        <div className="panel-title"><div><p className="eyebrow">SUPUESTOS</p><h3>Las palancas del plan</h3></div><button className="icon-button" onClick={() => setEditing((value) => !value)} aria-label="Editar supuestos"><Pencil /></button></div>
        {!editing ? <div className="assumption-list">
          <span>Retiro sostenible <b>{(Number(data.profile.withdrawal_rate) * 100).toFixed(1)}%</b></span>
          <span>Retorno real base <b>{(Number(data.profile.real_return) * 100).toFixed(1)}%</b></span>
          <span>Ingresos pasivos actuales <b>{money(data.passive_income)}/año</b></span>
          <span>Ingresos garantizados futuros <b>{money(data.public_income)}/año</b></span>
          <span>Impuesto orientativo sobre pensiones <b>{(Number(data.profile.estimated_tax_rate) * 100).toFixed(0)}%</b></span>
          <span>País previsto de retiro <b>{data.profile.retirement_country}</b></span>
          <p>Cada ingreso comienza en la edad configurada. Los RRSP, TFSA y DPSP no se suman aquí porque ya están incluidos como capital.</p>
        </div> : <form className="retirement-form" onSubmit={save}>
          <div className="retirement-guide">
            <div><strong>1 · Cuánto necesitarán</strong><span>El gasto es el estilo de vida futuro. Usá dólares de hoy y excluí ahorro, RESP y gastos que ya no existirán.</span></div>
            <div><strong>2 · Cuánto agregan ahora</strong><span>El aporte anual suma RRSP, TFSA, DPSP e inversiones para retiro. No incluye rendimiento ni transferencias propias.</span></div>
            <div><strong>3 · Qué cobrarán después</strong><span>CPP, OAS, BPS, renta y pensiones empiezan en edades distintas. Si no sabés un monto, dejalo en cero.</span></div>
          </div>
          <label>Nombre del plan<input name="name" defaultValue={data.profile.name} /></label>
          <label>Nacimiento de Person B<input type="date" name="person_b_birth_date" defaultValue={data.profile.person_b_birth_date || ""} /></label>
          <label>Nacimiento de Person A<input type="date" name="person_a_birth_date" defaultValue={data.profile.person_a_birth_date || ""} /></label>
          <label>Edad objetivo<input type="number" name="target_retirement_age" min="35" max="80" defaultValue={data.profile.target_retirement_age} /></label>
          <label>Gasto anual durante el retiro<input type="number" step="0.01" name="annual_spending" placeholder={money(data.derived_spending)} defaultValue={data.profile.annual_spending || ""} /><small>Lo que esperan gastar retirados, en CAD de hoy. Vacío: usa el Presupuesto actual ({money(data.derived_spending)}).</small></label>
          <label>Aportes anuales para el retiro<input type="number" step="0.01" name="annual_contribution" placeholder={money(data.derived_contribution)} defaultValue={data.profile.annual_contribution || ""} /><small>RRSP + TFSA + DPSP + inversiones. No incluye RESP ni crecimiento. Vacío: usa el Presupuesto ({money(data.derived_contribution)}).</small></label>
          <label>Otros ingresos anuales durante el retiro<input type="number" step="0.01" name="passive_income" defaultValue={data.profile.passive_income} /><small>Por ejemplo, renta neta de Uruguay que continuará. No incluir dividendos del portafolio.</small></label>
          <label>País previsto de retiro<input name="retirement_country" defaultValue={data.profile.retirement_country || "Canada"} /></label>
          <label>Impuesto orientativo sobre pensiones (%)<input type="number" step="1" min="0" max="60" name="estimated_tax_rate" defaultValue={Number(data.profile.estimated_tax_rate) * 100} /><small>Convierte CPP/OAS/BPS brutos en un neto aproximado. 20% es un punto de partida, no un cálculo fiscal.</small></label>
          <label>Tasa de retiro del portafolio (%)<input type="number" step="0.1" name="withdrawal_rate" min="2" max="8" defaultValue={(Number(data.profile.withdrawal_rate) * 100).toFixed(1)} /><small>Porcentaje retirado el primer año. 3.5% es prudente para un retiro largo.</small></label>
          <label>Retorno real esperado (%)<input type="number" step="0.1" name="real_return" min="-2" max="12" defaultValue={(Number(data.profile.real_return) * 100).toFixed(1)} /><small>Crecimiento después de inflación y costos. 4% es el escenario base, no una garantía.</small></label>
          {(["person_b", "person_a"] as const).map((key) => { const person = data.people[key]; return <fieldset className="retirement-person-form" key={key}>
            <legend>{person.name}</legend>
            <label>Inicio de residencia en Canadá<input type="date" name={`${key}_canada_residence_start_date`} defaultValue={person.canada_residence_start_date || ""} /><small>Para calcular la proporción de OAS</small></label>
            <label>Años completos viviendo fuera de Canadá desde la llegada<input type="number" min="0" name={`${key}_years_outside_canada`} defaultValue={person.years_outside_canada || 0} /><small>No contar vacaciones ni viajes: solo años en que el hogar habitual estuvo fuera de Canadá.</small></label>
            <div className="retirement-form-section"><strong>CPP mensual estimado</strong><span>Copiar desde My Service Canada</span></div>
            <label>A los 60<input type="number" step="0.01" min="0" name={`${key}_cpp_monthly_60`} defaultValue={person.cpp_monthly_60 || ""} /></label>
            <label>A los 65<input type="number" step="0.01" min="0" name={`${key}_cpp_monthly_65`} defaultValue={person.cpp_monthly_65 || ""} /></label>
            <label>A los 70<input type="number" step="0.01" min="0" name={`${key}_cpp_monthly_70`} defaultValue={person.cpp_monthly_70 || ""} /></label>
            <label>Empezar CPP a los<input type="number" min="60" max="70" name={`${key}_cpp_start_age`} defaultValue={person.cpp_start_age || 65} /></label>
            <label>Calidad del dato<select name={`${key}_cpp_status`} defaultValue={person.cpp_status || "estimado"}><option value="estimado">Estimado</option><option value="confirmado">Confirmado</option></select></label>
            <div className="retirement-form-section"><strong>OAS</strong><span>Calculado según residencia</span></div>
            <label>Empezar OAS a los<input type="number" min="65" max="70" name={`${key}_oas_start_age`} defaultValue={person.oas_start_age || 65} /></label>
            <label>Máximo OAS mensual<input type="number" step="0.01" min="0" name={`${key}_oas_max_monthly`} defaultValue={person.oas_max_monthly || 751.97} /><small>Actualizable cuando cambie el importe oficial</small></label>
            <div className="retirement-form-section"><strong>Otras pensiones mensuales</strong><span>No incluir RRSP, TFSA ni DPSP</span></div>
            <label>BPS Uruguay mensual<input type="number" step="0.01" min="0" name={`${key}_bps_monthly`} defaultValue={person.bps_monthly || ""} /><small>Jubilación futura estimada, no los aportes. Si no la conocés, dejar en cero.</small></label>
            <label>Moneda BPS<select name={`${key}_bps_currency`} defaultValue={person.bps_currency || "UYU"}><option>UYU</option><option>CAD</option><option>USD</option></select></label>
            <label>Inicio BPS<input type="number" min="40" max="80" name={`${key}_bps_start_age`} defaultValue={person.bps_start_age || 65} /></label>
            <label>Estado BPS<select name={`${key}_bps_status`} defaultValue={person.bps_status || "estimado"}><option value="estimado">Estimado</option><option value="confirmado">Confirmado</option></select></label>
            <label>Pensión laboral mensual<input type="number" step="0.01" min="0" name={`${key}_employer_monthly`} defaultValue={person.employer_monthly || ""} /><small>Solo una pensión garantizada del empleador. No cargar RRSP, TFSA ni DPSP.</small></label>
            <label>Moneda pensión<select name={`${key}_employer_currency`} defaultValue={person.employer_currency || "CAD"}><option>CAD</option><option>USD</option><option>UYU</option></select></label>
            <label>Inicio pensión laboral<input type="number" min="40" max="80" name={`${key}_employer_start_age`} defaultValue={person.employer_start_age || 65} /></label>
            <label>Estado pensión<select name={`${key}_employer_status`} defaultValue={person.employer_status || "estimado"}><option value="estimado">Estimado</option><option value="confirmado">Confirmado</option></select></label>
          </fieldset>})}
          <div className="form-actions"><button type="button" className="ghost" onClick={() => setEditing(false)}>Cancelar</button><button className="primary">Guardar y recalcular</button></div>
        </form>}
      </article>
    </section>
    <p className="retirement-disclaimer">Proyección educativa en dólares de hoy. Aplica una tasa orientativa a las pensiones, pero no realiza una declaración fiscal ni modela secuencia de retornos o cambios futuros de gasto. Compará los estimados individuales con la <a href="https://www.canada.ca/en/services/benefits/publicpensions/cpp/retirement-income-calculator.html" target="_blank" rel="noreferrer">calculadora oficial de Canadá</a>. Usala para explorar decisiones, no como garantía.</p>
  </>;
}

function InformationPage() {
  const [notes, setNotes] = useState<InformationNote[]>([]),
    [editing, setEditing] = useState<InformationNote | null | undefined>(
      undefined,
    ),
    [categoryFilter, setCategoryFilter] = useState(""),
    [error, setError] = useState("");
  const load = () =>
    request<InformationNote[]>("/information")
      .then(setNotes)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const categories = [...new Set(notes.map((note) => note.category))],
    visible = notes.filter(
      (note) => !categoryFilter || note.category === categoryFilter,
    );
  return (
    <section className="information-page">
      {error && <div className="error">{error}</div>}
      <article className="panel information-toolbar">
        <div>
          <p className="eyebrow">ARCHIVO PERSONAL</p>
          <h3>Información importante</h3>
        </div>
        <div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">Todos los temas</option>
            {categories.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
          <button className="primary compact" onClick={() => setEditing(null)}>
            <Plus />
            Nueva ficha
          </button>
        </div>
      </article>
      {editing !== undefined && (
        <InformationForm
          note={editing || undefined}
          done={() => {
            setEditing(undefined);
            load();
          }}
          cancel={() => setEditing(undefined)}
        />
      )}
      <div className="information-grid">
        {visible.map((note) => (
          <article className="panel information-card" key={note.id}>
            <div className="information-card-head">
              <span>{note.category}</span>
              <button className="icon-button" onClick={() => setEditing(note)}>
                <Pencil />
              </button>
            </div>
            <h3>{note.title}</h3>
            {note.summary && (
              <p className="information-summary">{note.summary}</p>
            )}
            <div className="information-content">{note.content}</div>
          </article>
        ))}
      </div>
      {!notes.length && editing === undefined && (
        <article className="panel">
          <Empty
            text="Guardá acá datos y planes que quieras conservar"
            action={() => setEditing(null)}
          />
        </article>
      )}
    </section>
  );
}

function InformationForm({
  note,
  done,
  cancel,
}: {
  note?: InformationNote;
  done: () => void;
  cancel: () => void;
}) {
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data: any = Object.fromEntries(new FormData(e.currentTarget));
    data.summary = data.summary || null;
    try {
      await request(note ? `/information/${note.id}` : "/information", {
        method: note ? "PATCH" : "POST",
        body: JSON.stringify(data),
      });
      done();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  async function remove() {
    if (!note || !window.confirm(`¿Eliminar ${note.title}?`)) return;
    try {
      await request(`/information/${note.id}`, { method: "DELETE" });
      done();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  return (
    <article className="panel information-form-panel">
      <form onSubmit={submit}>
        <div className="form-row">
          <label>
            Título
            <input
              name="title"
              defaultValue={note?.title}
              required
              placeholder="RESP — Child 1"
            />
          </label>
          <label>
            Tema
            <input
              name="category"
              defaultValue={note?.category || "General"}
              required
              placeholder="RESP, Seguros, Impuestos…"
            />
          </label>
        </div>
        <label>
          Resumen
          <input
            name="summary"
            defaultValue={note?.summary || ""}
            placeholder="Una descripción breve"
          />
        </label>
        <label>
          Información
          <textarea
            name="content"
            defaultValue={note?.content}
            rows={14}
            required
            placeholder="Fechas, montos, decisiones y notas importantes…"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          {note && (
            <button type="button" className="danger" onClick={remove}>
              <Trash2 />
              Eliminar
            </button>
          )}
          <button type="button" className="ghost" onClick={cancel}>
            Cancelar
          </button>
          <button className="primary submit">Guardar</button>
        </div>
      </form>
    </article>
  );
}

function Investments({
  year,
  accounts,
  refreshAccounts,
}: {
  year: number;
  accounts: Account[];
  refreshAccounts: () => Promise<boolean>;
}) {
  const [holdings, setHoldings] = useState<Holding[]>([]),
    [instruments, setInstruments] = useState<Instrument[]>([]),
    [rooms, setRooms] = useState<ContributionRoom[]>([]),
    [rates, setRates] = useState<any[]>([]),
    [editingHolding, setEditingHolding] = useState<Holding | null | undefined>(
      undefined,
    ),
    [editingRoom, setEditingRoom] = useState<
      ContributionRoom | null | undefined
    >(undefined),
    [showRateHistory, setShowRateHistory] = useState(false),
    [refreshingPrices, setRefreshingPrices] = useState(false),
    [error, setError] = useState("");
  const load = () =>
    Promise.all([
      request<Holding[]>("/holdings"),
      request<Instrument[]>("/instruments"),
      request<ContributionRoom[]>(`/contribution-rooms?year=${year}`),
      request<any[]>("/exchange-rates"),
    ])
      .then(([h, i, r, x]) => {
        setHoldings(h);
        setInstruments(i);
        setRooms(r);
        setRates(x);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [year]);
  async function addRate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await request("/exchange-rates", {
        method: "POST",
        body: JSON.stringify({ ...data, to_currency: "CAD" }),
      });
      (e.target as HTMLFormElement).reset();
      load();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  async function refreshPrices() {
    try {
      setRefreshingPrices(true); setError("");
      await request("/market-prices/refresh?force=true", {method:"POST"});
      await Promise.all([load(), refreshAccounts()]);
    } catch (x) { setError((x as Error).message); }
    finally { setRefreshingPrices(false); }
  }
  const activeHoldings = holdings.filter((holding) => Math.abs(Number(holding.quantity)) > 0.00000001);
  const totals = activeHoldings.reduce(
    (acc, h) => {
      acc[h.currency] = (acc[h.currency] || 0) + Number(h.value || 0);
      return acc;
    },
    {} as Record<string, number>,
  );
  const latestPriceDate = activeHoldings.map((holding) => holding.price_date).filter(Boolean).sort().at(-1);
  const sortedRates = [...rates].sort((a, b) => {
    const byDate = String(b.date).localeCompare(String(a.date));
    return byDate || Number(b.id || 0) - Number(a.id || 0);
  });
  const latestRateByCurrency = new Map<string, any>();
  sortedRates.forEach((rate) => {
    if (!latestRateByCurrency.has(rate.from_currency)) {
      latestRateByCurrency.set(rate.from_currency, rate);
    }
  });
  const latestRates: any[] = Array.from(latestRateByCurrency.values()).sort(
    (a, b) => String(a.from_currency).localeCompare(String(b.from_currency)),
  );
  const historicalRates = sortedRates.filter(
    (rate) => !latestRates.some((latest) => latest.id === rate.id),
  );
  const investmentAccounts = accounts
    .filter((account) => account.type === "investment")
    .map((account) => ({
      account,
      holdings: activeHoldings.filter(
        (holding) => holding.account_id === account.id,
      ),
    }))
    .sort((left, right) =>
      left.account.name.localeCompare(right.account.name, "es"),
    );
  if (error) return <div className="error">{error}</div>;
  return (
    <>
      <section className="plan-kpis">
        {["CAD", "USD", "UYU"].map((c) => (
          <article key={c}>
            <span>Portafolio {c}</span>
            <strong>{money(totals[c] || 0, c)}</strong>
          </article>
        ))}
        <article className="accent">
          <span>Instrumentos</span>
          <strong>{activeHoldings.length}</strong>
        </article>
      </section>
      <section className="content-grid investments-grid">
        <article className="panel portfolio-accounts-panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">HOLDINGS</p>
              <h3>Posiciones</h3>
              <small>{latestPriceDate ? `Precios al ${new Date(latestPriceDate+"T12:00:00").toLocaleDateString(appLocale(),{day:"numeric",month:"short",year:"numeric"})}` : "Sin cotizaciones"}</small>
            </div>
            <div className="holding-title-actions">
              <button className="ghost compact" onClick={refreshPrices} disabled={refreshingPrices}><RefreshCw />{refreshingPrices?"Actualizando…":"Actualizar"}</button>
              <button className="icon-button" onClick={() => setEditingHolding(null)}><Plus /></button>
            </div>
          </div>
          {editingHolding !== undefined && (
            <HoldingForm
              holding={editingHolding || undefined}
              accounts={accounts}
              instruments={instruments}
              done={() => {
                setEditingHolding(undefined);
                load();
              }}
              cancel={() => setEditingHolding(undefined)}
            />
          )}{" "}
          {investmentAccounts.length ? (
            <div className="investment-account-grid">
              {investmentAccounts.map(({ account, holdings: accountHoldings }) => {
                const positionsValue = accountHoldings.reduce(
                    (sum, holding) => sum + Number(holding.value || 0),
                    0,
                  ),
                  totalCost = accountHoldings.reduce(
                    (sum, holding) =>
                      sum +
                      Number(holding.quantity) * Number(holding.average_cost),
                    0,
                  ),
                  gain = positionsValue - totalCost,
                  accountTotal = positionsValue + Number(account.cash_balance || 0);
                return (
                  <section className="investment-account" key={account.id}>
                    <header className="investment-account-head">
                      <div>
                        <span>{account.owner} · {account.currency}</span>
                        <h4>{account.name}</h4>
                      </div>
                      <div>
                        <small>Valor total</small>
                        <strong>{money(accountTotal, account.currency)}</strong>
                        <small>
                          Efectivo disponible: {money(account.cash_balance, account.currency)}
                        </small>
                      </div>
                    </header>
                    {accountHoldings.length ? (
                      <div className="holdings-list">
                        {accountHoldings.map((h) => {
                          const cost = Number(h.quantity) * Number(h.average_cost),
                            holdingGain = Number(h.value || 0) - cost;
                          return (
                            <button
                              type="button"
                              className="holding-editable"
                              key={h.id}
                              onClick={() => setEditingHolding(h)}
                            >
                              <div>
                                <strong>{h.symbol}</strong>
                                <small>{h.name}</small>
                                <small>{Number(h.quantity).toFixed(4)} unidades · Costo prom. {money(h.average_cost, h.currency)}</small>
                              </div>
                              <span>
                                {h.value !== null ? money(h.value, h.currency) : "Sin precio"}
                                <small className={holdingGain >= 0 ? "gain" : "loss"}>
                                  {h.value !== null ? `${holdingGain >= 0 ? "+" : ""}${money(holdingGain, h.currency)}` : "Precio pendiente"}
                                </small>
                              </span>
                              <Pencil />
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="investment-account-empty">Sin posiciones registradas</div>
                    )}
                    <footer className="investment-account-total">
                      <span>
                        <small>Costo</small>
                        <strong>{money(totalCost, account.currency)}</strong>
                      </span>
                      <span>
                        <small>Ganancia</small>
                        <strong className={gain >= 0 ? "gain" : "loss"}>{gain >= 0 ? "+" : ""}{money(gain, account.currency)}</strong>
                      </span>
                      <span>
                        <small>Posiciones</small>
                        <strong>{money(positionsValue, account.currency)}</strong>
                      </span>
                    </footer>
                  </section>
                );
              })}
            </div>
          ) : (
            <Empty
              text="Creá una cuenta de inversión para agregar posiciones"
              action={() => setEditingHolding(null)}
            />
          )}
        </article>
        <article className="panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">CONTRIBUTION ROOM · {year}</p>
              <h3>Límites registrados</h3>
            </div>
            <button
              className="icon-button"
              onClick={() => setEditingRoom(null)}
            >
              <Plus />
            </button>
          </div>
          {editingRoom !== undefined && (
            <ContributionRoomForm
              year={year}
              room={editingRoom || undefined}
              done={() => {
                setEditingRoom(undefined);
                load();
              }}
              cancel={() => setEditingRoom(undefined)}
            />
          )}{" "}
          {rooms.length ? (
            <div className="room-list">
              {rooms.map((r) => {
                const limit = Number(r.limit_amount),
                  contributed = Number(r.contributed_amount),
                  remaining = limit - contributed,
                  used = limit ? (contributed / limit) * 100 : 0;
                return (
                  <button
                    type="button"
                    className="room-editable"
                    key={r.id}
                    onClick={() => setEditingRoom(r)}
                  >
                    <span>
                      <strong>
                        {r.account_type} ·{" "}
                        {r.account_type === "RESP"
                          ? r.beneficiary || "Sin beneficiario"
                          : r.owner}
                      </strong>
                      <small>
                        {money(contributed, r.currency)} aportados de{" "}
                        {money(limit, r.currency)}
                      </small>
                      <span className="room-progress">
                        <i
                          className={used > 100 ? "over-budget" : ""}
                          style={{ width: `${Math.min(100, used)}%` }}
                        />
                      </span>
                    </span>
                    <b className={used > 100 ? "over" : ""}>
                      {Math.round(used)}%
                      <small>{money(remaining, r.currency)} disponible</small>
                    </b>
                    <Pencil />
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty
              text="Todavía no hay límites configurados"
              action={() => setEditingRoom(null)}
            />
          )}
        </article>
        <article className="panel fx-panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">CONVERSIÓN A CAD</p>
              <h3>Tipos de cambio</h3>
            </div>
            {historicalRates.length > 0 && (
              <button
                type="button"
                className="ghost rate-history-toggle"
                onClick={() => setShowRateHistory((visible) => !visible)}
              >
                {showRateHistory ? "Ocultar historial" : "Ver historial"}
              </button>
            )}
          </div>
          <form className="inline-form" onSubmit={addRate}>
            <label>
              Moneda
              <select name="from_currency">
                <option>USD</option>
                <option>UYU</option>
              </select>
            </label>
            <label>
              CAD por unidad
              <input
                name="rate"
                type="number"
                step="0.00000001"
                placeholder="1.38"
                required
              />
            </label>
            <label>
              Fecha
              <input name="date" type="date" defaultValue={today} required />
            </label>
            <button className="primary">Guardar</button>
          </form>
          <div className="rate-list">
            {latestRates.map((r) => (
              <span key={r.id}>
                <b>1 {r.from_currency}</b> = {r.rate} CAD{" "}
                <small>{r.date}</small>
              </span>
            ))}
          </div>
          {showRateHistory && historicalRates.length > 0 && (
            <div className="rate-history">
              <p className="eyebrow">HISTORIAL</p>
              <div className="rate-list">
                {historicalRates.map((r) => (
                  <span key={r.id}>
                    <b>1 {r.from_currency}</b> = {r.rate} CAD{" "}
                    <small>{r.date}</small>
                  </span>
                ))}
              </div>
            </div>
          )}
        </article>
      </section>
    </>
  );
}

function HoldingForm({
  holding,
  accounts,
  instruments,
  done,
  cancel,
}: {
  holding?: Holding;
  accounts: Account[];
  instruments: Instrument[];
  done: () => void;
  cancel: () => void;
}) {
  const [error, setError] = useState("");
  const investmentAccounts = accounts.filter(
    (account) => account.type === "investment",
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data: any = Object.fromEntries(new FormData(e.currentTarget));
    const instrument = instruments.find(
      (item) => item.id === data.instrument_id,
    );
    try {
      await request("/holdings", {
        method: "POST",
        body: JSON.stringify({
          account_id: data.account_id,
          instrument_id: data.instrument_id,
          quantity: data.quantity,
          average_cost: data.average_cost,
        }),
      });
      if (data.price)
        await request("/market-prices", {
          method: "POST",
          body: JSON.stringify({
            instrument_id: data.instrument_id,
            date: data.price_date,
            price: data.price,
            currency: instrument?.currency || holding?.currency || "CAD",
            source: "manual",
          }),
        });
      done();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  async function remove() {
    if (!holding || !window.confirm(`¿Eliminar la posición ${holding.symbol}?`))
      return;
    try {
      await request(`/holdings/${holding.id}`, { method: "DELETE" });
      done();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  return (
    <form className="holding-form" onSubmit={submit}>
      <div className="form-row">
        <label>
          Cuenta
          <select
            name="account_id"
            defaultValue={holding?.account_id || investmentAccounts[0]?.id}
            disabled={Boolean(holding)}
            required
          >
            {investmentAccounts.map((account) => (
              <option value={account.id} key={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          {holding && (
            <input type="hidden" name="account_id" value={holding.account_id} />
          )}
        </label>
        <label>
          Instrumento
          <select
            name="instrument_id"
            defaultValue={holding?.instrument_id || instruments[0]?.id}
            disabled={Boolean(holding)}
            required
          >
            {instruments.map((item) => (
              <option value={item.id} key={item.id}>
                {item.symbol} · {item.name}
              </option>
            ))}
          </select>
          {holding && (
            <input
              type="hidden"
              name="instrument_id"
              value={holding.instrument_id}
            />
          )}
        </label>
      </div>
      <div className="form-row">
        <label>
          Cantidad
          <input
            name="quantity"
            type="number"
            step="0.00000001"
            defaultValue={
              holding ? Number(holding.quantity).toFixed(8) : "0.00000000"
            }
            required
          />
        </label>
        <label>
          Costo promedio
          <input
            name="average_cost"
            type="number"
            step="0.01"
            defaultValue={
              holding ? Number(holding.average_cost).toFixed(2) : "0.00"
            }
            required
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Precio actual
          <input
            name="price"
            type="number"
            step="0.000001"
            defaultValue={
              holding?.price ? Number(holding.price).toFixed(6) : ""
            }
            placeholder="Opcional"
          />
        </label>
        <label>
          Fecha del precio
          <input name="price_date" type="date" defaultValue={today} />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        {holding && (
          <button type="button" className="danger" onClick={remove}>
            <Trash2 />
            Eliminar
          </button>
        )}
        <button type="button" className="ghost" onClick={cancel}>
          Cancelar
        </button>
        <button className="primary submit">Guardar</button>
      </div>
    </form>
  );
}

function ContributionRoomForm({
  year,
  room,
  done,
  cancel,
}: {
  year: number;
  room?: ContributionRoom;
  done: () => void;
  cancel: () => void;
}) {
  const [error, setError] = useState(""),
    [accountType, setAccountType] = useState(room?.account_type || "TFSA");
  const isResp = accountType === "RESP";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data: any = Object.fromEntries(new FormData(e.currentTarget));
    data.owner = isResp ? "joint" : data.owner;
    data.beneficiary = isResp ? data.beneficiary : null;
    try {
      await request(
        room ? `/contribution-rooms/${room.id}` : "/contribution-rooms",
        {
          method: room ? "PATCH" : "POST",
          body: JSON.stringify({ ...data, year }),
        },
      );
      done();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  async function remove() {
    if (
      !room ||
      !window.confirm(
        `¿Eliminar el límite ${room.account_type}${room.beneficiary ? ` de ${room.beneficiary}` : ` de ${room.owner}`}?`,
      )
    )
      return;
    try {
      await request(`/contribution-rooms/${room.id}`, { method: "DELETE" });
      done();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  return (
    <form className="room-form" onSubmit={submit}>
      <p className="form-note">
        Cargá el límite de referencia y cuánto aportaste durante el año.
      </p>
      <div className="form-row">
        {isResp ? (
          <label>
            Beneficiario
            <select
              name="beneficiary"
              defaultValue={room?.beneficiary || "Child 1"}
            >
              <option>Child 1</option>
              <option>Child 2</option>
            </select>
          </label>
        ) : (
          <label>
            Persona
            <select name="owner" defaultValue={room?.owner || "person_a"}>
              <option value="person_a">Person A</option>
              <option value="person_b">Person B</option>
            </select>
          </label>
        )}
        <label>
          Tipo de cuenta
          <select
            name="account_type"
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
          >
            <option>TFSA</option>
            <option>RRSP</option>
            <option>RESP</option>
          </select>
        </label>
      </div>
      <div className="form-row">
        <label>
          Límite disponible
          <input
            name="limit_amount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={room ? Number(room.limit_amount).toFixed(2) : "0.00"}
            required
          />
        </label>
        <label>
          Aportado hasta ahora
          <input
            name="contributed_amount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={
              room ? Number(room.contributed_amount).toFixed(2) : "0.00"
            }
            required
          />
        </label>
      </div>
      <label>
        Moneda
        <select name="currency" defaultValue={room?.currency || "CAD"}>
          <option>CAD</option>
          <option>USD</option>
          <option>UYU</option>
        </select>
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        {room && (
          <button type="button" className="danger" onClick={remove}>
            <Trash2 />
            Eliminar
          </button>
        )}
        <button type="button" className="ghost" onClick={cancel}>
          Cancelar
        </button>
        <button className="primary submit">Guardar</button>
      </div>
    </form>
  );
}

export default App;
