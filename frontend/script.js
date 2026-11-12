
// RecoverAI frontend - connected to the Node.js/Express API.
// Keep the backend running at http://localhost:5000 while using this frontend.

// =========================================================
// 1. Configuration
// =========================================================

const API_BASE = "http://localhost:5000/api";
const TOKEN_KEY = "recoveraiAccessToken";
const USER_KEY = "recoveraiUser";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

// =========================================================
// 2. Application state
// =========================================================

let currentUser = null;
let payments = [];
let paymentFilter = "All";
let paymentPage = 1;
let paymentTotal = 0;
let paymentTotalPages = 1;
let performanceDays = 7;
let toastTimer;
let copilotPaymentId = null;

function toast(message) {
    const el = $("#toast");
    if (!el) return;

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function showPage(name) {
    $$(".page").forEach((page) => page.classList.remove("active"));

    const target = $("#" + name + "Page");

    if (target) target.classList.add("active");

    window.scrollTo(0, 0);
}

function authMode(mode) {
    $("#loginFormWrap").classList.toggle("hidden", mode !== "login");
    $("#signupFormWrap").classList.toggle("hidden", mode !== "signup");

    $$(".auth-tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.auth === mode);
    });
}

function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
}

function setSession(token, user) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    currentUser = user;
}

function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);

    currentUser = null;
    payments = [];
}

function initials(name) {
    return (name || "Merchant")
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function formatMoney(amount, currency = "USD") {
    const value = Number(amount || 0);

    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency
        }).format(value);
    } catch {
        return `${currency} ${value.toFixed(2)}`;
    }
}

function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "—";

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(date);
}

async function apiRequest(path, options = {}) {
    const headers = { ...(options.headers || {}) };

    if (options.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    const token = getToken();

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    let response;

    try {
        response = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers
        });
    } catch (error) {
        throw new Error(
            "Cannot reach RecoverAI backend. Check that the server is running on port 5000."
        );
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        if (response.status === 401 && path !== "/auth/login") {
            clearSession();
        }

        throw new Error(
            data.message || `Request failed (${response.status})`
        );
    }

    return data;
}

function updateProfile(user) {
    currentUser = user;

    const name = user?.name || "Merchant";
    const email = user?.email || "";

    $("#profileName").textContent = name;
    $("#profileEmail").textContent = email;
    $("#profileAvatar").textContent = initials(name);
    $("#topAvatar").textContent = initials(name);
    $("#greetingName").textContent = name.split(/\s+/)[0];
}

async function enterWorkspace(user) {
    updateProfile(user);
    showPage("app");
    appView("overview");

    await refreshWorkspace();
}

async function restoreSession() {
    if (!getToken()) return;

    try {
        const result = await apiRequest("/auth/me");

        updateProfile(result.user);
        await enterWorkspace(result.user);
    } catch (error) {
        clearSession();
        showPage("landing");

        toast("Your session has expired. Please log in again.");
    }
}

// =========================================================
// 3. Landing page and authentication navigation
// =========================================================

$$("[data-go]").forEach((button) => {
    button.addEventListener("click", () => {
        showPage("auth");

        authMode(
            button.dataset.go === "signup" ? "signup" : "login"
        );
    });
});

$("#backHome").onclick = (event) => {
    event.preventDefault();
    showPage("landing");
};

$("#authBack").onclick = () => showPage("landing");

$$("[data-auth]").forEach((button) => {
    button.addEventListener("click", () => {
        authMode(button.dataset.auth);
    });
});

$$(".toggle-password").forEach((button) => {
    button.addEventListener("click", () => {
        const input = $("#" + button.dataset.target);

        input.type = input.type === "password" ? "text" : "password";

        button.textContent =
            input.type === "password" ? "Show" : "Hide";
    });
});

$("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    const submit = event.currentTarget.querySelector(
        "button[type='submit'], .auth-submit"
    );

    submit.disabled = true;

    try {
        const result = await apiRequest("/auth/login", {
            method: "POST",
            body: JSON.stringify({
                email: form.get("email").trim(),
                password: form.get("password")
            })
        });

        setSession(result.token, result.user);

        toast("Login successful.");

        await enterWorkspace(result.user);
    } catch (error) {
        toast(error.message);
    } finally {
        submit.disabled = false;
    }
});

$("#signupForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    const password = String(form.get("password") || "");

    if (password.length < 8) {
        toast("Password must contain at least 8 characters.");
        return;
    }

    const submit = event.currentTarget.querySelector(".auth-submit");

    submit.disabled = true;

    try {
        const result = await apiRequest("/auth/register", {
            method: "POST",
            body: JSON.stringify({
                name: form.get("name").trim(),
                email: form.get("email").trim(),
                password
            })
        });

        setSession(result.token, result.user);

        toast("Your merchant account has been created.");

        await enterWorkspace(result.user);
    } catch (error) {
        toast(error.message);
    } finally {
        submit.disabled = false;
    }
});

