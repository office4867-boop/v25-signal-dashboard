const state = {
  payload: null,
  mode: "independent",
  dimension: "market",
  resultFilter: "all",
  sort: "date-desc",
  snapshotGeneratedAt: null,
};

const dashboardConfig = {
  mode: "api",
  dataBase: "./data",
  ...(window.V25_DASHBOARD_CONFIG || {}),
};
let manifestPromise = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function formatPercent(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatDate(value) {
  if (!value || String(value).length !== 8) return value || "-";
  const text = String(value);
  return `${text.slice(0, 4)}.${text.slice(4, 6)}.${text.slice(6, 8)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeStockQuery(value) {
  return String(value || "").replaceAll(" ", "").toLocaleLowerCase("ko-KR");
}

async function loadStaticManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(`${dashboardConfig.dataBase}/manifest.json`, { cache: "no-cache" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "저장된 종목 목록을 불러오지 못했습니다.");
        return payload;
      })
      .catch((error) => {
        manifestPromise = null;
        throw error;
      });
  }
  return manifestPromise;
}

function resolveStaticStock(manifest, query) {
  const raw = String(query || "").trim();
  const normalized = normalizeStockQuery(raw);
  const stocks = manifest.stocks || [];
  const aliases = (stock) => [stock.name, stock.code, ...(stock.aliases || [])];
  const exact = stocks.find(
    (stock) => stock.code === raw || aliases(stock).some((name) => normalizeStockQuery(name) === normalized),
  );
  if (exact) return exact;

  const partial = stocks.filter((stock) =>
    aliases(stock).some((name) => normalizeStockQuery(name).includes(normalized)),
  );
  if (partial.length === 1) return partial[0];
  const suggestions = partial.slice(0, 8).map((stock) => stock.name);
  const suffix = suggestions.length ? ` 비슷한 종목: ${suggestions.join(", ")}` : "";
  throw new Error(`저장된 분석에서 종목을 찾지 못했거나 여러 종목과 일치합니다.${suffix}`);
}

async function fetchAnalysis(stock, scope, params) {
  if (dashboardConfig.mode !== "static") {
    const response = await fetch(`/api/analyze?${params.toString()}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "분석 요청에 실패했습니다.");
    state.snapshotGeneratedAt = null;
    return payload;
  }

  const manifest = await loadStaticManifest();
  const entry = resolveStaticStock(manifest, stock);
  const response = await fetch(`${dashboardConfig.dataBase}/stocks/${entry.code}.json`, {
    cache: "no-cache",
  });
  const bundle = await response.json();
  if (!response.ok) throw new Error(bundle.error || "저장된 종목 분석을 불러오지 못했습니다.");
  const storedPayload = bundle.scopes?.[scope];
  if (!storedPayload) throw new Error(`저장본에 ${scope} 범위의 분석이 없습니다.`);
  let payload = storedPayload;
  if (bundle.format_version >= 2) {
    const references = bundle.scope_records?.[scope] || [];
    payload = {
      ...storedPayload,
      records: references.map(([index, action]) => ({
        ...bundle.records[index],
        sequential_action: action,
      })),
    };
  }
  state.snapshotGeneratedAt = manifest.generated_at || null;
  $("#stockInput").value = entry.name;
  return payload;
}

function setLoading(isLoading) {
  $("#statusPanel").hidden = !isLoading;
  if (isLoading) {
    $("#errorPanel").hidden = true;
    $("#dashboard").hidden = true;
  }
  $("#searchForm button[type='submit']").disabled = isLoading;
}

function showError(message) {
  $("#statusPanel").hidden = true;
  $("#dashboard").hidden = true;
  $("#errorPanel").hidden = false;
  $("#errorMessage").textContent = message;
  $("#searchForm button[type='submit']").disabled = false;
}

async function analyze() {
  const stock = $("#stockInput").value.trim();
  if (!stock) return;
  setLoading(true);
  const params = new URLSearchParams({
    stock,
    scope: $("#scopeSelect").value,
  });
  const start = $("#startInput").value.trim();
  const end = $("#endInput").value.trim();
  if (start) params.set("start", start);
  if (end) params.set("end", end);

  try {
    const payload = await fetchAnalysis(stock, $("#scopeSelect").value, params);
    state.payload = payload;
    state.dimension = payload.dimensions[state.mode].some((item) => item.id === "market")
      ? "market"
      : payload.dimensions[state.mode][0]?.id;
    render();
    $("#statusPanel").hidden = true;
    $("#errorPanel").hidden = true;
    $("#dashboard").hidden = false;
  } catch (error) {
    showError(error.message || String(error));
  } finally {
    $("#searchForm button[type='submit']").disabled = false;
  }
}

