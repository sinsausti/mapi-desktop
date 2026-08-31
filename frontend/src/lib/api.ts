const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const API = import.meta.env.VITE_API_URL || (isTauri ? "http://127.0.0.1:18421/api" : "http://localhost:8000/api");

export async function waitForApiReady(timeoutMs = 20000): Promise<void> {
  if (!isTauri) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API}/health`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The bundled local service is still starting.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
  throw new Error("MAPI no pudo iniciar el servicio local. Cerrá la aplicación y volvé a abrirla.");
}

async function fetchWithDesktopStartupRetry(url: string, options?: RequestInit): Promise<Response> {
  const attempts = isTauri ? 75 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
  }
  throw lastError;
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = options?.body instanceof FormData ? options.headers : {"Content-Type": "application/json", ...options?.headers};
  const response = await fetchWithDesktopStartupRetry(`${API}${path}`, {...options, headers});
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Error ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export type Account = {id:string; name:string; type:string; currency:string; opening_balance:string; balance:string;cash_balance:string;holdings_balance:string;institution:string|null;owner:string;account_subtype:string|null;archived:boolean};
export type Category = {id:string; name:string; color:string; is_income:boolean;is_essential:boolean|null;parent_id:string|null};
export type Transaction = {id:string;account_id:string;category_id:string|null;date:string;amount:string;currency:string;description:string;kind:string;payee?:string|null;notes?:string|null;transfer_id?:string|null;account?:Account;category?:Category};
export type Budget = {id:string; amount:string; spent:string; currency:string; category:Category};
export type Dashboard = {month:string; net_worth:Record<string,string>;net_worth_cad:string;missing_rates:string[]; cashflow:{currency:string;income:string;expenses:string;savings:string}[]; recent_transactions:Transaction[]; budgets:Budget[]};
export type AttentionCenter = {date:string;health_score:number;summary:{critical:number;warning:number;info:number};alerts:{type:string;severity:"critical"|"warning"|"info";target:"scheduled"|"transactions"|"plan"|"investments"|"accounts";count:number;title:string;detail:string}[]};
export type AnnualPlan = {year:number; months:{month:number;cad:{income:string;expense:string;investment:string;saving:string};free:string;missing_rates:string[]}[];annual:{income:string;expense:string;investment:string;saving:string;free:string}};
export type Goal = {id:string;name:string;target_amount:string|null;current_amount:string;monthly_contribution:string;currency:string;owner:string;target_date?:string};
export type PlannedItem = {id:string;year:number;month:number;kind:"income"|"expense"|"saving"|"investment";name:string;amount:string;maximum_amount:string|null;currency:string;category_id:string|null;account_id:string|null;owner:string;annual_paid:boolean;irregular:boolean};
export type Holding = {id:string;account_id:string;account_name:string;instrument_id:string;symbol:string;name:string;currency:string;quantity:string;average_cost:string;price:string|null;price_date:string|null;price_source:string|null;value:string|null};
export type Instrument = {id:string;symbol:string;name:string;currency:string;asset_class:string};
export type ContributionRoom = {id:string;year:number;owner:string;account_type:string;beneficiary:string|null;limit_amount:string;contributed_amount:string;currency:string};
export type InformationNote = {id:string;title:string;category:string;summary:string|null;content:string;created_at:string;updated_at:string};
export type RetirementProfile = {id:string;name:string;person_b_birth_date:string|null;person_a_birth_date:string|null;annual_spending:string|null;annual_contribution:string|null;passive_income:string;public_income:string;public_income_start_age:number;withdrawal_rate:string;real_return:string;target_retirement_age:number;retirement_country:string;estimated_tax_rate:string;updated_at:string};
export type PensionSource = {kind:string;label:string;person:string;person_name:string;start_age:number;start_year:number;monthly:string;annual:string;status:string;residence_years?:number;oas_ratio?:string;original_monthly?:string;original_currency?:string};
export type RetirementPerson = {name:string;birth_date:string|null;canada_residence_start_date?:string;years_outside_canada?:number;cpp_monthly_60?:number;cpp_monthly_65?:number;cpp_monthly_70?:number;cpp_start_age?:number;cpp_status?:string;oas_start_age?:number;oas_max_monthly?:number;oas_residence_years?:number|null;oas_ratio?:string;bps_monthly?:number;bps_currency?:string;bps_start_age?:number;bps_status?:string;employer_monthly?:number;employer_currency?:string;employer_start_age?:number;employer_status?:string;sources:PensionSource[]};
export type RetirementSnapshot = {profile:RetirementProfile;people:Record<"person_b"|"person_a",RetirementPerson>;pension_sources:PensionSource[];missing_retirement_data:string[];currency:string;portfolio:string;derived_spending:string;derived_contribution:string;effective_spending:string;effective_contribution:string;fi_number:string;fi_number_after_public:string;required_from_portfolio:string;required_after_public:string;public_start_year:number|null;progress:string;passive_income:string;public_income:string;estimated_public_income_net:string;current_sustainable_income:string;base_years:number|null;base_year:number|null;base_projected_portfolio:string;base_target_capital:string;target_year:number|null;years_to_target:number|null;portfolio_at_target:string|null;target_capital_at_target:string|null;target_gap:string|null;scenarios:{label:string;real_return:string;years:number|null;year:number|null;portfolio:string;target_capital:string;person_b_age:number|null;person_a_age:number|null}[];milestones:{percentage:number;years:number|null;year:number|null}[];recommendations:string[];missing_rates:string[]};
export type RecurringTransaction = {id:string;account_id:string;category_id:string|null;description:string;amount:string;currency:string;frequency:"weekly"|"biweekly"|"monthly"|"yearly";next_date:string;active:boolean};
export type RecurringOccurrence = {id:string;recurring_id:string;scheduled_date:string;status:"pending"|"confirmed"|"skipped";transaction_id:string|null;description:string;amount:string;currency:string;frequency:string;account_id:string;category_id:string|null;candidates:{id:string;date:string;description:string;amount:string}[]};
export type RecurringCalendar = {month:string;occurrences:RecurringOccurrence[];pending_income:string;pending_expenses:string};
export type CategorizationRule = {id:string;name:string;field:"description"|"payee";operator:"contains"|"equals"|"starts_with";value:string;category_id:string;amount:string|null;currency:string|null;account_id:string|null;transaction_kind:string|null;priority:number;active:boolean};
export type CategorizationGroup = {key:string;description:string;count:number;transaction_ids:string[];currency:string;kind:string;account_id:string;amount:string;same_amount:boolean;suggested_category_id:string|null;confidence:string;source:string|null;examples:{id:string;date:string;description:string;amount:string}[]};
export type BudgetVariance = {year:number;month:number;rows:{planned_item_id:string|null;category_id:string|null;category:string;matched_category:string|null;parent:string|null;essential:boolean|null;currency:string;owner:string;account_id:string|null;account_name:string|null;projected:string;maximum:string|null;irregular:boolean;monthly_reserve:string;actual:string;variance:string;percentage_used:string|null;status:"over"|"over_max"|"under"|"on_target"}[];totals:Record<string,{projected:string;actual:string;variance:string}>};
export type AnnualBudgetVariance = {year:number;as_of:string|null;rows:BudgetVariance["rows"];totals:Record<string,{projected:string;actual:string;variance:string;percentage_used:string|null}>};
export type SearchResult = {type:string;id:string;title:string;subtitle:string;target:"accounts"|"transactions"|"scheduled"|"investments"|"information"};
export type HouseholdSettings = {id:string;joint_person_a_share:string;emergency_fund_target_cad:string;benchmark_symbol:string;updated_at:string};
export type InvestmentTarget = {id:string;portfolio_key:string;asset_class:string;target_percentage:string;updated_at:string};
export type BackupInfo = {filename:string;kind:"automatic"|"manual"|"pre_restore";size:number;created_at:string};
export type Insights = {
  scope:string;joint_person_a_share:string;
  summary:{cash:string;investments:string;debts:string;net_worth:string};
  ownership:Record<string,{cash:string;investments:string;debts:string;net_worth:string}>;
  forecast:{days:number;starting_balance:string;minimum_balance:string;rows:{date:string;change:string;balance:string}[]};
  available_to_spend:{amount:string;liquid:string;committed_outflows:string;until:string;irregular_reserve:string;emergency_fund:string};
  net_worth_history:{date:string;total_cad:string;cash_cad:string;investments_cad:string;debts_cad:string}[];
  allocation:{asset_class:string;value_cad:string;percentage:string}[];
  investment_targets:Record<string,string>;
  rebalance:{asset_class:string;current:string;current_pct:string;target_pct:string;difference:string;buy_with_cash:string}[];
  performance:{value_cad:string;cost_cad:string;gain_cad:string;income_cad:string;total_return_cad:string;return_pct:string|null;xirr_pct:string|null;xirr_status:string;benchmark:{symbol:string;return_pct:string|null;from_date:string|null;to_date:string|null};method:string;positions:{account:string;symbol:string;asset_class:string;value_cad:string;cost_cad:string;gain_cad:string;return_pct:string|null}[]};
  contribution_rooms:{id:string;owner:string;account_type:string;beneficiary:string|null;limit:string;contributed:string;remaining:string;used_pct:string;currency:string}[];
  health:{score:number;components:Record<string,number>;essential_monthly:string;emergency_months:string|null;overdue_count:number};
  freshness:{market_prices:string|null;exchange_rates:string|null;transactions:string|null;snapshot:string;pending_scheduled:number};
};