$("#forgotPassword").onclick = (event) => {
    event.preventDefault();

    toast(
        "Password reset is not available yet. Please contact the workspace administrator."
    );
};

$("#mobileNavToggle").onclick = () => {
    $("#siteNav").classList.toggle("mobile-open");
};

// =========================================================
// 4. Dashboard and payment data
// =========================================================

// Backend payment records are the single source of truth.

function normalizedPayment(row) {
    const status = String(row.status || "unknown").toLowerCase();
    const amount = Number(row.amount || 0);

    const priority =
        status === "failed" && amount >= 300
            ? "High"
            : status === "failed"
                ? "Medium"
                : status === "pending"
                    ? "Medium"
                    : "Low";

    return {
        id: row.id,
        reference: row.paypal_order_id || `PAY-${row.id}`,
        customer: row.customer_name || "Unknown customer",
        email: row.customer_email || "",
        date: row.created_at,
        amount,
        currency: row.currency || "USD",
        status,
        reason: row.description ||
            (status === "failed" ? "Failure details not supplied" : "—"),
        priority
    };
}

function displayStatus(status) {
    return ({
        completed: "Completed",
        failed: "Failed",
        pending: "Pending",
        cancelled: "Cancelled"
    })[status] || status;
}

async function loadPayments({
    status = "All",
    search = "",
    page = 1
} = {}) {
    const params = new URLSearchParams({
        page: String(page),
        limit: "10",
        sort: $("#paymentSort")?.value || "new"
    });

    if (status !== "All") {
        params.set("status", status);
    }

    if (search.trim()) {
        params.set("search", search.trim());
    }

    const result = await apiRequest(
        `/payments?${params.toString()}`
    );

    payments = (result.payments || []).map(normalizedPayment);

    paymentTotal = Number(result.total || 0);
    paymentPage = Number(result.page || 1);

    paymentTotalPages = Math.max(
        1,
        Number(
            result.total_pages ||
            Math.ceil(paymentTotal / 10) ||
            1
        )
    );

    renderPayments();

    return result;
}

async function loadDashboardSummary() {
    const result = await apiRequest("/dashboard/summary");

    const summary = result.summary || {};

    $("#totalProcessedMetric").textContent =
        Number(summary.total_payments || 0).toLocaleString();

    $("#attentionMetric").textContent = (
        Number(summary.failed_payments || 0) +
        Number(summary.pending_payments || 0) +
        Number(summary.cancelled_payments || 0)
    ).toLocaleString();

    $("#successRateMetric").textContent =
        `${Number(summary.success_rate || 0).toFixed(2)}%`;

    const financials = result.financials || [];

    const completed = financials
        .map((item) =>
            `${formatMoney(item.completed_revenue, item.currency)} ${item.currency}`
        )
        .join(" · ");

    $("#recoveredMetric").textContent = completed || "—";

    $("#countAll").textContent =
        Number(summary.total_payments || 0);

    $("#countFailed").textContent =
        Number(summary.failed_payments || 0);

    $("#countPending").textContent =
        Number(summary.pending_payments || 0);

    $("#countCompleted").textContent =
        Number(summary.successful_payments || 0);

    $("#appPaymentCount").textContent =
        Number(summary.failed_payments || 0) +
        Number(summary.pending_payments || 0) +
        Number(summary.cancelled_payments || 0);

    const attention =
        Number(summary.failed_payments || 0) +
        Number(summary.pending_payments || 0) +
        Number(summary.cancelled_payments || 0);

    const opportunity = $(".app-opportunity");

    if (opportunity) {
        const failedFinancials = financials
            .map((item) =>
                `${formatMoney(item.failed_payment_value, item.currency)} ${item.currency}`
            )
            .join(" · ");

        opportunity.querySelector("strong").textContent =
            failedFinancials || "—";

        opportunity.querySelector("p").textContent =
            `${attention} payment(s) currently need review. Check their final PayPal status before taking another action.`;

        opportunity.querySelector("b").textContent =
            "Review recommended";
    }
}

function createChartPath(values, width = 600, height = 180, maxValue = 1) {
    if (!values.length) return "";

    const points = values.map((value, index) => {
        const x = values.length === 1
            ? width / 2
            : (index / (values.length - 1)) * width;

        const y =
            height -
            (Number(value || 0) / maxValue) * (height - 12) -
            6;

        return [x, y];
    });

    return points
        .map(([x, y], index) =>
            `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`
        )
        .join(" ");
}