function activeRecords() {
  if (!state.payload) return [];
  return state.payload.records.filter(
    (record) => state.mode === "independent" || record.sequential_action === "채택",
  );
}

function render() {
  const { meta } = state.payload;
  $("#stockName").textContent = meta.name;
  $("#stockCode").textContent = meta.code;
  const snapshotText = state.snapshotGeneratedAt
    ? ` · 저장본 ${new Date(state.snapshotGeneratedAt).toLocaleString("ko-KR")}`
    : "";
  $("#asOfText").textContent = `${formatDate(meta.start)} — ${formatDate(meta.end)} · 확정 일봉${snapshotText}`;
  $("#scopeSummary").textContent =
    meta.scope === "eligible"
      ? "현재 V25 종목 필터를 통과한 ZLBUY만 분석합니다."
      : meta.scope === "complete"
        ? `QTScore·시장 데이터가 모두 확정된 신호만 분석합니다. 결측 ${meta.incomplete_signals}건은 제외했습니다.`
        : `모든 원시 ZLBUY를 분석합니다. 완전 데이터 시작일은 ${formatDate(meta.complete_start)}이며 결측 ${meta.incomplete_signals}건을 포함합니다.`;

  $$("[data-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === state.mode);
    button.setAttribute("aria-pressed", button.dataset.mode === state.mode ? "true" : "false");
  });

  renderMetrics();
  renderTimeline();
  renderFilterComposition();
  renderInsights();
  renderDimensionTabs();
  renderBreakdown();
  renderJournal();
  renderNotes();
}

function renderMetrics() {
  const summary = state.payload.summary[state.mode];
  $("#winRateMetric").textContent = summary.win_rate === null ? "표본 없음" : `${summary.win_rate.toFixed(1)}%`;
  $("#winLossMetric").textContent = `성숙 완료 ${summary.n}건 · ${summary.wins}승 ${summary.losses}패`;
  $("#averageMetric").textContent = formatPercent(summary.average);
  $("#medianMetric").textContent = `중앙값 ${formatPercent(summary.median)}`;
  $("#signalMetric").textContent = `${summary.signals}건`;
  $("#matureMetric").textContent = `성숙 완료 ${summary.n}건 · 미성숙 ${summary.immature_closed}건`;
  $("#excursionMetric").textContent = `${formatPercent(summary.avg_mfe)} / ${formatPercent(summary.avg_mae)}`;
  $("#openMetric").textContent = `${summary.open}건`;
  $("#skipMetric").textContent =
    state.mode === "sequential"
      ? `보유 중 중복제외 ${summary.skipped || 0}건`
      : "진행 중은 승률에서 제외";
}