async function loadPerformance(days = performanceDays) {
    performanceDays = days;

    const result = await apiRequest(
        `/dashboard/performance?days=${days}`
    );

    const rows = result.performance || [];

    const successful = rows.map(
        (row) => Number(row.successful_payments || 0)
    );

    const failed = rows.map(
        (row) => Number(row.failed_payments || 0)
    );

    const maxValue = Math.max(1, ...successful, ...failed);

    const successPath = createChartPath(
        successful,
        600,
        180,
        maxValue
    );

    const failedPath = createChartPath(
        failed,
        600,
        180,
        maxValue
    );

    const areaPath = successPath
        ? `${successPath} L600 186 L0 186 Z`
        : "";

    const svg = $(".app-chart svg");

    if (svg) {
        const area = svg.querySelector(".app-area");
        const line = svg.querySelector(".app-line");
        const secondLine = svg.querySelector(".app-line-mint");

        if (area) area.setAttribute("d", areaPath);
        if (line) line.setAttribute("d", successPath);
        if (secondLine) secondLine.setAttribute("d", failedPath);
    }

    const dates = $(".app-dates");

    if (dates) {
        dates.innerHTML = rows.map((row) => `
            <span>
                ${escapeHtml(
                    new Intl.DateTimeFormat(undefined, {
                        month: "short",
                        day: "numeric"
                    }).format(new Date(row.day))
                )}
            </span>
        `).join("");
    }

    const axis = $(".app-axis");

    if (axis) {
        axis.innerHTML = [
            maxValue,
            Math.round(maxValue * .75),
            Math.round(maxValue * .5),
            Math.round(maxValue * .25),
            0
        ].map((n) => `<span>${n}</span>`).join("");
    }
}

function paymentRow(payment, compact = false) {
    const statusLabel = displayStatus(payment.status);

    const statusClass =
        payment.status === "completed"
            ? "Completed"
            : payment.status === "cancelled"
                ? "Cancelled"
                : payment.status === "failed"
                    ? "Failed"
                    : "Pending";

    return `
        <tr data-payment="${escapeHtml(payment.id)}">
            <td>${escapeHtml(payment.reference)}</td>
            <td>${escapeHtml(payment.customer)}</td>
            <td>${escapeHtml(formatDate(payment.date))}</td>
            <td><b>${escapeHtml(formatMoney(payment.amount, payment.currency))}</b></td>
            <td><span class="status ${statusClass}">${statusLabel}</span></td>
            ${compact ? "" : `<td>${escapeHtml(payment.reason)}</td>`}
            <td><span class="priority ${payment.priority}">${payment.priority}</span></td>
        </tr>
    `;
}

function currentVisiblePayments() {
    return [...payments];
}

function renderPayments() {
    const visible = currentVisiblePayments();

    const attention = payments.filter((payment) =>
        ["failed", "pending", "cancelled"].includes(payment.status)
    );

    $("#appRecentRows").innerHTML =
        attention.slice(0, 5).map((payment) =>
            paymentRow(payment, true)
        ).join("");

    $("#appAllRows").innerHTML =
        visible.map((payment) => paymentRow(payment)).join("");

    $("#appEmpty").style.display =
        visible.length ? "none" : "block";

    const first = paymentTotal === 0
        ? 0
        : (paymentPage - 1) * 10 + 1;

    const last = Math.min(paymentPage * 10, paymentTotal);

    $("#appTableCount").innerHTML = `
        Showing ${first}–${last} of ${paymentTotal} payment(s)

        <div class="pagination-controls">
            <button type="button" class="pagination-btn"
                id="paymentsPrev"
                ${paymentPage <= 1 ? "disabled" : ""}>
                Previous
            </button>

            <span>Page ${paymentPage} of ${paymentTotalPages}</span>

            <button type="button" class="pagination-btn"
                id="paymentsNext"
                ${paymentPage >= paymentTotalPages ? "disabled" : ""}>
                Next
            </button>
        </div>
    `;

    $("#paymentsPrev")?.addEventListener("click", () =>
        loadPayments({
            status: paymentFilter,
            search: $("#paymentSearch").value,
            page: paymentPage - 1
        }).catch((error) => toast(error.message))
    );

    $("#paymentsNext")?.addEventListener("click", () =>
        loadPayments({
            status: paymentFilter,
            search: $("#paymentSearch").value,
            page: paymentPage + 1
        }).catch((error) => toast(error.message))
    );

    $("#appPaymentCount").textContent = attention.length;
}

async function refreshWorkspace() {
    try {
        await Promise.all([
            loadDashboardSummary(),
            loadPerformance(performanceDays),
            loadPayments({
                status: paymentFilter,
                page: 1
            })
        ]);
    } catch (error) {
        toast(error.message);
    }
}

function appView(name) {
    $$(".app-view").forEach((view) =>
        view.classList.remove("active-view")
    );

    const target = $("#" + name + "View");

    if (target) target.classList.add("active-view");

    $$(".app-nav").forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.appview === name
        );
    });

    $("#appBreadcrumb").textContent =
        name === "overview"
            ? "Overview"
            : name === "payments"
                ? "Payments"
                : name === "recovery"
                    ? "Recovery"
                    : "AI Copilot";

    $("#appSidebar").classList.remove("open");

    if (name === "payments" && getToken()) {
        loadPayments({
            status: paymentFilter,
            search: $("#paymentSearch").value,
            page: 1
        }).catch((error) => toast(error.message));
    }

    if (name === "recovery" && getToken()) {
        loadRecovery().catch((error) => toast(error.message));
    }
}

$$(".app-nav").forEach((button) => {
    button.addEventListener("click", () =>
        appView(button.dataset.appview)
    );
});

$$("[data-goto-app]").forEach((button) => {
    button.addEventListener("click", () =>
        appView(button.dataset.gotoApp)
    );
});

$("#statusTabs").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-status]");

    if (!button) return;

    paymentFilter = button.dataset.status;

    $$("[data-status]").forEach((tab) => {
        tab.classList.toggle("active", tab === button);
    });

    try {
        await loadPayments({
            status: paymentFilter,
            search: $("#paymentSearch").value,
            page: 1
        });
    } catch (error) {
        toast(error.message);
    }
});

let searchDebounce;

$("#paymentSearch").addEventListener("input", () => {
    clearTimeout(searchDebounce);

    searchDebounce = setTimeout(() => {
        loadPayments({
            status: paymentFilter,
            search: $("#paymentSearch").value,
            page: 1
        }).catch((error) => toast(error.message));
    }, 300);
});

$("#paymentSort").addEventListener("change", () => {
    loadPayments({
        status: paymentFilter,
        search: $("#paymentSearch").value,
        page: 1
    }).catch((error) => toast(error.message));
});

$("#performancePeriod").addEventListener("change", (event) => {
    loadPerformance(Number(event.target.value))
        .catch((error) => toast(error.message));
});

document.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-payment]");

    if (row && $("#appPage").classList.contains("active")) {
        openPayment(row.dataset.payment);
    }
});

async function openPayment(id) {
    try {
        const [result, attemptsResult] = await Promise.all([
            apiRequest(`/payments/${encodeURIComponent(id)}`),
            apiRequest(`/payments/${encodeURIComponent(id)}/attempts`)
        ]);

        const row = result.payment;
        const payment = normalizedPayment(row);
        const attempts = attemptsResult.attempts || [];

        const attemptTimeline = attempts.length
            ? attempts.map((attempt) => `
                <div class="history-item">
                    <span class="history-dot ${escapeHtml(String(attempt.status || "").toLowerCase())}"></span>
                    <div>
                        <b>Attempt ${escapeHtml(attempt.attempt_number)} · ${escapeHtml(attempt.status)}</b>
                        <small>${escapeHtml(formatDate(attempt.attempted_at))}</small>
                        ${
                            attempt.failure_code || attempt.failure_message
                                ? `<p>${escapeHtml([
                                    attempt.failure_code,
                                    attempt.failure_message
                                ].filter(Boolean).join(" — "))}</p>`
                                : ""
                        }
                    </div>
                </div>
            `).join("")
            : `
                <p class="history-empty">
                    No payment attempts have been recorded yet.
                    Attempts will appear here when payment processing is connected.
                </p>
            `;

        $("#drawerPaymentId").textContent = payment.reference;

        $("#drawerPaymentContent").innerHTML = `
            <div class="drawer-amount">
                ${escapeHtml(formatMoney(payment.amount, payment.currency))}
            </div>

            <span class="status ${
                payment.status === "completed"
                    ? "Completed"
                    : payment.status === "cancelled"
                        ? "Cancelled"
                        : payment.status === "failed"
                            ? "Failed"
                            : "Pending"
            }">
                ${escapeHtml(displayStatus(payment.status))}
            </span>

            <div class="drawer-grid">
                <div class="drawer-box">
                    <small>CUSTOMER</small>
                    <b>${escapeHtml(payment.customer)}</b>
                </div>

                <div class="drawer-box">
                    <small>PAYMENT PROVIDER</small>
                    <b>PayPal</b>
                </div>

                <div class="drawer-box">
                    <small>DATE</small>
                    <b>${escapeHtml(formatDate(payment.date))}</b>
                </div>

                <div class="drawer-box">
                    <small>PRIORITY</small>
                    <b>${payment.priority}</b>
                </div>
            </div>

            <div class="drawer-section">
                <h3>Customer information</h3>
                <p>${escapeHtml(payment.email || "No email supplied")}</p>
            </div>

            <div class="drawer-section">
                <h3>PayPal order ID</h3>
                <p>${escapeHtml(row.paypal_order_id || "Not assigned")}</p>
            </div>

            <div class="drawer-section">
                <h3>PayPal capture ID</h3>
                <p>${escapeHtml(row.paypal_capture_id || "Not captured")}</p>
            </div>

            <div class="drawer-section">
                <h3>Payment information</h3>
                <p>${escapeHtml(payment.reason)}</p>
            </div>

            <div class="drawer-section">
                <h3>Transaction history</h3>

                <div class="history-list">
                    <div class="history-item">
                        <span class="history-dot created"></span>
                        <div>
                            <b>Payment record created</b>
                            <small>${escapeHtml(formatDate(row.created_at))}</small>
                        </div>
                    </div>

                    ${attemptTimeline}
                </div>

                <p class="history-summary">
                    ${attempts.length} recorded payment attempt(s)
                </p>
            </div>

            <div class="drawer-section">
                <h3>Recommended handling</h3>
                <p>
                    ${
                        payment.status === "pending"
                            ? "Verify the final payment state with PayPal before considering another checkout."
                            : payment.status === "completed"
                                ? "This payment is completed. No recovery action is required."
                                : payment.status === "cancelled"
                                    ? "This payment is cancelled. Review its history before contacting the customer."
                                    : "Review the provider's final failure details and offer a new secure checkout only when appropriate. Do not charge again without customer authorization."
                    }
                </p>
            </div>

            <div class="drawer-section">
                <h3>AI assistance</h3>

                <div class="recovery-card-actions">
                    <button class="btn btn-primary" id="analyzePaymentAI">
                        Analyze with Gemini AI
                    </button>

                    <button class="btn btn-light" id="generateRecoveryMessageAI">
                        Draft customer message
                    </button>
                </div>
            </div>

            <button class="btn btn-primary full-width" id="askAboutPayment">
                Open AI Copilot
            </button>
        `;

        $("#drawerShade").classList.add("show");
        $("#paymentDrawer").classList.add("open");

        $("#askAboutPayment").onclick = () => {
            copilotPaymentId = payment.id;
            closePayment();
            appView("copilot");
            sendPrompt(`Analyze payment ${payment.reference}.`);
        };

        $("#analyzePaymentAI").onclick = () => {
            closePayment();
            appView("copilot");
            analyzePaymentWithAI(payment.id);
        };

        $("#generateRecoveryMessageAI").onclick = () => {
            closePayment();
            appView("copilot");
            generateAIRecoveryMessage(payment.id);
        };

    } catch (error) {
        toast(error.message);
    }
}