function renderTimeline() {
  const container = $("#timelineChart");
  const records = activeRecords();
  if (!records.length) {
    container.innerHTML = '<div class="empty-state">표시할 신호가 없습니다.</div>';
    return;
  }
  const width = 940;
  const height = 290;
  const margin = { top: 24, right: 28, bottom: 44, left: 52 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const values = records.map((record) => Number(record.return_pct || 0));
  const maxValue = Math.max(5, ...values.map((value) => Math.abs(value)));
  const yMin = Math.min(-maxValue * 0.25, Math.min(...values, 0) * 1.15);
  const yMax = Math.max(maxValue, Math.max(...values, 0) * 1.15);
  const y = (value) => margin.top + ((yMax - value) / (yMax - yMin)) * innerHeight;
  const zeroY = y(0);
  const slot = innerWidth / records.length;
  const barWidth = Math.max(7, Math.min(28, slot * 0.58));
  const ticks = [yMin, 0, yMax / 2, yMax].filter(
    (value, index, list) => list.findIndex((other) => Math.abs(other - value) < 0.01) === index,
  );
  const labelEvery = Math.max(1, Math.ceil(records.length / 8));

  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="신호별 수익률 막대차트">`;
  ticks.forEach((tick) => {
    const tickY = y(tick);
    svg += `<line class="${Math.abs(tick) < 0.01 ? "chart-zero" : "chart-grid"}" x1="${margin.left}" y1="${tickY}" x2="${width - margin.right}" y2="${tickY}" />`;
    svg += `<text class="chart-label" x="${margin.left - 8}" y="${tickY + 4}" text-anchor="end">${tick.toFixed(0)}%</text>`;
  });
  records.forEach((record, index) => {
    const value = Number(record.return_pct || 0);
    const x = margin.left + slot * index + (slot - barWidth) / 2;
    const barY = value >= 0 ? y(value) : zeroY;
    const barHeight = Math.max(2, Math.abs(y(value) - zeroY));
    const isOpen = record.outcome_status === "OPEN";
    const color = isOpen ? "var(--amber)" : value >= 0 ? "var(--green)" : "var(--red)";
    svg += `<g class="signal-bar"><title>${escapeHtml(formatDate(record.signal_date))} · ${formatPercent(value)} · ${escapeHtml(record.exit_reason)}</title>`;
    svg += `<rect x="${x}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="2" fill="${color}" />`;
    if (records.length <= 14 || Math.abs(value) === Math.max(...values.map(Math.abs))) {
      svg += `<text class="chart-value" x="${x + barWidth / 2}" y="${value >= 0 ? barY - 7 : barY + barHeight + 14}" text-anchor="middle">${value >= 0 ? "+" : ""}${value.toFixed(1)}</text>`;
    }
    if (index % labelEvery === 0 || index === records.length - 1) {
      svg += `<text class="chart-label" x="${x + barWidth / 2}" y="${height - 13}" text-anchor="middle">${String(record.signal_date).slice(2, 4)}.${String(record.signal_date).slice(4, 6)}</text>`;
    }
    svg += "</g>";
  });
  svg += "</svg>";
  container.innerHTML = svg;
}

function renderFilterComposition() {
  const counts = state.payload.meta.filter_counts;
  const total = counts.적격 + counts.제외 + counts.판정불가;
  const eligibleAngle = total ? (counts.적격 / total) * 360 : 0;
  const excludedAngle = total ? ((counts.적격 + counts.제외) / total) * 360 : eligibleAngle;
  $("#filterDonut").innerHTML = `
    <div class="donut" style="background: conic-gradient(var(--green) 0deg ${eligibleAngle}deg, var(--red) ${eligibleAngle}deg ${excludedAngle}deg, var(--unknown) ${excludedAngle}deg 360deg)">
      <div><strong>${total}</strong><small>전체 신호</small></div>
    </div>`;
  $("#filterCounts").innerHTML = [
    ["적격", counts.적격],
    ["제외", counts.제외],
    ["판정불가", counts.판정불가],
  ]
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}건</dd></div>`)
    .join("");
}

function renderInsights() {
  const insights = state.payload.insights[state.mode];
  $("#insightGrid").innerHTML = insights
    .map(
      (item) => `
        <article class="insight-card ${escapeHtml(item.tone)}">
          <span>${escapeHtml(item.eyebrow)}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.text)}</p>
        </article>`,
    )
    .join("");
}

function renderDimensionTabs() {
  const dimensions = state.payload.dimensions[state.mode];
  if (!dimensions.some((item) => item.id === state.dimension)) {
    state.dimension = dimensions[0]?.id;
  }
  $("#dimensionTabs").innerHTML = dimensions
    .map(
      (item) => `
        <button type="button" data-dimension="${escapeHtml(item.id)}" class="${item.id === state.dimension ? "is-active" : ""}">
          ${escapeHtml(item.label)}
        </button>`,
    )
    .join("");
  $$("[data-dimension]").forEach((button) => {
    button.addEventListener("click", () => {
      state.dimension = button.dataset.dimension;
      renderDimensionTabs();
      renderBreakdown();
    });
  });
}

function renderBreakdown() {
  const dimension = state.payload.dimensions[state.mode].find(
    (item) => item.id === state.dimension,
  );
  const container = $("#breakdownChart");
  if (!dimension || !dimension.groups.length) {
    container.innerHTML = '<div class="empty-state">비교할 조건 표본이 없습니다.</div>';
    return;
  }
  const maxAbs = Math.max(
    1,
    ...dimension.groups.map((group) => Math.abs(Number(group.average || 0))),
  );
  container.innerHTML = dimension.groups
    .map((group) => {
      const average = group.average;
      const width = average === null ? 0 : Math.min(50, (Math.abs(average) / maxAbs) * 50);
      const left = average !== null && average < 0 ? 50 - width : 50;
      return `
        <div class="breakdown-row" title="중앙값 ${formatPercent(group.median)} · 평균 MFE ${formatPercent(group.avg_mfe)} · 평균 MAE ${formatPercent(group.avg_mae)}">
          <div class="breakdown-name">${escapeHtml(group.label)}</div>
          <div class="bar-track">
            <span class="bar-fill ${average !== null && average < 0 ? "negative" : ""}" style="left:${left}%;width:${width}%"></span>
          </div>
          <div class="breakdown-value ${average !== null && average < 0 ? "return-negative" : average !== null ? "return-positive" : ""}">${formatPercent(average)}</div>
          <div class="breakdown-rate">승률 ${group.win_rate === null ? "-" : `${group.win_rate.toFixed(1)}%`}</div>
          <div class="breakdown-n">n=${group.n}</div>
        </div>`;
    })
    .join("");
}

function filterAndSortRecords() {
  let records = [...activeRecords()];
  if (state.resultFilter === "win") {
    records = records.filter((record) => record.outcome_status === "CLOSED" && record.return_pct > 0);
  } else if (state.resultFilter === "loss") {
    records = records.filter((record) => record.outcome_status === "CLOSED" && record.return_pct <= 0);
  } else if (state.resultFilter === "open") {
    records = records.filter((record) => record.outcome_status === "OPEN");
  } else if (state.resultFilter === "eligible") {
    records = records.filter((record) => record.v25_filter_status === "적격");
  }

  const direction = state.sort.endsWith("asc") ? 1 : -1;
  if (state.sort.startsWith("date")) {
    records.sort((a, b) => a.signal_date.localeCompare(b.signal_date) * direction);
  } else {
    records.sort((a, b) => (Number(a.return_pct || 0) - Number(b.return_pct || 0)) * direction);
  }
  return records;
}

function pillClass(status) {
  if (status === "적격") return "eligible";
  if (status === "제외") return "excluded";
  return "unknown";
}

function returnClass(record) {
  if (record.outcome_status === "OPEN") return "return-open";
  return record.return_pct > 0 ? "return-positive" : "return-negative";
}

function detailMarkup(record) {
  const checks = record.checks
    .map(
      (check) => `
        <div class="check-item ${escapeHtml(check.status)}">
          <i aria-hidden="true"></i>
          <div>
            <strong>${escapeHtml(check.label)}</strong>
            <small>${escapeHtml(check.detail)} · 기준 ${escapeHtml(check.requirement)}</small>
          </div>
        </div>`,
    )
    .join("");
  const metrics = [
    ["V25 판정 사유", record.filter_brief],
    ["진입 / 평가가격", `${formatNumber(record.entry_price)}원 / ${formatNumber(record.valuation_price)}원`],
    ["최대 종가낙폭", formatPercent(record.max_drawdown_pct)],
    ["트레일링 활성", record.trailing_activated ? "활성" : "미활성"],
    ["최근 이브닝", `${formatDate(record.latest_evening_date)} · ${record.evening_lag || "-"}거래일`],
    ["시장국면 / RSI", `${record.market_regime || "-"} / ${formatNumber(record.kospi_rsi14, 1)}`],
    ["QT / 거래량비", `${formatNumber(record.qt_score, 0)} / ${formatNumber(record.volume_ratio, 2)}배`],
    ["MA20 이격", formatPercent(record.ma20_gap_pct)],
  ]
    .map(
      ([label, value]) => `<div class="detail-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join("");
  return `<div class="detail-content"><div class="detail-metrics">${metrics}</div><div class="check-grid">${checks}</div></div>`;
}