function closePayment() {
    $("#drawerShade").classList.remove("show");
    $("#paymentDrawer").classList.remove("open");
}

$("#closePaymentDrawer").onclick = closePayment;
$("#drawerShade").onclick = closePayment;

// =========================================================
// Payment creation notice and drawer helpers
// =========================================================

// Payment creation is intentionally unavailable until a secure
// backend/PayPal order route exists.

function showPaymentCreationNotice() {
    toast(
        "Payment creation will be enabled after PayPal Sandbox order integration."
    );
}

$$("[data-add-payment]").forEach((button) => {
    button.addEventListener("click", showPaymentCreationNotice);
});

$("#closePaymentModal").onclick = () => {
    $("#paymentModal").classList.remove("show");
};

// =========================================================
// 5. AI Copilot — Gemini integration
// =========================================================

function formatAIResult(data) {
    if (typeof data === "string") return data;

    if (!data || typeof data !== "object") {
        return String(data ?? "No AI response was returned.");
    }

    const source =
        data.analysis && typeof data.analysis === "object"
            ? data.analysis
            : data;

    const labels = {
        failureExplanation: "Failure explanation",
        possibleCause: "Possible cause (not independently verified)",
        recommendedAction: "Recommended action",
        customerMessage: "Suggested customer message",
        confidence: "Confidence"
    };

    const lines = Object.entries(labels)
        .filter(([key]) =>
            source[key] !== undefined &&
            source[key] !== null &&
            source[key] !== ""
        )
        .map(([key, label]) =>
            `${label}: ${source[key]}`
        );

    return lines.length
        ? lines.join("\n\n")
        : JSON.stringify(source, null, 2);
}

function getCopilotPayment(paymentId = null) {
    if (paymentId) {
        const exact = payments.find(
            (payment) => Number(payment.id) === Number(paymentId)
        );

        return exact && exact.status === "failed" ? exact : null;
    }

    if (copilotPaymentId) {
        const selected = payments.find(
            (payment) => Number(payment.id) === Number(copilotPaymentId)
        );

        if (selected && selected.status === "failed") {
            return selected;
        }
    }

    return payments.find(
        (payment) => payment.status === "failed"
    ) || null;
}



async function analyzePaymentWithAI(paymentId) {
    if (!paymentId) {
        toast("Select a failed payment before requesting analysis.");

        addChatBubble(
            "Payment failure analysis requires a failed payment. Open a failed payment from the Payments page."
        );

        return;
    }

    copilotPaymentId = Number(paymentId);

    addChatBubble(
        `Analyze payment #${paymentId} using the stored failure information.`,
        true
    );

    addChatBubble(
        "Analyzing the recorded payment and failure details..."
    );

    try {
        const result = await apiRequest(
            `/recovery/payments/${encodeURIComponent(paymentId)}/ai-analysis`,
            {
                method: "POST",
                body: JSON.stringify({})
            }
        );

        const analysis =
            result.data?.analysis ??
            result.analysis ??
            result.data ??
            result;

        addChatBubble(
            `Payment analysis:\n\n${formatAIResult(analysis)}`
        );

    } catch (error) {
        addChatBubble(
            `Payment analysis could not be completed: ${error.message}`
        );

        toast(error.message);
    }
}



async function generateAIRecoveryMessage(paymentId) {
    if (!paymentId) {
        toast("Select a failed payment before drafting a recovery message.");

        addChatBubble(
            "A recovery message requires a failed payment and a recovery recommendation."
        );

        return;
    }

    copilotPaymentId = Number(paymentId);

    addChatBubble(
        `Draft a customer recovery message for payment #${paymentId}.`,
        true
    );

    addChatBubble(
        "Preparing the recovery recommendation and drafting the message..."
    );

    try {
        // Generate a recommendation if one does not already exist.
        try {
            await apiRequest(
                `/recovery/payments/${encodeURIComponent(paymentId)}/recommendation`,
                {
                    method: "POST",
                    body: JSON.stringify({})
                }
            );
        } catch (recommendationError) {
            if (!/already|exists/i.test(recommendationError.message)) {
                throw recommendationError;
            }
        }

        const result = await apiRequest(
            `/recovery/payments/${encodeURIComponent(paymentId)}/ai-message`,
            {
                method: "POST",
                body: JSON.stringify({})
            }
        );

        const messageData = result.data ?? result;

        const draft =
            typeof messageData === "string"
                ? messageData
                : messageData.draft ??
                  messageData.messageDraft ??
                  messageData.message_draft ??
                  messageData.message ??
                  formatAIResult(messageData);

        addChatBubble(
            `Recovery message draft:\n\n${draft}`
        );

    } catch (error) {
        addChatBubble(
            `Recovery message could not be generated: ${error.message}`
        );

        toast(error.message);
    }
}



function addChatBubble(message, isUser = false) {
    const bubble = document.createElement("div");

    bubble.className =
        "chat-bubble" + (isUser ? " user" : "");

    const label = document.createElement("b");
    label.textContent = isUser ? "You" : "RecoverAI";

    const paragraph = document.createElement("p");
    paragraph.textContent = message;

    bubble.append(label, paragraph);

    $("#chatMessages").append(bubble);

    $("#chatMessages").scrollTop =
        $("#chatMessages").scrollHeight;
}

function showRuleBasedPriorities() {
    const failed = payments.filter(
        (payment) => payment.status === "failed"
    );

    if (!failed.length) {
        addChatBubble(
            "There are no failed payments in the currently loaded records. Refresh Payments and select a failed payment to use Gemini analysis."
        );

        return;
    }

    const ordered = [...failed].sort((a, b) => {
        const rank = {
            High: 3,
            Medium: 2,
            Low: 1
        };

        return (
            rank[b.priority] - rank[a.priority] ||
            b.amount - a.amount
        );
    });

    addChatBubble(
        "Rule-based priority list (not a Gemini-generated risk score): " +
        ordered.slice(0, 5).map((payment) =>
            `Payment #${payment.id} — ${formatMoney(payment.amount, payment.currency)} (${payment.priority} priority)`
        ).join("; ") +
        ". Verify the final PayPal status before taking recovery action."
    );
}

async function sendPrompt(question) {
    const text = String(question || "").trim();

    if (!text) return;

    $("#chatInput").value = "";

    const explicitId =
        text.match(/(?:payment\s*#?\s*)(\d+)/i)?.[1];

    const payment = getCopilotPayment(explicitId || null);

    addChatBubble(text, true);

    if (explicitId && !payment) {
        addChatBubble(
            `Payment #${explicitId} is not a failed payment in the currently loaded records. Gemini failure analysis is limited to failed payments.`
        );

        return;
    }

    if (/priorit/i.test(text)) {
        showRuleBasedPriorities();
        return;
    }

    if (/draft|message|email|follow.?up/i.test(text)) {
        if (!payment) {
            addChatBubble(
                "No failed payment is available in the currently loaded records. Open a failed payment first, then choose Draft customer message."
            );

            return;
        }

        await generateAIRecoveryMessage(payment.id);
        return;
    }

    if (/analy[sz]|explain|failure|reason|why.*payment/i.test(text)) {
        if (!payment) {
            addChatBubble(
                "Gemini analysis is available for failed payments with recorded failure details. No eligible failed payment is currently loaded."
            );

            return;
        }

        await analyzePaymentWithAI(payment.id);
        return;
    }

    addChatBubble(
        "I can use Gemini to analyze a specific failed payment and draft a customer recovery message when a recovery recommendation exists. Try ‘Analyze payment #" +
        (payment?.id ?? "ID") +
        "’ or ‘Draft recovery message’. Payment prioritization currently uses the application's rule-based score."
    );
}

$("#chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendPrompt($("#chatInput").value);
});

$$("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
        sendPrompt(button.dataset.prompt);
    });
});