function renderJournal() {
  const records = filterAndSortRecords();
  $("#emptyJournal").hidden = records.length > 0;
  $("#journalBody").innerHTML = records
    .map(
      (record, index) => `
        <tr class="signal-row" tabindex="0" data-detail="detail-${index}" aria-expanded="false">
          <td>${formatDate(record.signal_date)}</td>
          <td><span class="pill ${pillClass(record.v25_filter_status)}">${escapeHtml(record.v25_filter_status)}</span></td>
          <td><span class="pill ${record.sequential_action === "중복제외" ? "skipped" : ""}">${escapeHtml(record.sequential_action)}</span></td>
          <td class="number-cell">${formatNumber(record.entry_price)}원</td>
          <td>${formatDate(record.exit_date || record.valuation_date)}</td>
          <td class="number-cell">${record.holding_days ?? "-"}</td>
          <td class="number-cell ${returnClass(record)}">${formatPercent(record.return_pct)}</td>
          <td class="number-cell">${formatPercent(record.mfe_pct)}</td>
          <td class="number-cell">${formatPercent(record.mae_pct)}</td>
          <td>${escapeHtml(record.exit_reason)}</td>
          <td><button class="expand-button" type="button" aria-label="상세 조건 펼치기">＋</button></td>
        </tr>
        <tr id="detail-${index}" class="detail-row" hidden>
          <td colspan="11">${detailMarkup(record)}</td>
        </tr>`,
    )
    .join("");

  $$("tr.signal-row").forEach((row) => {
    const toggle = () => {
      const detail = document.getElementById(row.dataset.detail);
      const expanded = row.getAttribute("aria-expanded") === "true";
      row.setAttribute("aria-expanded", expanded ? "false" : "true");
      detail.hidden = expanded;
      row.querySelector(".expand-button").textContent = expanded ? "＋" : "−";
    };
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
  });
}

function renderNotes() {
  $("#notes").innerHTML = `<ul>${state.payload.notes
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join("")}</ul>`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv() {
  const records = activeRecords();
  const fields = [
    ["종목코드", "code"],
    ["종목명", "name"],
    ["신호일", "signal_date"],
    ["매수종가", "entry_price"],
    ["V25판정", "v25_filter_status"],
    ["필터탈락사유", "v25_filter_failures"],
    ["미확정조건", "v25_filter_unavailable"],
    ["연속매매", "sequential_action"],
    ["청산일", "exit_date"],
    ["평가일", "valuation_date"],
    ["청산가", "exit_price"],
    ["평가가격", "valuation_price"],
    ["보유일", "holding_days"],
    ["청산사유", "exit_reason"],
    ["수익률", "return_pct"],
    ["MFE", "mfe_pct"],
    ["MAE", "mae_pct"],
    ["MDD", "max_drawdown_pct"],
    ["시장국면", "market_regime"],
    ["KOSPI_RSI14", "kospi_rsi14"],
    ["QTScore", "qt_score"],
    ["거래량비", "volume_ratio"],
    ["MA20이격", "ma20_gap_pct"],
    ["직전이브닝일", "latest_evening_date"],
    ["이브닝시차", "evening_lag"],
    ["품질", "quality_label"],
  ];
  const lines = [fields.map(([label]) => csvEscape(label)).join(",")];
  records.forEach((record) => {
    lines.push(fields.map(([, key]) => csvEscape(record[key])).join(","));
  });
  const blob = new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.payload.meta.name}_V25_신호감사_${state.payload.meta.end}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

$("#searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  analyze();
});

$$("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    render();
  });
});

$("#resultFilter").addEventListener("change", (event) => {
  state.resultFilter = event.target.value;
  renderJournal();
});

$("#sortSelect").addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderJournal();
});

$("#exportButton").addEventListener("click", exportCsv);

if (dashboardConfig.mode === "static") {
  $("#environmentLabel").textContent = "MOBILE SNAPSHOT TERMINAL";
  $("#environmentFootnote").textContent = "V25 SIGNAL AUDIT · READ ONLY · SAVED SNAPSHOT";
  $("#marketBadge").textContent = "SAVED DATA";
  $("#loadingTitle").textContent = "저장된 신호 이력을 불러오고 있습니다";
  $("#loadingDescription").textContent = "마지막으로 게시한 V25 분석 기록을 확인하는 중입니다.";
  [$("#startInput"), $("#endInput")].forEach((input) => {
    input.value = "";
    input.disabled = true;
    input.placeholder = "저장본 전체기간";
    input.title = "모바일 저장본에서는 게시할 때 생성한 전체기간을 사용합니다.";
  });
}

analyze();