// =========================================================
// Logout and global navigation
// =========================================================

$("#logoutBtn").onclick = () => {
    clearSession();
    showPage("landing");
    toast("You have logged out.");
};

$("#appMenu").onclick = () => {
    $("#appSidebar").classList.toggle("open");
};

$("#appNotify").onclick = () => {
    toast("No new notifications.");
};

$("#exportCsv").onclick = () => {
    const rows = [
        [
            "Payment reference",
            "Customer",
            "Email",
            "Created at",
            "Amount",
            "Currency",
            "Status",
            "Description"
        ],
        ...currentVisiblePayments().map((payment) => [
            payment.reference,
            payment.customer,
            payment.email,
            payment.date,
            payment.amount,
            payment.currency,
            payment.status,
            payment.reason
        ])
    ];

    const csv = rows.map((row) =>
        row.map((value) =>
            `"${String(value ?? "").replaceAll('"', '""')}"`
        ).join(",")
    ).join("\n");

    const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" })
    );

    const link = document.createElement("a");

    link.href = url;
    link.download = "recoverai-payments.csv";
    link.click();

    URL.revokeObjectURL(url);
};

// =========================================================
// 6. Recovery management and PayPal recovery checkout
// =========================================================

let recoveryRecommendations = [];
let recoveryActions = [];

function recoveryMoney(row) {
    return formatMoney(row.amount, row.currency || "USD");
}

function renderRecoveryRecommendations() {
    const container = $("#recoveryRecommendations");

    if (!container) return;

    if (!recoveryRecommendations.length) {
        container.innerHTML = `
            <p class="recovery-empty">
                No recovery recommendations found.
                Generate one from a failed payment after its failure analysis is recorded.
            </p>
        `;

        return;
    }

    container.innerHTML = recoveryRecommendations.map((item) => {
        const active = item.status === "active";

        const canCreate =
            active && item.payment_status === "failed";

        return `
            <article class="recovery-card">
                <div class="recovery-card-head">
                    <div>
                        <h3>
                            Recommendation #${escapeHtml(item.id)}
                            · Payment #${escapeHtml(item.payment_id)}
                        </h3>

                        <small>
                            ${escapeHtml(item.failure_category || "Failure category unavailable")}
                            ·
                            ${escapeHtml(item.action_type || "Review")}
                        </small>
                    </div>

                    <span class="recovery-status">
                        ${escapeHtml(item.status || "unknown")}
                    </span>
                </div>

                <p>
                    ${escapeHtml(
                        item.rationale ||
                        "Review the failure details and confirm the payment's final PayPal state."
                    )}
                </p>

                <strong>${escapeHtml(recoveryMoney(item))}</strong>

                <div class="recovery-card-actions">
                    ${
                        canCreate
                            ? `<button class="btn btn-primary" data-create-recovery-action="${escapeHtml(item.id)}">Create recovery action</button>`
                            : ""
                    }
                </div>
            </article>
        `;
    }).join("");
}

function renderRecoveryActions() {
    const container = $("#recoveryActions");

    if (!container) return;

    if (!recoveryActions.length) {
        container.innerHTML = `
            <p class="recovery-empty">
                No recovery actions have been created yet.
            </p>
        `;

        return;
    }

    container.innerHTML = recoveryActions.map((item) => {
        const hasOrder = Boolean(item.paypal_order_id);

        const canCheckout =
            ["initiated", "in_progress"].includes(item.status) &&
            !hasOrder;

        const canCapture =
            ["initiated", "in_progress"].includes(item.status) &&
            hasOrder &&
            !item.paypal_capture_id;

        return `
            <article class="recovery-card">
                <div class="recovery-card-head">
                    <div>
                        <h3>
                            Recovery action #${escapeHtml(item.id)}
                            · Payment #${escapeHtml(item.payment_id)}
                        </h3>

                        <small>
                            ${escapeHtml(item.action_type || "Recovery action")}
                        </small>
                    </div>

                    <span class="recovery-status">
                        ${escapeHtml(item.status || "unknown")}
                    </span>
                </div>

                <p>
                    ${escapeHtml(item.rationale || "Recovery action history")}
                </p>

                <strong>${escapeHtml(recoveryMoney(item))}</strong>

                ${
                    item.paypal_order_id
                        ? `<p>PayPal order: ${escapeHtml(item.paypal_order_id)}</p>`
                        : ""
                }

                ${
                    item.paypal_capture_id
                        ? `<p>PayPal capture: ${escapeHtml(item.paypal_capture_id)}</p>`
                        : ""
                }

                <div class="recovery-card-actions">
                    ${
                        canCheckout
                            ? `<button class="btn btn-primary" data-recovery-checkout="${escapeHtml(item.id)}">Create PayPal checkout</button>`
                            : ""
                    }

                    ${
                        canCapture
                            ? `<button class="btn btn-primary" data-recovery-capture="${escapeHtml(item.id)}">Verify and capture</button>`
                            : ""
                    }

                    ${
                        item.checkout_url
                            ? `<a class="btn btn-light" href="${escapeHtml(item.checkout_url)}" target="_blank" rel="noopener noreferrer">Open checkout</a>`
                            : ""
                    }
                </div>
            </article>
        `;
    }).join("");
}

async function loadRecovery() {
    const [
        recommendationResult,
        actionResult
    ] = await Promise.all([
        apiRequest("/recovery"),
        apiRequest("/recovery/actions")
    ]);

    recoveryRecommendations = recommendationResult.data || [];
    recoveryActions = actionResult.data || [];

    renderRecoveryRecommendations();
    renderRecoveryActions();
}

async function createRecoveryActionFromRecommendation(recommendationId) {
    try {
        const result = await apiRequest(
            `/recovery/recommendations/${encodeURIComponent(recommendationId)}/actions`,
            {
                method: "POST",
                body: JSON.stringify({})
            }
        );

        toast(result.message || "Recovery action created.");

        await loadRecovery();

    } catch (error) {
        toast(error.message);
    }
}

async function createRecoveryCheckout(actionId) {
    try {
        const result = await apiRequest(
            `/recovery/actions/${encodeURIComponent(actionId)}/checkout`,
            {
                method: "POST",
                body: JSON.stringify({})
            }
        );

        const approvalUrl =
            result.data?.approvalUrl ||
            result.data?.checkout_url;

        if (!approvalUrl) {
            throw new Error(
                "Checkout was created but PayPal approval URL was not returned."
            );
        }

        toast(
            "PayPal checkout created. Opening customer approval page."
        );

        window.open(
            approvalUrl,
            "_blank",
            "noopener,noreferrer"
        );

        await loadRecovery();

    } catch (error) {
        toast(error.message);
    }
}

async function captureRecoveryPayment(actionId) {
    const confirmed = window.confirm(
        "Only continue after the customer has approved this recovery order in PayPal. Verify and capture it now?"
    );

    if (!confirmed) return;

    try {
        const result = await apiRequest(
            `/recovery/actions/${encodeURIComponent(actionId)}/capture`,
            {
                method: "POST",
                body: JSON.stringify({})
            }
        );

        toast(
            result.message ||
            "Recovery capture response received."
        );

        await Promise.all([
            loadRecovery(),
            refreshWorkspace()
        ]);

    } catch (error) {
        toast(error.message);

        await loadRecovery().catch(() => {});
    }
}

async function handleRecoveryReturn() {
    const params = new URLSearchParams(window.location.search);

    const recoveryState = params.get("recovery");
    const actionId = params.get("actionId");

    if (!recoveryState || !actionId) return;

    showPage("app");
    appView("recovery");

    if (recoveryState === "success") {
        toast(
            "PayPal returned to RecoverAI. Verify and capture the approved recovery order."
        );

        await loadRecovery().catch((error) =>
            toast(error.message)
        );

    } else if (recoveryState === "cancel") {
        toast(
            "Checkout was cancelled. No recovery capture was initiated."
        );

        await loadRecovery().catch((error) =>
            toast(error.message)
        );
    }

    // Remove return parameters so a refresh does not repeat this handling.
    window.history.replaceState(
        {},
        document.title,
        window.location.pathname
    );
}

// Recovery UI event delegation.

$("#recoveryRecommendations")?.addEventListener("click", (event) => {
    const button = event.target.closest(
        "[data-create-recovery-action]"
    );

    if (button) {
        createRecoveryActionFromRecommendation(
            button.dataset.createRecoveryAction
        );
    }
});

$("#recoveryActions")?.addEventListener("click", (event) => {
    const checkoutButton = event.target.closest(
        "[data-recovery-checkout]"
    );

    const captureButton = event.target.closest(
        "[data-recovery-capture]"
    );

    if (checkoutButton) {
        createRecoveryCheckout(
            checkoutButton.dataset.recoveryCheckout
        );
    }

    if (captureButton) {
        captureRecoveryPayment(
            captureButton.dataset.recoveryCapture
        );
    }
});

$("#refreshRecovery")?.addEventListener("click", () => {
    loadRecovery().catch((error) => toast(error.message));
});

// =========================================================
// 7. Session restoration and startup
// =========================================================

// Restore a valid merchant session when the page is refreshed in the same tab.

restoreSession()
    .then(() => handleRecoveryReturn())
    .catch((error) => toast(error.message));
